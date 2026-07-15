// Background pollers. Each loop snapshots config under the lock, releases it,
// awaits the network call, then re-locks to write the result — never holding
// the std Mutex across `.await`.

use chrono::{DateTime, Utc};
use std::time::{Duration, Instant};
use tokio::time::sleep;

use crate::models::*;
use crate::services;
use crate::state::Shared;

const MIN_SPOTIFY_POLL_MS: u64 = 1_000;
const MAX_SPOTIFY_POLL_MS: u64 = 60_000;
const TRACK_END_REFRESH_OFFSET_MS: u64 = 800;

pub fn spawn_all(shared: Shared) {
    let w = shared.clone();
    tauri::async_runtime::spawn(async move { weather_loop(w).await });
    let n = shared.clone();
    tauri::async_runtime::spawn(async move { news_loop(n).await });
    let sp = shared.clone();
    tauri::async_runtime::spawn(async move { spotify_loop(sp).await });
    let pn = shared.clone();
    tauri::async_runtime::spawn(async move { personal_news_loop(pn).await });
}

async fn weather_loop(shared: Shared) {
    loop {
        let (cfg, http) = {
            let g = shared.lock().unwrap();
            (g.state.settings.weather.clone(), g.http.clone())
        };
        match services::fetch_weather(&http, &cfg).await {
            Ok(weather) => {
                let mut g = shared.lock().unwrap();
                g.state.weather = WeatherState {
                    source: "live".to_string(),
                    current: Some(weather.current),
                    hourly: weather.hourly,
                    overview: weather.overview,
                    updated_at: Some(now_iso()),
                    error: weather.error,
                };
                g.state.updated_at = now_iso();
            }
            Err(e) => {
                let mut g = shared.lock().unwrap();
                g.state.weather.error = Some(e);
            }
        }
        let retry_secs = {
            let g = shared.lock().unwrap();
            if g.state.weather.source == "mock" {
                60
            } else {
                600
            }
        };
        sleep(Duration::from_secs(retry_secs)).await;
    }
}

async fn news_loop(shared: Shared) {
    loop {
        let (cfg, http) = {
            let g = shared.lock().unwrap();
            (g.state.settings.news.clone(), g.http.clone())
        };
        if let Ok(fetch) = services::fetch_news(&http, &cfg).await {
            let mut g = shared.lock().unwrap();
            if !fetch.items.is_empty() || fetch.error.is_none() {
                g.state.news = fetch.items;
            }
            g.state.news_feeds = fetch.feeds;
            g.state.updated_at = now_iso();
            g.persist();
        }
        sleep(Duration::from_secs(900)).await; // 15 min
    }
}

async fn spotify_loop(shared: Shared) {
    let mut error_streak = 0u32;
    loop {
        let result = refresh_spotify_once(&shared).await;
        if result.is_ok() {
            error_streak = 0;
        } else {
            error_streak = error_streak.saturating_add(1);
        }

        let (cfg, spotify) = {
            let g = shared.lock().unwrap();
            (g.state.settings.spotify.clone(), g.state.spotify.clone())
        };
        let delay = spotify_next_delay(&cfg, &spotify, result.as_ref().err(), error_streak);
        sleep(delay).await;
    }
}

/// One serialized sample shared by the background worker and the explicit
/// `/api/spotify/refresh` action. Keeping both paths behind the same guard
/// avoids accidental overlapping requests when a user clicks refresh exactly
/// as the automatic poll fires.
pub async fn refresh_spotify_once(shared: &Shared) -> Result<SpotifyState, String> {
    let guard = shared.lock().unwrap().spotify_refresh_guard.clone();
    let _refresh_guard = guard.lock().await;
    let (client_id, client_secret, refresh_token, cached, http) = {
        let g = shared.lock().unwrap();
        let cached = g
            .spotify_token
            .as_ref()
            .and_then(|(token, expires)| (*expires > Instant::now()).then(|| token.clone()));
        (
            g.state.settings.spotify.client_id.clone(),
            g.secrets.spotify_client_secret.clone(),
            g.secrets.spotify_refresh_token.clone(),
            cached,
            g.http.clone(),
        )
    };

    if client_id.is_empty() || client_secret.is_empty() || refresh_token.is_empty() {
        let mut g = shared.lock().unwrap();
        g.state.spotify = SpotifyState {
            connected: false,
            status: "unconfigured".to_string(),
            track: None,
            lyrics: SpotifyLyricsState::default(),
            error: None,
        };
        return Err("unconfigured".to_string());
    }

    let token = match cached {
        Some(token) => token,
        None => {
            match services::spotify_refresh_token(&http, &client_id, &client_secret, &refresh_token)
                .await
            {
                Ok((token, expires)) => {
                    let mut g = shared.lock().unwrap();
                    let expires_at =
                        Instant::now() + Duration::from_secs(expires.saturating_sub(60));
                    g.spotify_token = Some((token.clone(), expires_at));
                    token
                }
                Err(error) => {
                    let mut g = shared.lock().unwrap();
                    g.state.spotify.status = "error".to_string();
                    g.state.spotify.error = Some(error.clone());
                    g.state.updated_at = now_iso();
                    return Err(error);
                }
            }
        }
    };

    let track = match services::spotify_now_playing(&http, &token).await {
        Ok(track) => track,
        Err(error) => {
            let mut g = shared.lock().unwrap();
            g.state.spotify.status = "error".to_string();
            g.state.spotify.error = Some(error.clone());
            g.state.updated_at = now_iso();
            return Err(error);
        }
    };
    let (previous_lyrics, data_dir) = {
        let mut g = shared.lock().unwrap();
        let lyrics = match &track {
            Some(sampled) if lyrics_match_track(&g.state.spotify.lyrics, sampled) => {
                g.state.spotify.lyrics.clone()
            }
            Some(sampled) => crate::lyrics_cache::load(&g.data_dir, sampled).unwrap_or_default(),
            _ => SpotifyLyricsState::default(),
        };
        g.state.spotify = SpotifyState {
            connected: true,
            status: spotify_status(&track),
            track: track.clone(),
            lyrics: lyrics.clone(),
            error: None,
        };
        g.state.updated_at = now_iso();
        (lyrics, g.data_dir.clone())
    };

    if let Some(sampled) = &track {
        let lyrics =
            services::lyrics_for_track(&http, &data_dir, Some(previous_lyrics), sampled).await;
        let mut g = shared.lock().unwrap();
        if current_track_matches(g.state.spotify.track.as_ref(), sampled) {
            g.state.spotify.lyrics = lyrics;
            g.state.updated_at = now_iso();
        }
    }

    Ok(shared.lock().unwrap().state.spotify.clone())
}

fn spotify_next_delay(
    cfg: &SpotifyConfig,
    spotify: &SpotifyState,
    error: Option<&String>,
    error_streak: u32,
) -> Duration {
    let regular_ms = cfg
        .poll_interval_ms
        .clamp(MIN_SPOTIFY_POLL_MS, MAX_SPOTIFY_POLL_MS);
    if error.is_some_and(|error| error == "unconfigured") {
        return Duration::from_secs(30);
    }
    if error.is_some() {
        let backoff_secs = (5u64.saturating_mul(1u64 << error_streak.min(4))).min(60);
        return Duration::from_millis(regular_ms).max(Duration::from_secs(backoff_secs));
    }

    let regular = Duration::from_millis(regular_ms);
    if !cfg.refresh_on_track_end {
        return regular;
    }
    track_end_refresh_delay(spotify.track.as_ref()).map_or(regular, |end| regular.min(end))
}

fn track_end_refresh_delay(track: Option<&SpotifyTrack>) -> Option<Duration> {
    let track = track.filter(|track| track.is_playing)?;
    let duration_ms = track.duration_ms?;
    let progress_ms = track.progress_ms?;
    let sampled_age_ms = track
        .sampled_at
        .as_deref()
        .and_then(|sampled| DateTime::parse_from_rfc3339(sampled).ok())
        .map(|sampled| {
            (Utc::now() - sampled.with_timezone(&Utc))
                .num_milliseconds()
                .max(0) as u64
        })
        .unwrap_or(0);
    let remaining_ms = duration_ms.saturating_sub(progress_ms.saturating_add(sampled_age_ms));
    if remaining_ms == 0 {
        return None;
    }
    Some(Duration::from_millis(
        remaining_ms.saturating_add(TRACK_END_REFRESH_OFFSET_MS),
    ))
}

async fn personal_news_loop(shared: Shared) {
    let mut last_checkpoint = Instant::now();
    loop {
        sleep(Duration::from_millis(500)).await;
        let mut g = shared.lock().unwrap();
        let panel = g.state.ui.settings.get("personalNewsPanel");
        let auto_enabled = panel
            .and_then(|settings| settings.get("autoShowWhenLyricsUnavailable"))
            .and_then(serde_json::Value::as_bool)
            .unwrap_or(true);
        let lyrics_available = !g.state.spotify.lyrics.lines.is_empty();
        let auto_active =
            auto_enabled && !lyrics_available && g.state.personal_news.current_script.is_some();
        let previous = g.state.personal_news.clone();
        let next = crate::personal_news::reconcile_auto_play(&previous, auto_active);
        let cursor_changed = previous.status != next.status
            || previous.line_index != next.line_index
            || previous.selected_script_id != next.selected_script_id
            || previous.auto_play_active != next.auto_play_active;
        let checkpoint_due =
            next.status == "playing" && last_checkpoint.elapsed() >= Duration::from_secs(5);
        g.state.personal_news = next;
        if cursor_changed {
            g.state.updated_at = now_iso();
        }
        if cursor_changed || checkpoint_due {
            g.persist_public_data();
            last_checkpoint = Instant::now();
        }
    }
}

fn spotify_status(track: &Option<SpotifyTrack>) -> String {
    match track {
        Some(t) if t.is_playing => "playing",
        Some(_) => "paused",
        None => "idle",
    }
    .to_string()
}

fn lyrics_match_track(lyrics: &SpotifyLyricsState, track: &SpotifyTrack) -> bool {
    lyrics.track_id == services::spotify_track_key(track) && lyrics.status != "idle"
}

fn current_track_matches(current: Option<&SpotifyTrack>, sampled: &SpotifyTrack) -> bool {
    current
        .and_then(services::spotify_track_key)
        .is_some_and(|key| Some(key) == services::spotify_track_key(sampled))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn spotify_interval_is_clamped_to_safe_bounds() {
        let mut cfg = SpotifyConfig::default();
        cfg.poll_interval_ms = 100;
        assert_eq!(
            spotify_next_delay(&cfg, &SpotifyState::default(), None, 0),
            Duration::from_millis(MIN_SPOTIFY_POLL_MS)
        );
        cfg.poll_interval_ms = 120_000;
        assert_eq!(
            spotify_next_delay(&cfg, &SpotifyState::default(), None, 0),
            Duration::from_millis(MAX_SPOTIFY_POLL_MS)
        );
    }

    #[test]
    fn track_end_refresh_can_preempt_the_regular_interval() {
        let cfg = SpotifyConfig {
            poll_interval_ms: 10_000,
            refresh_on_track_end: true,
            ..SpotifyConfig::default()
        };
        let spotify = SpotifyState {
            track: Some(SpotifyTrack {
                id: Some("track".into()),
                title: "title".into(),
                artist: "artist".into(),
                album: None,
                album_art_url: None,
                duration_ms: Some(180_000),
                progress_ms: Some(178_000),
                sampled_at: None,
                is_playing: true,
            }),
            ..SpotifyState::default()
        };
        assert_eq!(
            spotify_next_delay(&cfg, &spotify, None, 0),
            Duration::from_millis(2_800)
        );
    }

    #[test]
    fn already_ended_sample_falls_back_to_the_regular_interval() {
        let cfg = SpotifyConfig {
            poll_interval_ms: 2_000,
            refresh_on_track_end: true,
            ..SpotifyConfig::default()
        };
        let spotify = SpotifyState {
            track: Some(SpotifyTrack {
                id: Some("track".into()),
                title: "title".into(),
                artist: "artist".into(),
                album: None,
                album_art_url: None,
                duration_ms: Some(180_000),
                progress_ms: Some(180_000),
                sampled_at: None,
                is_playing: true,
            }),
            ..SpotifyState::default()
        };
        assert_eq!(
            spotify_next_delay(&cfg, &spotify, None, 0),
            Duration::from_millis(2_000)
        );
    }
}

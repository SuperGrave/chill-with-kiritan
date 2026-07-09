// Background pollers. Each loop snapshots config under the lock, releases it,
// awaits the network call, then re-locks to write the result — never holding
// the std Mutex across `.await`.

use std::time::{Duration, Instant};
use tokio::time::sleep;

use crate::models::*;
use crate::services;
use crate::state::Shared;

pub fn spawn_all(shared: Shared) {
    let w = shared.clone();
    tauri::async_runtime::spawn(async move { weather_loop(w).await });
    let n = shared.clone();
    tauri::async_runtime::spawn(async move { news_loop(n).await });
    let sp = shared.clone();
    tauri::async_runtime::spawn(async move { spotify_loop(sp).await });
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
    loop {
        let (client_id, client_secret, refresh_token, cached, http) = {
            let g = shared.lock().unwrap();
            let cached = g
                .spotify_token
                .as_ref()
                .and_then(|(t, exp)| (*exp > Instant::now()).then(|| t.clone()));
            (
                g.state.settings.spotify.client_id.clone(),
                g.secrets.spotify_client_secret.clone(),
                g.secrets.spotify_refresh_token.clone(),
                cached,
                g.http.clone(),
            )
        };

        if !(client_id.is_empty() || client_secret.is_empty() || refresh_token.is_empty()) {
            let token = match cached {
                Some(t) => Some(t),
                None => match services::spotify_refresh_token(
                    &http,
                    &client_id,
                    &client_secret,
                    &refresh_token,
                )
                .await
                {
                    Ok((t, expires)) => {
                        let mut g = shared.lock().unwrap();
                        let exp = Instant::now() + Duration::from_secs(expires.saturating_sub(60));
                        g.spotify_token = Some((t.clone(), exp));
                        Some(t)
                    }
                    Err(e) => {
                        let mut g = shared.lock().unwrap();
                        g.state.spotify.status = "error".to_string();
                        g.state.spotify.error = Some(e);
                        None
                    }
                },
            };

            if let Some(token) = token {
                if let Ok(track) = services::spotify_now_playing(&http, &token).await {
                    let previous_lyrics = {
                        let mut g = shared.lock().unwrap();
                        let lyrics = match &track {
                            Some(t) if lyrics_match_track(&g.state.spotify.lyrics, t) => {
                                g.state.spotify.lyrics.clone()
                            }
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
                        lyrics
                    };

                    if let Some(t) = &track {
                        let lyrics =
                            services::lyrics_for_track(&http, Some(previous_lyrics), t).await;
                        let mut g = shared.lock().unwrap();
                        if current_track_matches(g.state.spotify.track.as_ref(), t) {
                            g.state.spotify.lyrics = lyrics;
                            g.state.updated_at = now_iso();
                        }
                    }
                }
            }
        }
        sleep(Duration::from_secs(5)).await;
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

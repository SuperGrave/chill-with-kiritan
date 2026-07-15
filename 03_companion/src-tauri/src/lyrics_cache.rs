use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

use crate::{
    models::{now_iso, SpotifyLyricsState, SpotifyTrack},
    services,
};

const CACHE_FILE: &str = "lyrics-cache.json";
const CACHE_VERSION: u32 = 1;
const MAX_ENTRIES: usize = 500;

#[derive(Debug, Serialize, Deserialize)]
#[serde(default)]
struct LyricsCacheFile {
    version: u32,
    entries: Vec<LyricsCacheEntry>,
}

impl Default for LyricsCacheFile {
    fn default() -> Self {
        Self {
            version: CACHE_VERSION,
            entries: Vec::new(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct LyricsCacheEntry {
    key: String,
    artist: String,
    title: String,
    duration_ms: Option<u64>,
    cached_at: String,
    lyrics: SpotifyLyricsState,
}

pub fn cache_path(data_dir: &Path) -> PathBuf {
    data_dir.join(CACHE_FILE)
}

/// Return a previously downloaded non-empty lyric set for this Spotify track.
/// Corrupt or newer cache files are ignored so they can never block playback.
pub fn load(data_dir: &Path, track: &SpotifyTrack) -> Option<SpotifyLyricsState> {
    let key = services::spotify_track_key(track)?;
    let cache = read(data_dir);
    if cache.version > CACHE_VERSION {
        return None;
    }
    cache
        .entries
        .into_iter()
        .find(|entry| entry.key == key && is_cacheable(&entry.lyrics))
        .map(|mut entry| {
            // The stable key is authoritative even when a legacy entry omitted
            // the Spotify id and used the artist/title fallback.
            entry.lyrics.track_id = Some(key);
            entry.lyrics
        })
}

/// Persist only successfully downloaded lyrics. Empty/error responses are not
/// cached, so a later retry can still discover newly available LRCLIB data.
pub fn store(data_dir: &Path, track: &SpotifyTrack, lyrics: &SpotifyLyricsState) -> bool {
    if !is_cacheable(lyrics) {
        return false;
    }
    let Some(key) = services::spotify_track_key(track) else {
        return false;
    };

    let mut cache = read(data_dir);
    cache.version = CACHE_VERSION;
    cache.entries.retain(|entry| entry.key != key);
    let mut lyrics = lyrics.clone();
    lyrics.track_id = Some(key.clone());
    cache.entries.push(LyricsCacheEntry {
        key,
        artist: track.artist.clone(),
        title: track.title.clone(),
        duration_ms: track.duration_ms,
        cached_at: now_iso(),
        lyrics,
    });
    cache.entries.sort_by(|a, b| a.cached_at.cmp(&b.cached_at));
    if cache.entries.len() > MAX_ENTRIES {
        cache.entries.drain(..cache.entries.len() - MAX_ENTRIES);
    }
    write(data_dir, &cache)
}

fn is_cacheable(lyrics: &SpotifyLyricsState) -> bool {
    matches!(lyrics.status.as_str(), "synced" | "plain") && !lyrics.lines.is_empty()
}

fn read(data_dir: &Path) -> LyricsCacheFile {
    let Ok(text) = std::fs::read_to_string(cache_path(data_dir)) else {
        return LyricsCacheFile::default();
    };
    serde_json::from_str(&text).unwrap_or_default()
}

fn write(data_dir: &Path, cache: &LyricsCacheFile) -> bool {
    if std::fs::create_dir_all(data_dir).is_err() {
        return false;
    }
    let Ok(text) = serde_json::to_string_pretty(cache) else {
        return false;
    };
    let path = cache_path(data_dir);
    let tmp = data_dir.join(format!("{CACHE_FILE}.tmp"));
    if std::fs::write(&tmp, &text).is_err() {
        return false;
    }
    if std::fs::rename(&tmp, &path).is_err() {
        if std::fs::write(&path, &text).is_err() {
            let _ = std::fs::remove_file(&tmp);
            return false;
        }
        let _ = std::fs::remove_file(&tmp);
    }
    true
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::LyricLine;

    fn temp_dir(label: &str) -> PathBuf {
        std::env::temp_dir().join(format!(
            "tohoku-companion-lyrics-cache-{label}-{}",
            uuid::Uuid::new_v4()
        ))
    }

    fn track(id: &str) -> SpotifyTrack {
        SpotifyTrack {
            id: Some(id.to_string()),
            title: "Cache Song".to_string(),
            artist: "Cache Artist".to_string(),
            album: None,
            album_art_url: None,
            duration_ms: Some(180_000),
            progress_ms: Some(0),
            sampled_at: None,
            is_playing: true,
        }
    }

    fn lyrics(status: &str) -> SpotifyLyricsState {
        SpotifyLyricsState {
            track_id: Some("spotify-track-1".to_string()),
            source: Some("LRCLIB".to_string()),
            status: status.to_string(),
            synced: status == "synced",
            lines: vec![LyricLine {
                time: Some(1.2),
                text: "cached line".to_string(),
            }],
            error: None,
        }
    }

    #[test]
    fn downloaded_lyrics_round_trip_from_disk() {
        let dir = temp_dir("roundtrip");
        let track = track("spotify-track-1");
        assert!(store(&dir, &track, &lyrics("synced")));
        let cached = load(&dir, &track).expect("lyrics should load from cache");
        assert_eq!(cached.status, "synced");
        assert_eq!(cached.lines.len(), 1);
        assert_eq!(cached.lines[0].text, "cached line");
        assert_eq!(cached.track_id.as_deref(), Some("spotify-track-1"));
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn empty_and_error_results_are_not_cached() {
        let dir = temp_dir("negative");
        let track = track("spotify-track-2");
        let mut empty = lyrics("empty");
        empty.lines.clear();
        assert!(!store(&dir, &track, &empty));
        assert!(load(&dir, &track).is_none());

        let mut error = lyrics("error");
        error.error = Some("offline".to_string());
        assert!(!store(&dir, &track, &error));
        assert!(load(&dir, &track).is_none());
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn corrupt_cache_is_ignored_and_replaced() {
        let dir = temp_dir("corrupt");
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(cache_path(&dir), "not-json").unwrap();
        let track = track("spotify-track-3");
        assert!(load(&dir, &track).is_none());
        assert!(store(&dir, &track, &lyrics("plain")));
        assert_eq!(load(&dir, &track).unwrap().status, "plain");
        let _ = std::fs::remove_dir_all(dir);
    }

    #[tokio::test]
    async fn lyric_service_returns_disk_cache_without_network() {
        let dir = temp_dir("service-hit");
        let track = track("spotify-track-4");
        assert!(store(&dir, &track, &lyrics("synced")));

        // No server is needed here: a regression that misses the disk cache
        // would attempt LRCLIB and make this deterministic test fail/timeout.
        let http = reqwest::Client::builder()
            .timeout(std::time::Duration::from_millis(1))
            .build()
            .unwrap();
        let loaded = services::lyrics_for_track(&http, &dir, None, &track).await;
        assert_eq!(loaded.status, "synced");
        assert_eq!(loaded.lines[0].text, "cached line");
        let _ = std::fs::remove_dir_all(dir);
    }
}

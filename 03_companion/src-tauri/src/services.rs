// Outbound integrations. All functions are free async fns that take owned
// inputs (never the shared Mutex) so callers can lock → copy config → unlock →
// await → lock → write result, without holding the lock across `.await`.

use base64::Engine;
use serde_json::Value;

use crate::models::*;

// ─── Weather (open-meteo, no key) ────────────────────────────────────────────

pub async fn fetch_weather(
    http: &reqwest::Client,
    cfg: &WeatherConfig,
) -> Result<WeatherFetch, String> {
    let url = format!(
        "https://api.open-meteo.com/v1/forecast?latitude={}&longitude={}\
&current=temperature_2m,relative_humidity_2m,apparent_temperature,is_day,precipitation,rain,snowfall,weather_code,cloud_cover,pressure_msl,wind_speed_10m,wind_direction_10m,wind_gusts_10m\
&hourly=temperature_2m,relative_humidity_2m,weather_code,precipitation_probability,wind_speed_10m\
&daily=temperature_2m_max,temperature_2m_min,sunrise,sunset,uv_index_max,precipitation_sum,precipitation_probability_max\
&temperature_unit=celsius&wind_speed_unit=ms&precipitation_unit=mm&timezone={}",
        cfg.latitude, cfg.longitude, cfg.timezone
    );
    let resp = http.get(&url).send().await.map_err(|e| e.to_string())?;
    if !resp.status().is_success() {
        return Err(format!("open-meteo {}", resp.status()));
    }
    let data: Value = resp.json().await.map_err(|e| e.to_string())?;
    let c = &data["current"];
    let daily = &data["daily"];
    let hourly_data = &data["hourly"];
    let num = |k: &str| c[k].as_f64().unwrap_or(0.0);
    let opt_num = |k: &str| c[k].as_f64();
    let daily_num = |k: &str| daily[k].get(0).and_then(Value::as_f64);
    let daily_str = |k: &str| {
        daily[k]
            .get(0)
            .and_then(Value::as_str)
            .map(format_weather_time)
    };

    let current = WeatherCurrent {
        location: cfg.location_label.clone(),
        temperature: num("temperature_2m"),
        apparent_temperature: num("apparent_temperature"),
        temperature_min: daily_num("temperature_2m_min"),
        temperature_max: daily_num("temperature_2m_max"),
        humidity: num("relative_humidity_2m"),
        pressure: num("pressure_msl"),
        weather_code: num("weather_code") as i32,
        precipitation_probability: daily_num("precipitation_probability_max"),
        precipitation: daily_num("precipitation_sum").or_else(|| opt_num("precipitation")),
        rain: opt_num("rain"),
        snowfall: opt_num("snowfall"),
        cloud_cover: opt_num("cloud_cover"),
        uv_index: daily_num("uv_index_max"),
        wind_speed: num("wind_speed_10m"),
        wind_direction: num("wind_direction_10m"),
        wind_gust: opt_num("wind_gusts_10m"),
        is_day: c["is_day"].as_i64().unwrap_or(1) == 1,
        sunrise: daily_str("sunrise"),
        sunset: daily_str("sunset"),
    };

    let hourly = parse_hourly_weather(hourly_data, c["time"].as_str());
    let mut errors = Vec::new();
    let overview = if cfg.jma_office.trim().is_empty() {
        None
    } else {
        match fetch_weather_overview(http, &cfg.jma_office).await {
            Ok(overview) => Some(overview),
            Err(e) => {
                errors.push(format!("JMA: {e}"));
                None
            }
        }
    };

    Ok(WeatherFetch {
        current,
        hourly,
        overview,
        error: (!errors.is_empty()).then(|| errors.join(", ")),
    })
}

fn format_weather_time(value: &str) -> String {
    value
        .split('T')
        .nth(1)
        .and_then(|hm| hm.get(0..5))
        .unwrap_or(value)
        .to_string()
}

fn hourly_num(hourly: &Value, key: &str, idx: usize) -> Option<f64> {
    hourly[key].get(idx).and_then(Value::as_f64)
}

fn parse_hourly_weather(hourly: &Value, current_time: Option<&str>) -> Vec<WeatherHourly> {
    let Some(times) = hourly["time"].as_array() else {
        return vec![];
    };
    let start = current_time
        .and_then(|cur| {
            times
                .iter()
                .position(|t| t.as_str().is_some_and(|s| s >= cur))
        })
        .unwrap_or(0);

    times
        .iter()
        .enumerate()
        .skip(start)
        .take(6)
        .filter_map(|(idx, t)| {
            let time = t.as_str()?;
            Some(WeatherHourly {
                time: format_weather_time(time),
                temperature: hourly_num(hourly, "temperature_2m", idx).unwrap_or(0.0),
                humidity: hourly_num(hourly, "relative_humidity_2m", idx),
                weather_code: hourly_num(hourly, "weather_code", idx).map(|v| v as i32),
                precipitation_probability: hourly_num(hourly, "precipitation_probability", idx),
                wind_speed: hourly_num(hourly, "wind_speed_10m", idx),
            })
        })
        .collect()
}

async fn fetch_weather_overview(
    http: &reqwest::Client,
    jma_office: &str,
) -> Result<WeatherOverview, String> {
    let url = format!(
        "https://www.jma.go.jp/bosai/forecast/data/overview_forecast/{}.json",
        jma_office
    );
    let resp = http.get(&url).send().await.map_err(|e| e.to_string())?;
    if !resp.status().is_success() {
        return Err(format!("jma {}", resp.status()));
    }
    let data: Value = resp.json().await.map_err(|e| e.to_string())?;
    Ok(WeatherOverview {
        publishing_office: data["publishingOffice"].as_str().unwrap_or("").to_string(),
        report_datetime: data["reportDatetime"].as_str().unwrap_or("").to_string(),
        target_area: data["targetArea"].as_str().unwrap_or("").to_string(),
        text: data["text"].as_str().unwrap_or("").to_string(),
    })
}

// ─── News (RSS, no key) ──────────────────────────────────────────────────────

const MAX_NEWS_ITEMS_PER_FEED: usize = 30;

pub async fn fetch_news(http: &reqwest::Client, cfg: &NewsConfig) -> Result<NewsFetch, String> {
    let mut items: Vec<NewsItem> = Vec::new();
    let mut feeds: Vec<NewsFeedState> = Vec::new();
    let mut errors: Vec<String> = Vec::new();

    for feed in &cfg.feeds {
        let source = feed_source_label(feed);
        let updated_at = Some(now_iso());
        match http.get(feed).send().await {
            Ok(resp) => {
                if !resp.status().is_success() {
                    let error = format!("rss {}", resp.status());
                    errors.push(format!("{source}: {error}"));
                    feeds.push(NewsFeedState {
                        feed_url: feed.clone(),
                        source,
                        status: "error".to_string(),
                        items: vec![],
                        error: Some(error),
                        updated_at,
                    });
                    continue;
                }
                match resp.text().await {
                    Ok(body) => {
                        let mut feed_items = parse_rss(&body, &source);
                        let status = if feed_items.is_empty() { "empty" } else { "ok" };
                        feed_items.truncate(MAX_NEWS_ITEMS_PER_FEED);
                        items.extend(feed_items.iter().cloned());
                        feeds.push(NewsFeedState {
                            feed_url: feed.clone(),
                            source,
                            status: status.to_string(),
                            items: feed_items,
                            error: None,
                            updated_at,
                        });
                    }
                    Err(e) => {
                        let error = e.to_string();
                        errors.push(format!("{source}: {error}"));
                        feeds.push(NewsFeedState {
                            feed_url: feed.clone(),
                            source,
                            status: "error".to_string(),
                            items: vec![],
                            error: Some(error),
                            updated_at,
                        });
                    }
                }
            }
            Err(e) => {
                let error = e.to_string();
                errors.push(format!("{source}: {error}"));
                feeds.push(NewsFeedState {
                    feed_url: feed.clone(),
                    source,
                    status: "error".to_string(),
                    items: vec![],
                    error: Some(error),
                    updated_at,
                });
            }
        }
    }

    // newest first by published_at string (RFC822/ISO both sort poorly as
    // strings, so keep feed order which is already newest-first for NHK).
    items.truncate(cfg.max_items.max(1));
    Ok(NewsFetch {
        items,
        feeds,
        error: (!errors.is_empty()).then(|| errors.join("; ")),
    })
}

fn feed_source_label(feed: &str) -> String {
    if feed.contains("nhk.or.jp") {
        "NHK".to_string()
    } else if let Some(host) = feed.split("://").nth(1).and_then(|s| s.split('/').next()) {
        host.trim_start_matches("www.").to_uppercase()
    } else {
        "RSS".to_string()
    }
}

/// Minimal RSS 2.0 parser — extracts <item> blocks and their child tags.
/// Robust enough for NHK / Yahoo / generic RSS without pulling an XML crate.
fn parse_rss(xml: &str, source: &str) -> Vec<NewsItem> {
    let mut out = Vec::new();
    let mut rest = xml;
    while let Some(start) = rest.find("<item") {
        let after = &rest[start..];
        let Some(end) = after.find("</item>") else {
            break;
        };
        let block = &after[..end];
        let title = extract_tag(block, "title").unwrap_or_default();
        let link = extract_tag(block, "link").unwrap_or_default();
        if title.is_empty() && link.is_empty() {
            rest = &after[end + 7..];
            continue;
        }
        let desc = extract_tag(block, "description");
        let pub_date = extract_tag(block, "pubDate");
        out.push(NewsItem {
            id: uuid::Uuid::new_v4().to_string(),
            title: clean(&title),
            source: Some(source.to_string()),
            url: clean(&link),
            published_at: pub_date.map(|d| clean(&d)),
            summary: desc.map(|d| clean(&d)).filter(|s| !s.is_empty()),
        });
        rest = &after[end + 7..];
    }
    out
}

fn extract_tag(block: &str, tag: &str) -> Option<String> {
    let open = format!("<{}", tag);
    let close = format!("</{}>", tag);
    let s = block.find(&open)?;
    // skip to end of opening tag '>'
    let gt = block[s..].find('>')? + s + 1;
    let e = block[gt..].find(&close)? + gt;
    Some(block[gt..e].to_string())
}

fn clean(s: &str) -> String {
    let s = s
        .replace("<![CDATA[", "")
        .replace("]]>", "")
        .replace("&amp;", "&")
        .replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&quot;", "\"")
        .replace("&#39;", "'");
    s.trim().to_string()
}

// ─── Spotify ─────────────────────────────────────────────────────────────────

pub const SPOTIFY_REDIRECT_URI: &str = "http://127.0.0.1:40313/spotify/callback";
pub const SPOTIFY_SCOPES: &str =
    "user-read-currently-playing user-read-playback-state user-modify-playback-state";

pub fn spotify_authorize_url(client_id: &str, state: &str) -> Result<String, String> {
    let mut url =
        reqwest::Url::parse("https://accounts.spotify.com/authorize").map_err(|e| e.to_string())?;
    url.query_pairs_mut()
        .append_pair("response_type", "code")
        .append_pair("client_id", client_id)
        .append_pair("scope", SPOTIFY_SCOPES)
        .append_pair("redirect_uri", SPOTIFY_REDIRECT_URI)
        .append_pair("state", state);
    Ok(url.to_string())
}

/// Refresh an access token from a stored refresh token. Returns (token, expires_in_secs).
pub async fn spotify_refresh_token(
    http: &reqwest::Client,
    client_id: &str,
    client_secret: &str,
    refresh_token: &str,
) -> Result<(String, u64), String> {
    let basic = base64::engine::general_purpose::STANDARD
        .encode(format!("{}:{}", client_id, client_secret));
    let resp = http
        .post("https://accounts.spotify.com/api/token")
        .header("Authorization", format!("Basic {}", basic))
        .form(&[
            ("grant_type", "refresh_token"),
            ("refresh_token", refresh_token),
        ])
        .send()
        .await
        .map_err(|e| e.to_string())?;
    let status = resp.status();
    let data: Value = resp.json().await.map_err(|e| e.to_string())?;
    if !status.is_success() {
        return Err(data["error_description"]
            .as_str()
            .or_else(|| data["error"].as_str())
            .unwrap_or("spotify token error")
            .to_string());
    }
    let token = data["access_token"]
        .as_str()
        .ok_or("no access_token")?
        .to_string();
    let expires = data["expires_in"].as_u64().unwrap_or(3600);
    Ok((token, expires))
}

/// Exchange an authorization-code callback for access/refresh tokens.
pub async fn spotify_exchange_code(
    http: &reqwest::Client,
    client_id: &str,
    client_secret: &str,
    code: &str,
) -> Result<(String, Option<String>, u64), String> {
    let basic = base64::engine::general_purpose::STANDARD
        .encode(format!("{}:{}", client_id, client_secret));
    let resp = http
        .post("https://accounts.spotify.com/api/token")
        .header("Authorization", format!("Basic {}", basic))
        .form(&[
            ("grant_type", "authorization_code"),
            ("code", code),
            ("redirect_uri", SPOTIFY_REDIRECT_URI),
        ])
        .send()
        .await
        .map_err(|e| e.to_string())?;
    let status = resp.status();
    let data: Value = resp.json().await.map_err(|e| e.to_string())?;
    if !status.is_success() {
        return Err(data["error_description"]
            .as_str()
            .or_else(|| data["error"].as_str())
            .unwrap_or("spotify authorization error")
            .to_string());
    }
    let token = data["access_token"]
        .as_str()
        .ok_or("no access_token")?
        .to_string();
    let refresh = data["refresh_token"].as_str().map(|s| s.to_string());
    let expires = data["expires_in"].as_u64().unwrap_or(3600);
    Ok((token, refresh, expires))
}

/// Returns Ok(None) when nothing is playing (204).
pub async fn spotify_now_playing(
    http: &reqwest::Client,
    access_token: &str,
) -> Result<Option<SpotifyTrack>, String> {
    let resp = http
        .get("https://api.spotify.com/v1/me/player/currently-playing")
        .bearer_auth(access_token)
        .send()
        .await
        .map_err(|e| e.to_string())?;
    if resp.status().as_u16() == 204 {
        return Ok(None);
    }
    if !resp.status().is_success() {
        let status = resp.status();
        if status == reqwest::StatusCode::TOO_MANY_REQUESTS {
            let retry_after = resp
                .headers()
                .get(reqwest::header::RETRY_AFTER)
                .and_then(|value| value.to_str().ok())
                .unwrap_or("unknown");
            return Err(format!(
                "spotify rate limited (429, retry after {retry_after}s)"
            ));
        }
        return Err(format!("spotify {status}"));
    }
    let data: Value = resp.json().await.map_err(|e| e.to_string())?;
    let item = &data["item"];
    if item.is_null() {
        return Ok(None);
    }
    let sampled_at = now_iso();
    let artist = item["artists"]
        .as_array()
        .map(|a| {
            a.iter()
                .filter_map(|x| x["name"].as_str())
                .collect::<Vec<_>>()
                .join(", ")
        })
        .unwrap_or_default();
    let art = item["album"]["images"]
        .as_array()
        .and_then(|imgs| imgs.first())
        .and_then(|i| i["url"].as_str())
        .map(|s| s.to_string());
    Ok(Some(SpotifyTrack {
        id: item["id"].as_str().map(|s| s.to_string()),
        title: item["name"].as_str().unwrap_or("").to_string(),
        artist,
        album: item["album"]["name"].as_str().map(|s| s.to_string()),
        album_art_url: art,
        duration_ms: item["duration_ms"].as_u64(),
        progress_ms: data["progress_ms"].as_u64(),
        sampled_at: Some(sampled_at),
        is_playing: data["is_playing"].as_bool().unwrap_or(false),
    }))
}

pub async fn spotify_playback_action(
    http: &reqwest::Client,
    access_token: &str,
    action: &str,
) -> Result<(), String> {
    let (method, url) = match action {
        "play" => ("PUT", "https://api.spotify.com/v1/me/player/play"),
        "pause" => ("PUT", "https://api.spotify.com/v1/me/player/pause"),
        "next" => ("POST", "https://api.spotify.com/v1/me/player/next"),
        "previous" => ("POST", "https://api.spotify.com/v1/me/player/previous"),
        _ => return Err("unknown spotify action".to_string()),
    };
    let builder = if method == "PUT" {
        http.put(url)
    } else {
        http.post(url)
    };
    let resp = builder
        .bearer_auth(access_token)
        .send()
        .await
        .map_err(|e| e.to_string())?;
    if resp.status().is_success() || resp.status().as_u16() == 204 {
        Ok(())
    } else {
        Err(format!("spotify control {}", resp.status()))
    }
}

pub async fn fetch_lyrics(
    http: &reqwest::Client,
    track_id: Option<String>,
    artist: &str,
    title: &str,
    duration_ms: Option<u64>,
) -> Result<SpotifyLyricsState, String> {
    if artist.trim().is_empty() || title.trim().is_empty() {
        return Ok(SpotifyLyricsState {
            track_id,
            status: "empty".to_string(),
            ..SpotifyLyricsState::default()
        });
    }

    let mut req = http
        .get("https://lrclib.net/api/search")
        .query(&[("artist_name", artist), ("track_name", title)]);
    let duration_sec = duration_ms.map(|ms| ((ms + 500) / 1000).to_string());
    if let Some(duration) = duration_sec.as_deref() {
        req = req.query(&[("duration", duration)]);
    }
    let resp = req.send().await.map_err(|e| e.to_string())?;
    if !resp.status().is_success() {
        return Err(format!("lrclib {}", resp.status()));
    }
    let data: Value = resp.json().await.map_err(|e| e.to_string())?;
    let Some(results) = data.as_array() else {
        return Err("lrclib response was not an array".to_string());
    };
    let Some(best) = results
        .iter()
        .find(|item| {
            item["syncedLyrics"]
                .as_str()
                .is_some_and(|s| !s.trim().is_empty())
        })
        .or_else(|| results.first())
    else {
        return Ok(SpotifyLyricsState {
            track_id,
            source: Some("LRCLIB".to_string()),
            status: "empty".to_string(),
            ..SpotifyLyricsState::default()
        });
    };

    let synced_lyrics = best["syncedLyrics"].as_str().unwrap_or("").trim();
    if !synced_lyrics.is_empty() {
        let lines = parse_lrc(synced_lyrics);
        if !lines.is_empty() {
            return Ok(SpotifyLyricsState {
                track_id,
                source: Some("LRCLIB".to_string()),
                status: "synced".to_string(),
                synced: true,
                lines,
                error: None,
            });
        }
    }

    let plain = best["plainLyrics"].as_str().unwrap_or("").trim();
    if !plain.is_empty() {
        let lines = plain
            .lines()
            .filter_map(|line| {
                let text = line.trim();
                (!text.is_empty()).then(|| LyricLine {
                    time: None,
                    text: text.to_string(),
                })
            })
            .collect::<Vec<_>>();
        if !lines.is_empty() {
            return Ok(SpotifyLyricsState {
                track_id,
                source: Some("LRCLIB".to_string()),
                status: "plain".to_string(),
                synced: false,
                lines,
                error: None,
            });
        }
    }

    Ok(SpotifyLyricsState {
        track_id,
        source: Some("LRCLIB".to_string()),
        status: "empty".to_string(),
        ..SpotifyLyricsState::default()
    })
}

pub async fn lyrics_for_track(
    http: &reqwest::Client,
    previous: Option<SpotifyLyricsState>,
    track: &SpotifyTrack,
) -> SpotifyLyricsState {
    let track_id = spotify_track_key(track);
    if previous
        .as_ref()
        .is_some_and(|lyrics| lyrics.track_id == track_id && lyrics.status != "idle")
    {
        return previous.unwrap();
    }

    match fetch_lyrics(
        http,
        track_id.clone(),
        &track.artist,
        &track.title,
        track.duration_ms,
    )
    .await
    {
        Ok(lyrics) => lyrics,
        Err(e) => SpotifyLyricsState {
            track_id,
            source: Some("LRCLIB".to_string()),
            status: "error".to_string(),
            synced: false,
            lines: vec![],
            error: Some(e),
        },
    }
}

pub fn spotify_track_key(track: &SpotifyTrack) -> Option<String> {
    track
        .id
        .clone()
        .or_else(|| Some(format!("{}::{}", track.artist, track.title)))
}

fn parse_lrc(lrc: &str) -> Vec<LyricLine> {
    let mut out = Vec::new();
    for raw in lrc.lines() {
        let trimmed = raw.trim();
        let mut offset = 0usize;
        let mut times = Vec::new();
        while trimmed[offset..].starts_with('[') {
            let Some(close_rel) = trimmed[offset + 1..].find(']') else {
                break;
            };
            let close = offset + 1 + close_rel;
            let tag = &trimmed[offset + 1..close];
            let Some(time) = parse_lrc_time(tag) else {
                break;
            };
            times.push(time);
            offset = close + 1;
            if offset >= trimmed.len() {
                break;
            }
        }
        if times.is_empty() {
            continue;
        }
        let text = trimmed[offset..].trim();
        for time in times {
            out.push(LyricLine {
                time: Some((time * 1000.0).round() / 1000.0),
                text: text.to_string(),
            });
        }
    }
    out.sort_by(|a, b| {
        a.time
            .partial_cmp(&b.time)
            .unwrap_or(std::cmp::Ordering::Equal)
    });
    out
}

fn parse_lrc_time(tag: &str) -> Option<f64> {
    let (minutes, seconds) = tag.split_once(':')?;
    let minutes = minutes.parse::<f64>().ok()?;
    let seconds = seconds.parse::<f64>().ok()?;
    Some(minutes * 60.0 + seconds)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_rss_items_with_cdata_and_entities() {
        let xml = r#"
        <rss><channel>
          <title>Channel</title>
          <item>
            <title><![CDATA[速報：テスト & 確認]]></title>
            <link>https://example.com/a</link>
            <description>本文の概要</description>
            <pubDate>Wed, 18 Jun 2026 09:00:00 +0900</pubDate>
          </item>
          <item>
            <title>二件目</title>
            <link>https://example.com/b</link>
          </item>
        </channel></rss>"#;
        let items = parse_rss(xml, "NHK");
        assert_eq!(items.len(), 2);
        assert_eq!(items[0].title, "速報：テスト & 確認");
        assert_eq!(items[0].url, "https://example.com/a");
        assert_eq!(items[0].summary.as_deref(), Some("本文の概要"));
        assert_eq!(items[0].source.as_deref(), Some("NHK"));
        assert_eq!(items[1].title, "二件目");
        assert!(items[1].summary.is_none());
    }

    #[test]
    fn ignores_non_item_content() {
        assert!(parse_rss("<rss><channel><title>x</title></channel></rss>", "X").is_empty());
    }

    #[test]
    fn parses_multiple_lrc_timestamps() {
        let parsed = parse_lrc("[00:01.20][00:02.30]hello\n[01:03.004]next");
        assert_eq!(parsed.len(), 3);
        assert_eq!(parsed[0].time, Some(1.2));
        assert_eq!(parsed[1].text, "hello");
        assert_eq!(parsed[2].time, Some(63.004));
    }
}

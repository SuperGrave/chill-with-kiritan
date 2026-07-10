use std::{
    collections::HashSet,
    path::{Path, PathBuf},
    time::SystemTime,
};

use chrono::{DateTime, Utc};

use crate::models::*;

const SCRIPT_DIR_NAME: &str = "personal_news_scripts";
const DEFAULT_LINE_MS: u64 = 10_000;
const MIN_LINE_MS: u64 = 1_000;
const DEFAULT_SUPPLEMENT_MS: u64 = 5_000;
// Plain text lines are timed from their visible length so the overlay ticker
// moves at a steady reading pace (~5.6 chars/sec, matching the hand-tuned news
// scripts) instead of a flat 10s that crawls on short lines and rushes long ones.
const CHAR_MS: u64 = 180;
const MIN_TEXT_LINE_MS: u64 = 2_000;

#[derive(Debug, Clone)]
struct ParsedSupplement {
    title: String,
    text: String,
    url: Option<String>,
    duration_ms: u64,
}

pub fn load_personal_news_state(
    data_dir: &Path,
    previous: Option<&PersonalNewsState>,
    preferred_script_id: Option<&str>,
) -> PersonalNewsState {
    let dirs = script_dirs(data_dir);
    let mut scripts = Vec::new();
    let mut errors = Vec::new();
    let mut first_script: Option<PersonalNewsScript> = None;
    let mut selected_script: Option<PersonalNewsScript> = None;
    let preferred =
        preferred_script_id.or_else(|| previous.and_then(|p| p.selected_script_id.as_deref()));

    // Search dirs are fallbacks that can resolve to the same physical folder via
    // different path spellings (e.g. `cwd/..` vs `manifest/..`), so the same file
    // may be visited more than once. Dedup by the stable script id — first dir in
    // priority order wins — so the scripts list never carries duplicate ids
    // (which would collide as React keys on the client).
    let mut seen_ids = HashSet::new();
    for dir in &dirs {
        let Ok(entries) = std::fs::read_dir(dir) else {
            continue;
        };
        for entry in entries.flatten() {
            let path = entry.path();
            if !is_script_file(&path) {
                continue;
            }
            match parse_script_file(&path) {
                Ok(script) => {
                    if !seen_ids.insert(script.id.clone()) {
                        continue;
                    }
                    if first_script.is_none() {
                        first_script = Some(script.clone());
                    }
                    if preferred.is_some_and(|id| id == script.id) {
                        selected_script = Some(script.clone());
                    }
                    scripts.push(summary_for(&script));
                }
                Err(e) => errors.push(e),
            }
        }
    }

    scripts.sort_by(|a, b| {
        b.modified_at
            .cmp(&a.modified_at)
            .then_with(|| a.title.cmp(&b.title))
    });
    let current_script = selected_script.or(first_script);
    let selected_script_id = current_script.as_ref().map(|s| s.id.clone());
    let duration_ms = current_script
        .as_ref()
        .map(|s| s.estimated_duration_ms)
        .unwrap_or(0);
    let script_dir = dirs
        .iter()
        .find(|p| p.exists())
        .or_else(|| dirs.first())
        .map(|p| p.to_string_lossy().to_string());
    let loop_enabled = previous.is_some_and(|p| p.loop_enabled);

    PersonalNewsState {
        scripts,
        current_script,
        selected_script_id,
        status: if duration_ms > 0 { "idle" } else { "error" }.to_string(),
        line_index: 0,
        line_started_at: None,
        line_elapsed_ms: 0,
        elapsed_ms: 0,
        duration_ms,
        current_chapter_index: 0,
        loop_enabled,
        script_dir,
        error: if duration_ms == 0 {
            if errors.is_empty() {
                Some("personal news script was not found".to_string())
            } else {
                Some(errors.join("; "))
            }
        } else if errors.is_empty() {
            None
        } else {
            Some(errors.join("; "))
        },
        updated_at: now_iso(),
    }
}

pub fn materialize_personal_news(state: &PersonalNewsState) -> PersonalNewsState {
    let mut out = state.clone();
    let Some(script) = out.current_script.as_ref() else {
        return out;
    };
    if script.lines.is_empty() {
        out.status = "error".to_string();
        out.error = Some("selected script has no lines".to_string());
        return out;
    }

    let now = Utc::now();
    let mut idx = out.line_index.min(script.lines.len().saturating_sub(1));
    let mut line_elapsed = out.line_elapsed_ms;
    if out.status == "playing" {
        if let Some(started) = out
            .line_started_at
            .as_deref()
            .and_then(|s| DateTime::parse_from_rfc3339(s).ok())
        {
            line_elapsed = line_elapsed.saturating_add(
                (now - started.with_timezone(&Utc))
                    .num_milliseconds()
                    .max(0) as u64,
            );
        }

        loop {
            let duration = script.lines[idx].duration_ms.max(MIN_LINE_MS);
            if line_elapsed < duration {
                break;
            }
            line_elapsed -= duration;
            idx += 1;
            if idx >= script.lines.len() {
                if out.loop_enabled {
                    idx = 0;
                } else {
                    idx = script.lines.len().saturating_sub(1);
                    line_elapsed = script.lines[idx].duration_ms.max(MIN_LINE_MS);
                    out.status = "finished".to_string();
                    break;
                }
            }
        }
        if out.status == "playing" {
            out.line_started_at = Some(now.to_rfc3339());
        } else {
            out.line_started_at = None;
        }
    }

    out.line_index = idx;
    out.line_elapsed_ms = line_elapsed;
    out.elapsed_ms = elapsed_before_line(script, idx).saturating_add(line_elapsed);
    out.duration_ms = script.estimated_duration_ms;
    out.current_chapter_index = chapter_index_for(script, idx);
    out.updated_at = now.to_rfc3339();
    out
}

pub fn control_personal_news(
    state: &PersonalNewsState,
    action: &str,
    loop_enabled: Option<bool>,
    chapter_index: Option<usize>,
) -> PersonalNewsState {
    let mut out = materialize_personal_news(state);
    if let Some(loop_enabled) = loop_enabled {
        out.loop_enabled = loop_enabled;
    }
    let now = now_iso();
    let line_count = out
        .current_script
        .as_ref()
        .map(|s| s.lines.len())
        .unwrap_or(0);

    match action {
        "play" => {
            if line_count > 0 {
                if out.status == "finished" {
                    out.line_index = 0;
                    out.line_elapsed_ms = 0;
                }
                out.status = "playing".to_string();
                out.line_started_at = Some(now.clone());
            }
        }
        "pause" => {
            out.status = "paused".to_string();
            out.line_started_at = None;
        }
        "toggle" => {
            if out.status == "playing" {
                out.status = "paused".to_string();
                out.line_started_at = None;
            } else if line_count > 0 {
                if out.status == "finished" {
                    out.line_index = 0;
                    out.line_elapsed_ms = 0;
                }
                out.status = "playing".to_string();
                out.line_started_at = Some(now.clone());
            }
        }
        "stop" => {
            out.status = "idle".to_string();
            out.line_index = 0;
            out.line_elapsed_ms = 0;
            out.line_started_at = None;
        }
        "restart" => {
            out.status = if line_count > 0 { "playing" } else { "idle" }.to_string();
            out.line_index = 0;
            out.line_elapsed_ms = 0;
            out.line_started_at = (line_count > 0).then(|| now.clone());
        }
        "nextLine" => {
            let requested = out.line_index.saturating_add(1);
            move_to_line(&mut out, requested, &now);
        }
        "previousLine" => {
            let requested = out.line_index.saturating_sub(1);
            move_to_line(&mut out, requested, &now);
        }
        "nextChapter" => move_to_chapter(&mut out, 1, &now),
        "previousChapter" => move_to_chapter(&mut out, -1, &now),
        "setLoop" => {}
        "jumpChapter" => {
            let requested = out
                .current_script
                .as_ref()
                .and_then(|script| chapter_index.and_then(|idx| script.chapters.get(idx)))
                .map(|chapter| chapter.line_index);
            if let Some(requested) = requested {
                move_to_line(&mut out, requested, &now);
            }
        }
        _ => {}
    }

    out = materialize_personal_news(&out);
    out.updated_at = now_iso();
    out
}

fn move_to_line(state: &mut PersonalNewsState, requested: usize, now: &str) {
    let Some(script) = state.current_script.as_ref() else {
        return;
    };
    if script.lines.is_empty() {
        return;
    }
    state.line_index = requested.min(script.lines.len().saturating_sub(1));
    state.line_elapsed_ms = 0;
    state.line_started_at = (state.status == "playing").then(|| now.to_string());
}

fn move_to_chapter(state: &mut PersonalNewsState, delta: i32, now: &str) {
    let Some(script) = state.current_script.as_ref() else {
        return;
    };
    if script.chapters.is_empty() {
        move_to_line(state, 0, now);
        return;
    }
    let current = chapter_index_for(script, state.line_index) as i32;
    let next = (current + delta).clamp(0, script.chapters.len().saturating_sub(1) as i32) as usize;
    move_to_line(state, script.chapters[next].line_index, now);
}

fn script_dirs(data_dir: &Path) -> Vec<PathBuf> {
    let mut dirs = Vec::new();
    dirs.push(data_dir.join(SCRIPT_DIR_NAME));

    if let Ok(cwd) = std::env::current_dir() {
        dirs.push(cwd.join(SCRIPT_DIR_NAME));
        dirs.push(cwd.join("..").join(SCRIPT_DIR_NAME));
        dirs.push(cwd.join("03_companion").join(SCRIPT_DIR_NAME));
    }

    let manifest_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    dirs.push(manifest_dir.join("..").join(SCRIPT_DIR_NAME));

    let mut seen = HashSet::new();
    dirs.into_iter()
        .filter_map(|p| {
            let normalized = p.components().as_path().to_path_buf();
            let key = normalized.to_string_lossy().to_string();
            seen.insert(key).then_some(normalized)
        })
        .collect()
}

fn is_script_file(path: &Path) -> bool {
    path.is_file()
        && path
            .extension()
            .and_then(|s| s.to_str())
            .is_some_and(|ext| matches!(ext.to_ascii_lowercase().as_str(), "txt" | "pnews"))
}

fn parse_script_file(path: &Path) -> Result<PersonalNewsScript, String> {
    let text = std::fs::read_to_string(path).map_err(|e| format!("{}: {}", path.display(), e))?;
    parse_script_text(path, &text)
}

fn parse_script_text(path: &Path, text: &str) -> Result<PersonalNewsScript, String> {
    let file_name = path
        .file_name()
        .and_then(|s| s.to_str())
        .unwrap_or("personal-news.txt")
        .to_string();
    let fallback_title = path
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or("Personal News")
        .to_string();
    let mut title = String::new();
    let mut description: Option<String> = None;
    let mut default_line_ms = DEFAULT_LINE_MS;
    let mut lines = Vec::new();
    let mut chapters = Vec::new();
    let mut supplements = Vec::new();
    let mut sources = Vec::new();
    let mut total_ms = 0u64;
    let mut current_topic: Option<String> = None;
    let mut in_scenario = !text
        .lines()
        .any(|line| line.trim().eq_ignore_ascii_case("## Scenario"));

    for raw in text.lines() {
        let line = raw.trim();
        if line.is_empty() {
            continue;
        }
        if line.starts_with("# Title:") {
            title = line
                .split_once(':')
                .map(|(_, v)| v.trim())
                .unwrap_or("")
                .to_string();
            continue;
        }
        if line.starts_with("# Description:") {
            let value = line.split_once(':').map(|(_, v)| v.trim()).unwrap_or("");
            description = (!value.is_empty()).then(|| value.to_string());
            continue;
        }
        if line.starts_with("# DefaultLineMs:") {
            if let Some(value) = line.split_once(':').map(|(_, v)| v.trim()) {
                default_line_ms = value
                    .parse::<u64>()
                    .unwrap_or(DEFAULT_LINE_MS)
                    .max(MIN_LINE_MS);
            }
            continue;
        }
        if line.starts_with("## ") {
            in_scenario = line[3..].trim().eq_ignore_ascii_case("Scenario");
            continue;
        }
        if line.starts_with('#') || !in_scenario {
            continue;
        }

        if let Some(topic) = bracket_body(line, "Topic") {
            current_topic = Some(topic.trim().to_string());
            chapters.push(PersonalNewsChapter {
                id: format!("chapter_{:03}", chapters.len() + 1),
                title: current_topic.clone().unwrap_or_default(),
                line_index: lines.len(),
                position_ms: total_ms,
            });
            continue;
        }

        if let Some(body) = bracket_body_any(line, &["Supplement", "補足", "Source"]) {
            push_supplement(
                &mut supplements,
                &mut sources,
                &body,
                current_topic.clone(),
                lines.len(),
                chapters.len().saturating_sub(1),
                total_ms,
                DEFAULT_SUPPLEMENT_MS,
            );
            continue;
        }

        if let Some(body) = paren_body(line, "Wait") {
            let duration_ms = parse_seconds_ms(&body).unwrap_or(default_line_ms);
            lines.push(PersonalNewsLine {
                id: format!("line_{:03}", lines.len() + 1),
                kind: "wait".to_string(),
                topic: current_topic.clone(),
                text: "...".to_string(),
                duration_ms,
                source_id: None,
                position_ms: total_ms,
            });
            total_ms = total_ms.saturating_add(duration_ms);
            continue;
        }

        let (text, explicit_ms) = parse_text_line(line);
        // Estimate from the visible characters only (inline supplement markers
        // and their URLs must not inflate the reading time).
        let duration_ms =
            explicit_ms.unwrap_or_else(|| estimate_line_ms(stripped_char_count(&text)));
        let text = extract_inline_supplements(
            &text,
            total_ms,
            duration_ms,
            current_topic.clone(),
            lines.len(),
            chapters.len().saturating_sub(1),
            &mut supplements,
            &mut sources,
        );
        if text.is_empty() {
            continue;
        }
        lines.push(PersonalNewsLine {
            id: format!("line_{:03}", lines.len() + 1),
            kind: "text".to_string(),
            topic: current_topic.clone(),
            text,
            duration_ms,
            source_id: None,
            position_ms: total_ms,
        });
        total_ms = total_ms.saturating_add(duration_ms);
    }

    if lines.is_empty() {
        return Err(format!("{}: no scenario lines", file_name));
    }
    if chapters.is_empty() {
        chapters.push(PersonalNewsChapter {
            id: "chapter_001".to_string(),
            title: "オープニング".to_string(),
            line_index: 0,
            position_ms: 0,
        });
    }
    if title.trim().is_empty() {
        title = fallback_title;
    }

    Ok(PersonalNewsScript {
        id: stable_script_id(&file_name),
        title,
        file_name,
        description,
        chapters,
        lines,
        supplements,
        sources,
        estimated_duration_ms: total_ms,
        modified_at: modified_at(path),
    })
}

fn parse_text_line(line: &str) -> (String, Option<u64>) {
    if let Some(rest) = line.strip_prefix("[Line:") {
        if let Some((duration, text)) = rest.split_once(']') {
            return (text.trim().to_string(), parse_seconds_ms(duration.trim()));
        }
    }
    (line.to_string(), None)
}

fn estimate_line_ms(chars: usize) -> u64 {
    (chars as u64 * CHAR_MS).max(MIN_TEXT_LINE_MS)
}

/// Visible character count with inline supplement markers removed. Mirrors the
/// cleanup in `extract_inline_supplements` so the estimate matches the text the
/// overlay actually renders.
fn stripped_char_count(text: &str) -> usize {
    let mut cleaned = String::new();
    let mut cursor = 0usize;
    while let Some(marker) = find_inline_supplement(text, cursor) {
        cleaned.push_str(&text[cursor..marker.start]);
        cursor = marker.end;
    }
    cleaned.push_str(&text[cursor..]);
    cleaned.trim().chars().count()
}

fn bracket_body(line: &str, tag: &str) -> Option<String> {
    let prefix = format!("[{}:", tag);
    line.strip_prefix(&prefix)
        .and_then(|rest| rest.strip_suffix(']'))
        .map(|s| s.trim().to_string())
}

fn bracket_body_any(line: &str, tags: &[&str]) -> Option<String> {
    tags.iter().find_map(|tag| bracket_body(line, tag))
}

fn paren_body(line: &str, tag: &str) -> Option<String> {
    let prefix = format!("({}:", tag);
    line.strip_prefix(&prefix)
        .and_then(|rest| rest.strip_suffix(')'))
        .map(|s| s.trim().to_string())
}

fn extract_inline_supplements(
    text: &str,
    line_position_ms: u64,
    line_duration_ms: u64,
    topic: Option<String>,
    line_index: usize,
    chapter_index: usize,
    supplements: &mut Vec<PersonalNewsSupplement>,
    sources: &mut Vec<PersonalNewsSource>,
) -> String {
    let mut cleaned = String::new();
    let mut markers: Vec<(usize, String)> = Vec::new();
    let mut cursor = 0usize;
    let mut plain_chars = 0usize;

    while let Some(marker) = find_inline_supplement(text, cursor) {
        let before = &text[cursor..marker.start];
        cleaned.push_str(before);
        plain_chars = plain_chars.saturating_add(before.chars().count());
        markers.push((plain_chars, marker.body));
        cursor = marker.end;
    }

    let rest = &text[cursor..];
    cleaned.push_str(rest);
    let total_chars = cleaned.chars().count().max(1);

    for (chars_before, body) in markers {
        let offset =
            ((line_duration_ms as f64) * (chars_before as f64 / total_chars as f64)).round() as u64;
        push_supplement(
            supplements,
            sources,
            &body,
            topic.clone(),
            line_index,
            chapter_index,
            line_position_ms.saturating_add(offset),
            DEFAULT_SUPPLEMENT_MS,
        );
    }

    cleaned.trim().to_string()
}

struct InlineSupplement {
    start: usize,
    end: usize,
    body: String,
}

fn find_inline_supplement(text: &str, from: usize) -> Option<InlineSupplement> {
    let tags = ["Supplement", "補足", "Source"];
    let (start, prefix_len) = tags
        .iter()
        .filter_map(|tag| {
            let prefix = format!("[{}:", tag);
            text.get(from..)?
                .find(&prefix)
                .map(|offset| (from + offset, prefix.len()))
        })
        .min_by_key(|(start, _)| *start)?;
    let body_start = start + prefix_len;
    let body_end = text
        .get(body_start..)?
        .find(']')
        .map(|offset| body_start + offset)?;
    Some(InlineSupplement {
        start,
        end: body_end + 1,
        body: text[body_start..body_end].trim().to_string(),
    })
}

fn push_supplement(
    supplements: &mut Vec<PersonalNewsSupplement>,
    sources: &mut Vec<PersonalNewsSource>,
    body: &str,
    topic: Option<String>,
    line_index: usize,
    chapter_index: usize,
    position_ms: u64,
    default_duration_ms: u64,
) {
    let Some(parsed) = parse_supplement_body(body, default_duration_ms) else {
        return;
    };
    let id = format!("supplement_{:03}", supplements.len() + 1);
    if let Some(url) = parsed.url.as_ref() {
        sources.push(PersonalNewsSource {
            id: format!("source_{:03}", sources.len() + 1),
            title: parsed.title.clone(),
            url: url.clone(),
            line_index,
            chapter_index,
            position_ms,
        });
    }
    supplements.push(PersonalNewsSupplement {
        id,
        title: topic
            .as_ref()
            .map(|t| format!("{} / {}", t, parsed.title))
            .unwrap_or_else(|| parsed.title.clone()),
        text: parsed.text,
        url: parsed.url,
        line_index,
        chapter_index,
        position_ms,
        duration_ms: parsed.duration_ms.max(MIN_LINE_MS),
    });
}

fn parse_supplement_body(body: &str, default_duration_ms: u64) -> Option<ParsedSupplement> {
    let mut parts = body
        .split('|')
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(ToString::to_string)
        .collect::<Vec<_>>();
    if parts.is_empty() {
        return None;
    }

    let mut duration_ms = default_duration_ms.max(MIN_LINE_MS);
    if let Some(ms) = parts.first().and_then(|part| parse_seconds_ms(part)) {
        duration_ms = ms;
        parts.remove(0);
    } else if let Some(ms) = parts.last().and_then(|part| parse_seconds_ms(part)) {
        duration_ms = ms;
        parts.pop();
    }

    let url = parts
        .iter()
        .position(|part| is_url(part))
        .map(|idx| parts.remove(idx));
    let text = parts.join(" / ").trim().to_string();
    let text = if text.is_empty() {
        url.clone().unwrap_or_default()
    } else {
        text
    };
    if text.trim().is_empty() {
        return None;
    }

    Some(ParsedSupplement {
        title: text.clone(),
        text,
        url,
        duration_ms,
    })
}

fn is_url(value: &str) -> bool {
    let lower = value.trim().to_ascii_lowercase();
    lower.starts_with("https://") || lower.starts_with("http://")
}

fn parse_seconds_ms(value: &str) -> Option<u64> {
    value
        .trim()
        .parse::<f64>()
        .ok()
        .map(|seconds| (seconds.max(0.1) * 1000.0).round() as u64)
}

fn summary_for(script: &PersonalNewsScript) -> PersonalNewsScriptSummary {
    PersonalNewsScriptSummary {
        id: script.id.clone(),
        title: script.title.clone(),
        file_name: script.file_name.clone(),
        description: script.description.clone(),
        chapter_count: script.chapters.len(),
        line_count: script.lines.len(),
        source_count: script.sources.len(),
        supplement_count: script.supplements.len(),
        estimated_duration_ms: script.estimated_duration_ms,
        modified_at: script.modified_at.clone(),
    }
}

fn stable_script_id(file_name: &str) -> String {
    file_name
        .chars()
        .map(|c| {
            if c.is_ascii_alphanumeric() {
                c.to_ascii_lowercase()
            } else {
                '-'
            }
        })
        .collect::<String>()
        .split('-')
        .filter(|s| !s.is_empty())
        .collect::<Vec<_>>()
        .join("-")
}

fn modified_at(path: &Path) -> Option<String> {
    let modified = std::fs::metadata(path).ok()?.modified().ok()?;
    Some(system_time_to_iso(modified))
}

fn system_time_to_iso(time: SystemTime) -> String {
    let dt: DateTime<Utc> = time.into();
    dt.to_rfc3339()
}

fn elapsed_before_line(script: &PersonalNewsScript, line_index: usize) -> u64 {
    script
        .lines
        .iter()
        .take(line_index)
        .fold(0u64, |sum, line| sum.saturating_add(line.duration_ms))
}

fn chapter_index_for(script: &PersonalNewsScript, line_index: usize) -> usize {
    script
        .chapters
        .iter()
        .enumerate()
        .take_while(|(_, chapter)| chapter.line_index <= line_index)
        .map(|(idx, _)| idx)
        .last()
        .unwrap_or(0)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sample_script() -> PersonalNewsScript {
        parse_script_text(
            Path::new("sample-news.txt"),
            r#"# Title: Sample Personal News
# Description: Demo script
# DefaultLineMs: 9000

## Scenario
[Topic: 01 Opening]
[Line: 7.5] First line. [Supplement: Inline note | 2.5]
[Source: Example Source | https://example.com/article | 4.0]
(Wait: 1.5)
[Topic: 02 Second]
Plain second line.
"#,
        )
        .expect("sample script parses")
    }

    #[test]
    fn parses_topic_source_and_timed_lines() {
        let script = sample_script();

        assert_eq!(script.title, "Sample Personal News");
        assert_eq!(script.chapters.len(), 2);
        assert_eq!(script.sources.len(), 1);
        assert_eq!(script.supplements.len(), 2);
        assert_eq!(script.lines.len(), 3);
        assert_eq!(script.lines[0].duration_ms, 7_500);
        assert_eq!(script.lines[0].text, "First line.");
        assert_eq!(script.lines[1].kind, "wait");
        // "Plain second line." has no [Line:] so it is timed from its 18 visible
        // chars (18 × CHAR_MS = 3240ms), not the legacy flat default.
        assert_eq!(script.lines[2].duration_ms, 3_240);
        assert_eq!(script.supplements[0].text, "Inline note");
        assert!(script.supplements[0].position_ms > 0);
        assert_eq!(
            script.supplements[1].url.as_deref(),
            Some("https://example.com/article")
        );
        assert_eq!(script.estimated_duration_ms, 12_240);
    }

    #[test]
    fn plain_line_duration_scales_with_length_and_ignores_markers() {
        let script = parse_script_text(
            Path::new("prose.txt"),
            r#"## Scenario
short
This is a much longer plain line that should take proportionally more time to read.
with marker [Supplement: note | https://example.com/very/long/url/that/should/not/count | 3.0] tail
"#,
        )
        .expect("prose script parses");

        // 5 chars → floor of 2s applies.
        assert_eq!(script.lines[0].duration_ms, MIN_TEXT_LINE_MS);
        // Long lines get proportionally more time (chars × CHAR_MS).
        let long_chars = script.lines[1].text.chars().count() as u64;
        assert_eq!(script.lines[1].duration_ms, long_chars * CHAR_MS);
        assert!(script.lines[1].duration_ms > 4 * MIN_TEXT_LINE_MS);
        // Marker body/URL is stripped before counting: only "with marker" + "tail"
        // remain visible, so the URL must not inflate the duration.
        let visible_chars = script.lines[2].text.chars().count() as u64;
        assert_eq!(script.lines[2].duration_ms, visible_chars * CHAR_MS);
        assert!(script.lines[2].duration_ms < script.lines[1].duration_ms / 3);
        assert_eq!(script.supplements.len(), 1);
    }

    #[test]
    fn control_can_toggle_loop_and_jump_chapters() {
        let script = sample_script();
        let state = PersonalNewsState {
            scripts: vec![summary_for(&script)],
            current_script: Some(script),
            selected_script_id: Some("sample-news-txt".to_string()),
            duration_ms: 12_240,
            ..PersonalNewsState::default()
        };

        let playing = control_personal_news(&state, "play", None, None);
        assert_eq!(playing.status, "playing");

        let looped = control_personal_news(&playing, "setLoop", Some(true), None);
        assert!(looped.loop_enabled);

        let jumped = control_personal_news(&looped, "jumpChapter", None, Some(1));
        assert_eq!(jumped.line_index, 2);
        assert_eq!(jumped.current_chapter_index, 1);
    }

    #[test]
    fn bundled_trial_script_stays_close_to_five_minutes() {
        let path = Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("..")
            .join(SCRIPT_DIR_NAME)
            .join("2026-07-05_俺流興味ニュース.txt");
        let script = parse_script_file(&path).expect("bundled trial script parses");

        assert_eq!(script.chapters.len(), 6);
        assert_eq!(script.sources.len(), 7);
        assert_eq!(script.supplements.len(), 7);
        assert!(script.estimated_duration_ms >= 250_000);
        assert!(script.estimated_duration_ms <= 300_000);
    }

    #[test]
    fn bundled_scripts_all_parse() {
        let dir = Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("..")
            .join(SCRIPT_DIR_NAME);
        let mut parsed = 0usize;

        for entry in std::fs::read_dir(&dir).expect("bundled script directory exists") {
            let path = entry.expect("script entry").path();
            if !is_script_file(&path) {
                continue;
            }
            let script = parse_script_file(&path).expect("bundled script parses");
            assert!(!script.title.trim().is_empty());
            assert!(!script.lines.is_empty());
            parsed += 1;
        }

        assert!(parsed >= 5);
    }
}

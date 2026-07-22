//! System-output PCM capture for the production BeatRoot BPM path.
//!
//! Wallpaper Engine exposes only 128 FFT bands, not waveform samples.  The
//! Companion therefore captures the Windows default render endpoint through
//! WASAPI loopback, downmixes it to 11,025 Hz mono i16, and keeps a short
//! sequence-numbered ring buffer for the overlay to poll over localhost.

use base64::{engine::general_purpose::STANDARD as BASE64, Engine as _};
use serde::Serialize;
use std::{
    collections::VecDeque,
    sync::{Arc, Mutex},
    thread,
    time::{Duration, Instant},
};

pub const PCM_SAMPLE_RATE: u32 = 11_025;
const CAPTURE_SAMPLE_RATE: u32 = 44_100;
const CAPTURE_CHANNELS: usize = 2;
const DOWNSAMPLE_FACTOR: usize = (CAPTURE_SAMPLE_RATE / PCM_SAMPLE_RATE) as usize;
const MAX_BUFFER_SECONDS: usize = 30;
const MAX_RESPONSE_SECONDS: usize = 2;
const DEVICE_CHECK_INTERVAL: Duration = Duration::from_millis(500);
const RECONNECT_DELAY: Duration = Duration::from_millis(750);

#[derive(Debug)]
pub struct PcmCaptureState {
    pub status: String,
    pub error: Option<String>,
    samples: VecDeque<i16>,
    base_seq: u64,
    next_seq: u64,
    pub reset_generation: u64,
    pub reset_reason: String,
    pub reset_at: String,
}

pub type SharedPcmCapture = Arc<Mutex<PcmCaptureState>>;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PcmChunkResponse {
    pub status: String,
    pub sample_rate: u32,
    pub from: u64,
    pub to: u64,
    pub reset_generation: u64,
    pub reset_reason: String,
    pub reset_at: String,
    pub samples_b64: String,
    pub error: Option<String>,
}

impl Default for PcmCaptureState {
    fn default() -> Self {
        Self {
            status: "starting".into(),
            error: None,
            samples: VecDeque::with_capacity(PCM_SAMPLE_RATE as usize * MAX_BUFFER_SECONDS),
            base_seq: 0,
            next_seq: 0,
            reset_generation: 0,
            reset_reason: "startup".into(),
            reset_at: crate::models::now_iso(),
        }
    }
}

impl PcmCaptureState {
    fn append(&mut self, values: &[i16]) {
        if values.is_empty() {
            return;
        }
        self.status = "running".into();
        self.error = None;
        self.samples.extend(values.iter().copied());
        self.next_seq = self.next_seq.saturating_add(values.len() as u64);
        let max_samples = PCM_SAMPLE_RATE as usize * MAX_BUFFER_SECONDS;
        while self.samples.len() > max_samples {
            self.samples.pop_front();
            self.base_seq = self.base_seq.saturating_add(1);
        }
    }

    pub fn request_reset(&mut self, reason: impl Into<String>) {
        self.samples.clear();
        self.base_seq = self.next_seq;
        self.reset_generation = self.reset_generation.saturating_add(1);
        self.reset_reason = reason.into();
        self.reset_at = crate::models::now_iso();
    }

    fn mark_reconnecting(&mut self, error: String) {
        // Reset BeatRoot history only once per outage. Repeated attempts while
        // an endpoint is absent must not advance the generation every 750 ms.
        if self.status != "reconnecting" {
            self.request_reset("audio-device-reconnect");
        }
        self.status = "reconnecting".into();
        self.error = Some(error);
    }

    pub fn chunk_after(&self, after: u64) -> PcmChunkResponse {
        let from = after.max(self.base_seq).min(self.next_seq);
        let available = self.next_seq.saturating_sub(from) as usize;
        let take = available.min(PCM_SAMPLE_RATE as usize * MAX_RESPONSE_SECONDS);
        let skip = from.saturating_sub(self.base_seq) as usize;
        let mut bytes = Vec::with_capacity(take * 2);
        for sample in self.samples.iter().skip(skip).take(take) {
            bytes.extend_from_slice(&sample.to_le_bytes());
        }
        PcmChunkResponse {
            status: self.status.clone(),
            sample_rate: PCM_SAMPLE_RATE,
            from,
            to: from.saturating_add(take as u64),
            reset_generation: self.reset_generation,
            reset_reason: self.reset_reason.clone(),
            reset_at: self.reset_at.clone(),
            samples_b64: BASE64.encode(bytes),
            error: self.error.clone(),
        }
    }
}

pub fn new_shared() -> SharedPcmCapture {
    Arc::new(Mutex::new(PcmCaptureState::default()))
}

/// Spawn a self-healing WASAPI loopback thread. Device changes and temporary
/// initialization failures are retried instead of permanently disabling BPM.
pub fn spawn(shared: SharedPcmCapture) {
    let _ = thread::Builder::new()
        .name("kiritan-pcm-loopback".into())
        .spawn(move || loop {
            if let Err(error) = capture_once(&shared) {
                let mut state = shared.lock().unwrap();
                state.mark_reconnecting(error);
            }
            thread::sleep(RECONNECT_DELAY);
        });
}

#[cfg(target_os = "windows")]
fn capture_once(shared: &SharedPcmCapture) -> Result<(), String> {
    use wasapi::{
        initialize_mta, DeviceEnumerator, DeviceState, Direction, SampleType, StreamMode,
        WasapiError, WaveFormat,
    };

    initialize_mta()
        .ok()
        .map_err(|error| format!("WASAPI COM initialization failed: {error}"))?;
    let enumerator = DeviceEnumerator::new().map_err(|error| error.to_string())?;
    let device = enumerator
        .get_default_device(&Direction::Render)
        .map_err(|error| format!("default output device unavailable: {error}"))?;
    let active_device_id = device
        .get_id()
        .map_err(|error| format!("default output device ID unavailable: {error}"))?;
    let mut audio_client = device
        .get_iaudioclient()
        .map_err(|error| error.to_string())?;
    let format = WaveFormat::new(
        32,
        32,
        &SampleType::Float,
        CAPTURE_SAMPLE_RATE as usize,
        CAPTURE_CHANNELS,
        None,
    );
    let (_, min_period) = audio_client
        .get_device_period()
        .map_err(|error| error.to_string())?;
    let mode = StreamMode::EventsShared {
        autoconvert: true,
        buffer_duration_hns: min_period,
    };
    audio_client
        .initialize_client(&format, &Direction::Capture, &mode)
        .map_err(|error| format!("loopback initialization failed: {error}"))?;
    let event = audio_client
        .set_get_eventhandle()
        .map_err(|error| error.to_string())?;
    let capture = audio_client
        .get_audiocaptureclient()
        .map_err(|error| error.to_string())?;
    let mut bytes = VecDeque::<u8>::new();
    let mut downsample_sum = 0.0f32;
    let mut downsample_count = 0usize;
    let mut next_device_check = Instant::now() + DEVICE_CHECK_INTERVAL;
    audio_client
        .start_stream()
        .map_err(|error| error.to_string())?;
    {
        let mut state = shared.lock().unwrap();
        state.status = "running".into();
        state.error = None;
    }

    loop {
        // A jack/Bluetooth switch may leave the old endpoint alive and
        // delivering valid silence forever. WASAPI then raises no read error,
        // so explicitly compare the active endpoint with Windows' current
        // default render endpoint at a short interval.
        if Instant::now() >= next_device_check {
            let device_state = device
                .get_state()
                .map_err(|error| format!("output device state unavailable: {error}"))?;
            if device_state != DeviceState::Active {
                return Err(format!("output device became {device_state}; reconnecting"));
            }
            let current_default = enumerator
                .get_default_device(&Direction::Render)
                .map_err(|error| format!("default output device unavailable: {error}"))?;
            let current_device_id = current_default
                .get_id()
                .map_err(|error| format!("default output device ID unavailable: {error}"))?;
            if current_device_id != active_device_id {
                return Err("default output device changed; reconnecting".into());
            }
            next_device_check = Instant::now() + DEVICE_CHECK_INTERVAL;
        }

        capture
            .read_from_device_to_deque(&mut bytes)
            .map_err(|error| format!("loopback read failed: {error}"))?;
        let complete_frames = bytes.len() / (CAPTURE_CHANNELS * std::mem::size_of::<f32>());
        let mut output = Vec::with_capacity(complete_frames / DOWNSAMPLE_FACTOR + 1);
        for _ in 0..complete_frames {
            let mut mono = 0.0f32;
            for _ in 0..CAPTURE_CHANNELS {
                let raw = [
                    bytes.pop_front().unwrap(),
                    bytes.pop_front().unwrap(),
                    bytes.pop_front().unwrap(),
                    bytes.pop_front().unwrap(),
                ];
                mono += f32::from_le_bytes(raw);
            }
            downsample_sum += mono / CAPTURE_CHANNELS as f32;
            downsample_count += 1;
            if downsample_count == DOWNSAMPLE_FACTOR {
                let sample = (downsample_sum / DOWNSAMPLE_FACTOR as f32).clamp(-1.0, 1.0);
                output.push((sample * i16::MAX as f32).round() as i16);
                downsample_sum = 0.0;
                downsample_count = 0;
            }
        }
        if !output.is_empty() {
            shared.lock().unwrap().append(&output);
        }
        match event.wait_for_event(DEVICE_CHECK_INTERVAL.as_millis() as u32) {
            Ok(()) | Err(WasapiError::EventTimeout) => {}
            Err(error) => return Err(format!("loopback event failed: {error}")),
        }
    }
}

#[cfg(not(target_os = "windows"))]
fn capture_once(_shared: &SharedPcmCapture) -> Result<(), String> {
    Err("PCM loopback is available only on Windows".into())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reset_discards_old_pcm_and_advances_generation() {
        let mut state = PcmCaptureState::default();
        state.append(&[1, 2, 3]);
        assert_eq!(state.chunk_after(0).to, 3);
        state.request_reset("manual");
        let chunk = state.chunk_after(0);
        assert_eq!(chunk.from, 3);
        assert_eq!(chunk.to, 3);
        assert_eq!(chunk.reset_generation, 1);
        assert_eq!(chunk.reset_reason, "manual");
    }

    #[test]
    fn reconnect_resets_history_once_per_outage() {
        let mut state = PcmCaptureState::default();
        state.append(&[1, 2, 3]);
        state.mark_reconnecting("device changed".into());
        let first_generation = state.reset_generation;
        assert_eq!(state.status, "reconnecting");
        assert_eq!(state.reset_reason, "audio-device-reconnect");
        assert_eq!(state.chunk_after(0).to, 3);

        state.mark_reconnecting("device still absent".into());
        assert_eq!(state.reset_generation, first_generation);

        state.append(&[4, 5]);
        state.mark_reconnecting("another device change".into());
        assert_eq!(state.reset_generation, first_generation + 1);
        assert_eq!(state.chunk_after(0).from, 5);
    }

    /// Hardware smoke test, run explicitly on Windows with:
    /// `cargo test pcm_loopback_initializes_on_this_machine -- --ignored`
    #[test]
    #[ignore]
    fn pcm_loopback_initializes_on_this_machine() {
        let shared = new_shared();
        spawn(shared.clone());
        std::thread::sleep(Duration::from_secs(3));
        let chunk = shared.lock().unwrap().chunk_after(0);
        assert_eq!(chunk.status, "running", "{:?}", chunk.error);
        assert!(chunk.to > chunk.from, "WASAPI produced no PCM samples");
    }
}

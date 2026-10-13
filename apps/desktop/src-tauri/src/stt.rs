//! Companion-service supervisor (ADR-002): on-demand start of the
//! proven `whisper-server` runtime, warm retention, idle unload that
//! never fires mid-take, crash recovery, GPU-first backend reporting,
//! and honest model-presence reporting. Never stops a server instance
//! it did not start.

use std::path::PathBuf;
use std::process::{Child, Command, Stdio};
use std::sync::Mutex;
use std::time::{Duration, Instant};

use serde::Serialize;
use tauri::{AppHandle, Manager};

use crate::pipeline::{current_phase, set_last_text, set_phase, Phase};
use crate::settings::language_of;
use crate::stt_shared::{
    detect_backend, load_wav_mono_f32, multipart_body, normalize_gain, parse_transcript,
    resample_linear, Backend, ENGINE_SAMPLE_RATE, INFERENCE_PATH, OPENAI_FALLBACK_PATH,
};

/// Proven idle-unload period: ten minutes, never while a take is live.
pub const IDLE_UNLOAD_SECS: u64 = 600;
/// whisperlane's own port; the paired plugin defaults to 8801.
pub const DEFAULT_PORT: u16 = 8811;
const MAX_CONSECUTIVE_CRASHES: u32 = 3;
const START_TIMEOUT: Duration = Duration::from_secs(240);
const TRANSCRIBE_TIMEOUT: u64 = 300;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum ServiceState {
    Unloaded,
    Starting,
    Ready,
    Failed,
}

#[derive(Debug, Clone, Serialize)]
pub struct SttStatus {
    pub model_file: String,
    pub model_present: bool,
    pub backend: String,
    pub service: ServiceState,
    pub detail: Option<String>,
}

pub(crate) struct SttInner {
    child: Option<Child>,
    port: Option<u16>,
    starting: bool,
    active_requests: u32,
    last_use: Option<Instant>,
    consecutive_crashes: u32,
    last_error: Option<String>,
    model_missing: bool,
    reload_pending: bool,
}

impl Default for SttInner {
    fn default() -> Self {
        Self {
            child: None,
            port: None,
            starting: false,
            active_requests: 0,
            last_use: None,
            consecutive_crashes: 0,
            last_error: None,
            model_missing: false,
            reload_pending: false,
        }
    }
}

pub struct SttState(pub(crate) Mutex<SttInner>);

impl Default for SttState {
    fn default() -> Self {
        Self(Mutex::new(SttInner::default()))
    }
}

pub fn app_dir(app: &AppHandle) -> Result<PathBuf, String> {
    app.path()
        .app_data_dir()
        .map_err(|e| format!("could not resolve data dir: {e:?}"))
}

pub fn runtime_dir(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(app_dir(app)?.join("runtime"))
}

/// The model file the chosen model resolves to on disk.
fn model_path(app: &AppHandle) -> Result<PathBuf, String> {
    crate::models::model_path(app, crate::settings::model_of(app))
}

fn server_bin(app: &AppHandle) -> Result<PathBuf, String> {
    let bin = runtime_dir(app)?.join("whisper-server.exe");
    if bin.is_file() {
        Ok(bin)
    } else {
        Err(format!(
            "transcription runtime missing at {} — reinstall or copy the runtime dir",
            bin.display()
        ))
    }
}

pub fn backend_of(dir: &PathBuf) -> Backend {
    let names: Vec<String> = std::fs::read_dir(dir)
        .map(|rd| {
            rd.filter_map(|e| e.ok())
                .map(|e| e.file_name().to_string_lossy().into_owned())
                .collect()
        })
        .unwrap_or_default();
    let refs: Vec<&str> = names.iter().map(|s| s.as_str()).collect();
    detect_backend(&refs)
}

fn child_alive(child: &mut Child) -> bool {
    matches!(child.try_wait(), Ok(None))
}

/// Pure idle decision, unit-tested: unload only when warm, unused,
/// long idle, and no take in flight.
pub fn should_unload(
    has_child: bool,
    active_requests: u32,
    listening_now: bool,
    idle_secs: u64,
) -> bool {
    has_child && active_requests == 0 && !listening_now && idle_secs >= IDLE_UNLOAD_SECS
}

fn ping(port: u16) -> bool {
    ureq::get(&format!("http://127.0.0.1:{port}/"))
        .timeout(Duration::from_millis(1500))
        .call()
        .is_ok()
}

/// Picks the default port, falling back to an OS-assigned free one so a
/// second instance never collides with a running server it does not own.
fn pick_port() -> u16 {
    if std::net::TcpListener::bind(("127.0.0.1", DEFAULT_PORT)).is_ok() {
        return DEFAULT_PORT;
    }
    std::net::TcpListener::bind(("127.0.0.1", 0))
        .and_then(|l| l.local_addr())
        .map(|a| a.port())
        .unwrap_or(DEFAULT_PORT)
}

/// Ensures a live service, spawning on demand. Returns its port.
/// Never spawns when the model is missing: that is a Missing report,
/// not a crash loop (model download arrives in M1).
pub fn ensure_ready(app: &AppHandle) -> Result<u16, String> {
    let chosen = crate::settings::model_of(app);
    let model = model_path(app)?;
    if !model.is_file() {
        let msg = format!(
            "model missing: {} — download it in settings",
            chosen.file
        );
        if let Some(state) = app.try_state::<SttState>() {
            let mut inner = state.0.lock().expect("stt state poisoned");
            inner.model_missing = true;
            inner.last_error = Some(msg.clone());
        }
        return Err(msg);
    }
    // Fast path: live child.
    {
        let state = app
            .try_state::<SttState>()
            .ok_or_else(|| "stt state missing".to_string())?;
        let mut inner = state.0.lock().expect("stt state poisoned");
        if let Some(child) = inner.child.as_mut() {
            if child_alive(child) {
                inner.last_use = Some(Instant::now());
                return inner.port.ok_or_else(|| "service port unknown".to_string());
            }
            // Unexpected exit: crash recovery counts it, then respawns below.
            let _ = child.wait();
            inner.child = None;
            inner.port = None;
            inner.consecutive_crashes += 1;
            if inner.consecutive_crashes > MAX_CONSECUTIVE_CRASHES {
                let msg = "transcription service keeps crashing".to_string();
                inner.last_error = Some(msg.clone());
                return Err(msg);
            }
            inner.starting = true;
        } else {
            inner.starting = true;
        }
    }
    // Spawn and wait for the ping.
    let bin = server_bin(app)?;
    let port = pick_port();
    let mut child = Command::new(bin)
        .arg("--model")
        .arg(&model)
        .arg("--host")
        .arg("127.0.0.1")
        .arg("--port")
        .arg(port.to_string())
        .arg("--language")
        .arg(language_of(app).code())
        .current_dir(runtime_dir(app)?)
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|e| {
            mark_start_failed(app, format!("could not start transcription service: {e}"));
            format!("could not start transcription service: {e}")
        })?;
    let deadline = Instant::now() + START_TIMEOUT;
    let mut ready = false;
    while Instant::now() < deadline {
        if let Ok(Some(_)) = child.try_wait() {
            break; // Exited early: failed start, reported below.
        }
        if ping(port) {
            ready = true;
            break;
        }
        std::thread::sleep(Duration::from_millis(500));
    }
    if !ready {
        let _ = child.kill();
        let _ = child.wait();
        mark_start_failed(app, "transcription service did not become ready".to_string());
        return Err("transcription service did not become ready".to_string());
    }
    let state = app
        .try_state::<SttState>()
        .ok_or_else(|| "stt state missing".to_string())?;
    let mut inner = state.0.lock().expect("stt state poisoned");
    inner.child = Some(child);
    inner.port = Some(port);
    inner.starting = false;
    inner.last_use = Some(Instant::now());
    inner.consecutive_crashes = 0;
    inner.last_error = None;
    inner.model_missing = false;
    Ok(port)
}

fn mark_start_failed(app: &AppHandle, msg: String) {
    if let Some(state) = app.try_state::<SttState>() {
        let mut inner = state.0.lock().expect("stt state poisoned");
        inner.starting = false;
        inner.last_error = Some(msg);
    }
}

fn stop_locked(inner: &mut SttInner) {
    if let Some(mut child) = inner.child.take() {
        let _ = child.kill();
        let _ = child.wait();
    }
    inner.port = None;
}

/// Pure reload decision, unit-tested: a setting change never kills a
/// live request, it waits for the take to finish.
pub fn reload_now(active_requests: u32) -> bool {
    active_requests == 0
}

/// Drops the loaded service so the next take starts it with current
/// settings. Used when a setting the service was launched with changes.
pub fn reload(app: &AppHandle) {
    if let Some(state) = app.try_state::<SttState>() {
        let mut inner = state.0.lock().expect("stt state poisoned");
        if !reload_now(inner.active_requests) {
            inner.reload_pending = true;
            return;
        }
        stop_locked(&mut inner);
        inner.starting = false;
    }
}

/// Idle sweeper body, called on a timer. Unloads only when no take is
/// live: never mid-recording, never mid-transcription.
pub fn sweep_idle(app: &AppHandle) {
    let listening = matches!(current_phase(app), Some(Phase::Listening));
    let state = match app.try_state::<SttState>() {
        Some(s) => s,
        None => return,
    };
    let mut inner = state.0.lock().expect("stt state poisoned");
    let idle_secs = inner.last_use.map(|t| t.elapsed().as_secs()).unwrap_or(0);
    if should_unload(inner.child.is_some(), inner.active_requests, listening, idle_secs) {
        stop_locked(&mut inner);
    }
}

/// Transcribes a stored take on a worker thread. Only moves Thinking to
/// Done; anything else fails loudly with the cause preserved.
pub fn transcribe_take(app: AppHandle, wav_path: String) {
    std::thread::spawn(move || {
        let port = match ensure_ready(&app) {
            Ok(p) => p,
            Err(detail) => {
                set_phase(&app, Phase::Failed, Some(detail));
                return;
            }
        };
        {
            if let Some(state) = app.try_state::<SttState>() {
                state.0.lock().expect("stt state poisoned").active_requests += 1;
            }
        }
        let result = transcribe_call(port, &wav_path, language_of(&app).code());
        {
            if let Some(state) = app.try_state::<SttState>() {
                let mut inner = state.0.lock().expect("stt state poisoned");
                inner.active_requests = inner.active_requests.saturating_sub(1);
                inner.last_use = Some(Instant::now());
                // A deferred reload lands now that the request is done.
                if inner.reload_pending && reload_now(inner.active_requests) {
                    inner.reload_pending = false;
                    stop_locked(&mut inner);
                }
            }
        }
        match result {
            Ok(text) => {
                // A take cancelled or reset while transcribing lands
                // nothing: no text, no delivery, no clipboard.
                if current_phase(&app) != Some(Phase::Thinking) {
                    return;
                }
                if text.is_empty() {
                    set_phase(
                        &app,
                        Phase::Failed,
                        Some("nothing recognized — try again".to_string()),
                    );
                } else {
                    set_last_text(&app, text);
                    set_phase(&app, Phase::Done, None);
                    crate::insert::deliver(&app);
                }
            }
            Err(detail) => {
                // Same guard: a failure must not resurrect a take the
                // user already discarded.
                if current_phase(&app) == Some(Phase::Thinking) {
                    set_phase(&app, Phase::Failed, Some(detail));
                }
            }
        }
    });
}

/// Loads the take, lifts quiet input toward a healthy level, and posts
/// it to the service: primary endpoint first, OpenAI-compatible fallback.
/// The language comes from settings, so one take never mixes languages.
fn transcribe_call(port: u16, wav_path: &str, language: &str) -> Result<String, String> {
    let (pcm, rate) = load_wav_mono_f32(std::path::Path::new(wav_path))?;
    let mut pcm = resample_linear(&pcm, rate, ENGINE_SAMPLE_RATE);
    normalize_gain(&mut pcm);
    let mut wav = Vec::new();
    {
        let spec = hound::WavSpec {
            channels: 1,
            sample_rate: ENGINE_SAMPLE_RATE,
            bits_per_sample: 16,
            sample_format: hound::SampleFormat::Int,
        };
        let mut writer =
            hound::WavWriter::new(std::io::Cursor::new(&mut wav), spec).map_err(|e| e.to_string())?;
        for &s in &pcm {
            writer
                .write_sample((s.clamp(-1.0, 1.0) * i16::MAX as f32) as i16)
                .map_err(|e| e.to_string())?;
        }
        writer.finalize().map_err(|e| e.to_string())?;
    }
    let boundary = "whisperlane-take";
    let body = multipart_body(boundary, &wav, language);
    for path in [INFERENCE_PATH, OPENAI_FALLBACK_PATH] {
        let url = format!("http://127.0.0.1:{port}{path}");
        match ureq::post(&url)
            .timeout(Duration::from_secs(TRANSCRIBE_TIMEOUT))
            .set("Content-Type", &format!("multipart/form-data; boundary={boundary}"))
            .send_bytes(&body)
        {
            Ok(resp) => {
                if resp.status() == 404 && path == INFERENCE_PATH {
                    continue;
                }
                let text = resp.into_string().map_err(|e| format!("bad transcription response: {e}"))?;
                return parse_transcript(&text);
            }
            Err(ureq::Error::Status(404, _)) if path == INFERENCE_PATH => continue,
            Err(e) => return Err(format!("transcription request failed: {e}")),
        }
    }
    Err("transcription endpoints unavailable".to_string())
}

#[tauri::command]
pub fn get_stt_status(app: AppHandle) -> SttStatus {
    let chosen = crate::settings::model_of(&app);
    let model_present = model_path(&app).map(|p| p.is_file()).unwrap_or(false);
    let backend = runtime_dir(&app).map(|d| backend_of(&d)).unwrap_or(Backend::Cpu);
    let (service, detail) = match app.try_state::<SttState>() {
        Some(state) => {
            let mut inner = state.0.lock().expect("stt state poisoned");
            let alive = inner.child.as_mut().is_some_and(|c| child_alive(c));
            let svc = if inner
                .last_error
                .as_ref()
                .is_some_and(|e| e.contains("keeps crashing"))
            {
                ServiceState::Failed
            } else if alive {
                ServiceState::Ready
            } else if inner.starting {
                ServiceState::Starting
            } else {
                ServiceState::Unloaded
            };
            (svc, inner.last_error.clone())
        }
        None => (ServiceState::Unloaded, None),
    };
    SttStatus {
        model_file: chosen.file.to_string(),
        model_present,
        backend: backend.as_str().to_string(),
        service,
        detail,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn unloads_only_when_warm_idle_and_free() {
        assert!(should_unload(true, 0, false, IDLE_UNLOAD_SECS));
        assert!(should_unload(true, 0, false, IDLE_UNLOAD_SECS + 999));
        assert!(!should_unload(false, 0, false, IDLE_UNLOAD_SECS + 999));
        assert!(!should_unload(true, 1, false, IDLE_UNLOAD_SECS + 999));
        assert!(!should_unload(true, 0, true, IDLE_UNLOAD_SECS + 999));
        assert!(!should_unload(true, 0, false, IDLE_UNLOAD_SECS - 1));
    }

    #[test]
    fn reload_waits_for_live_requests() {
        assert!(reload_now(0));
        assert!(!reload_now(1));
        assert!(!reload_now(2));
    }
}

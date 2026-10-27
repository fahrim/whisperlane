//! Companion-service supervisor (ADR-002): on-demand start of the
//! proven `whisper-server` runtime, warm retention, idle unload that
//! never fires mid-take, crash recovery, GPU-first backend reporting,
//! and honest model-presence reporting. Never stops a server instance
//! it did not start.

use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::Mutex;
use std::time::{Duration, Instant};

use std::io::Read;

use serde::Serialize;
use tauri::{AppHandle, Manager};

use crate::pipeline::{current_phase, set_last_text, set_phase, Phase};
use crate::settings::language_of;
use crate::stt_shared::{
    detect_backend, load_wav_mono_f32, multipart_body, normalize_gain, parse_transcript,
    resample_linear, Backend, ENGINE_SAMPLE_RATE, INFERENCE_PATH, OPENAI_FALLBACK_PATH,
};

// Windows-only on purpose. This is the flag that decides whether the
// engine is allowed to take the screen, and the product ships as a
// Windows application; naming it unconditionally makes the assumption
// loud on any other platform rather than quietly dropping the flag and
// bringing the bug back.
use std::os::windows::process::CommandExt;

/// `CREATE_NO_WINDOW`: start a console program without giving it a window.
///
/// whisper-server is a console application. Started from one that has no
/// console of its own, Windows allocates a fresh one — and that window
/// takes focus, so a dictation lands in the engine's own command prompt
/// instead of the application the user was writing in. The engine's
/// output is read through a pipe either way; nothing needs a window.
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

/// A command that starts the engine in the background.
///
/// Both the probe and the real service go through here: the probe runs
/// on every launch, so leaving it out of one place means the window
/// still appears — just later, and only on the first take.
fn engine_command(bin: &Path) -> Command {
    let mut command = Command::new(bin);
    command.creation_flags(CREATE_NO_WINDOW);
    command
}

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
    /// Whether the backend above came from a real launch rather than
    /// from the runtime directory's contents.
    pub backend_verified: bool,
    pub service: ServiceState,
    pub detail: Option<String>,
}

#[derive(Default)]
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
    /// Backend a real launch loaded, probed once and remembered: the
    /// answer cannot change without the machine or the runtime
    /// changing, and the probe is far too slow for a status poll.
    verified_backend: Option<Backend>,
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

/// The runtime as it was installed, next to the executable.
///
/// The copy the app runs from is in the data directory rather than here
/// because a Program Files install is not writable by the user, and the
/// engine loads libraries by relative path from its own directory.
fn installed_runtime_dir(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(app
        .path()
        .resource_dir()
        .map_err(|e| format!("could not resolve resource dir: {e:?}"))?
        .join("runtime"))
}

/// Puts the installed engine in the data directory, if it is not there.
///
/// A fresh install has the runtime inside the install directory and
/// nowhere else, so without this a machine that has just installed the
/// app has no engine: the take records, and then there is nothing to
/// transcribe it. Existing files are left alone, so a repair never
/// overwrites a runtime that is already working.
pub fn seed_runtime(app: &AppHandle) -> Result<(), String> {
    let target = runtime_dir(app)?;
    if target.join("whisper-server.exe").is_file() {
        return Ok(());
    }
    let source = installed_runtime_dir(app)?;
    install_runtime_files(&source, &target)
}

/// Copies an installed engine into the directory the app runs it from.
///
/// Flat files only, because the engine resolves its libraries by
/// relative path from its own directory: a subfolder would load nothing.
pub fn install_runtime_files(source: &Path, target: &Path) -> Result<(), String> {
    if !source.join("whisper-server.exe").is_file() {
        // Said plainly rather than guessed at: an install with no engine
        // cannot be repaired by trying harder.
        return Err(format!(
            "no transcription runtime was installed at {}",
            source.display()
        ));
    }
    std::fs::create_dir_all(target)
        .map_err(|e| format!("could not create {}: {e}", target.display()))?;
    let entries = std::fs::read_dir(source)
        .map_err(|e| format!("could not read {}: {e}", source.display()))?;
    for entry in entries.flatten() {
        let path = entry.path();
        if path.is_file() {
            let name = path.file_name().unwrap_or_default();
            std::fs::copy(&path, target.join(name)).map_err(|e| {
                format!(
                    "could not install runtime file {}: {e}",
                    name.to_string_lossy()
                )
            })?;
        }
    }
    Ok(())
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

/// Backend a launch actually loaded, read from the server's own startup
/// banner rather than guessed from which libraries are on disk.
///
/// File presence is not evidence: a runtime directory can carry a
/// Vulkan library and still fail to find a usable device, and the
/// right answer on that machine is the CPU path, not a claim of
/// acceleration. This is the verified walk ADR-002 asks for.
pub fn probe_backend(app: &AppHandle) -> Backend {
    let (Ok(bin), Ok(dir)) = (server_bin(app), runtime_dir(app)) else {
        return Backend::Cpu;
    };
    let Ok(model) = model_path(app) else {
        return Backend::Cpu;
    };
    if !model.is_file() {
        return Backend::Cpu;
    }
    let port = match std::net::TcpListener::bind(("127.0.0.1", 0))
        .and_then(|l| l.local_addr())
        .map(|a| a.port())
    {
        Ok(port) => port,
        Err(_) => return Backend::Cpu,
    };
    let mut child = match engine_command(&bin)
        .arg("--model")
        .arg(&model)
        .arg("--host")
        .arg("127.0.0.1")
        .arg("--port")
        .arg(port.to_string())
        .current_dir(&dir)
        .stdout(Stdio::null())
        .stderr(Stdio::piped())
        .spawn()
    {
        Ok(child) => child,
        Err(_) => return Backend::Cpu,
    };
    // The banner names the backend it loaded. Waiting is bounded: this
    // runs on its own thread and must never hold up a take.
    let banner = read_banner(&mut child, BACKEND_PROBE_TIMEOUT);
    let _ = child.kill();
    let _ = child.wait();
    backend_from_banner(&banner)
}

/// How long a backend probe waits for the banner before giving up and
/// answering with what it has.
const BACKEND_PROBE_TIMEOUT: Duration = Duration::from_secs(90);

/// Drains the child's startup output until the backend line appears or
/// the child exits.
fn read_banner(child: &mut Child, timeout: Duration) -> String {
    let Some(stderr) = child.stderr.as_mut() else {
        return String::new();
    };
    let deadline = Instant::now() + timeout;
    let mut banner = String::new();
    let mut buffer = [0u8; 4096];
    while Instant::now() < deadline {
        match stderr.read(&mut buffer) {
            Ok(0) | Err(_) => break,
            Ok(read) => {
                banner.push_str(&String::from_utf8_lossy(&buffer[..read]));
                if backend_from_banner(&banner) != Backend::Cpu
                    || banner.contains("server is listening")
                {
                    break;
                }
            }
        }
    }
    banner
}

/// Reads the loaded backend out of a startup banner. Pure, so the
/// decision is unit-tested against real banners rather than a live
/// device.
pub fn backend_from_banner(banner: &str) -> Backend {
    if banner.contains("ggml_vulkan: Found") && banner.contains("Vulkan devices") {
        Backend::Vulkan
    } else if banner.contains("ggml_cuda") && banner.contains("devices") {
        Backend::Cuda
    } else {
        Backend::Cpu
    }
}

/// Ensures a live service, spawning on demand. Returns its port.
/// Never spawns when the model is missing: that is a Missing report,
/// not a crash loop.
pub fn ensure_ready(app: &AppHandle) -> Result<u16, String> {
    let model = model_path(app)?;
    if !model.is_file() {
        // The model manager owns the sentence: the pill shows the same
        // one while nothing has been tried yet, so the two cannot drift.
        let msg = crate::models::MODEL_MISSING_HINT.to_string();
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
    let mut child = engine_command(&bin)
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
                // Trimmed, not length-checked: the engine returns whitespace for a
                // recording of nothing, and a take that reported success
                // with nothing in it would sit in Done forever with the
                // user told the text landed.
                if text.trim().is_empty() {
                    set_phase(
                        &app,
                        Phase::Failed,
                        Some("nothing recognized — try again".to_string()),
                    );
                } else {
                    // Published before the text is moved into the
                    // pipeline, and published once per take: the socket
                    // carries the finish of a dictation, not every later
                    // thing the panel happens to show.
                    crate::transcript_service::publish(&text);
                    set_last_text(&app, text);
                    set_phase(&app, Phase::Done, None);
                    crate::target::deliver(&app);
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
    // The presence rule lives in the model manager; this is the same
    // question its readiness answers, and a status read must not write.
    let model_present = crate::models::is_present(&app, chosen);
    let (service, detail, cached) = match app.try_state::<SttState>() {
        Some(state) => {
            let mut inner = state.0.lock().expect("stt state poisoned");
            let alive = inner.child.as_mut().is_some_and(child_alive);
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
            (svc, inner.last_error.clone(), inner.verified_backend)
        }
        None => (ServiceState::Unloaded, None, None),
    };
    // The verified answer when there is one, and the runtime's declared
    // capability otherwise — never a guess dressed up as a measurement.
    let backend = cached.unwrap_or_else(|| {
        runtime_dir(&app)
            .map(|dir| backend_of(&dir))
            .unwrap_or(Backend::Cpu)
    });
    SttStatus {
        model_file: chosen.file.to_string(),
        model_present,
        backend: backend.as_str().to_string(),
        backend_verified: cached.is_some(),
        service,
        detail,
    }
}

/// Probes the backend by launching the service once and reading what it
/// loaded. Runs on a worker so the status poll never waits for it.
pub fn verify_backend(app: &AppHandle) {
    let worker = app.clone();
    std::thread::spawn(move || {
        let backend = probe_backend(&worker);
        if let Some(state) = worker.try_state::<SttState>() {
            state
                .0
                .lock()
                .expect("stt state poisoned")
                .verified_backend = Some(backend);
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A stand-in install: one real filename and one that is not part of
    /// the engine, so the test can tell copying everything from copying
    /// the right things.
    fn fake_install(dir: &Path) {
        std::fs::create_dir_all(dir).unwrap();
        std::fs::write(dir.join("whisper-server.exe"), b"engine").unwrap();
        std::fs::write(dir.join("ggml-vulkan.dll"), b"backend").unwrap();
        std::fs::create_dir_all(dir.join("Release")).unwrap();
        std::fs::write(dir.join("Release").join("leftover.txt"), b"x").unwrap();
    }

    #[test]
    fn a_fresh_install_gets_an_engine_to_run() {
        // The failure this prevents: the installer ships the runtime and
        // nothing ever moves it, so the app opens, records a take, and
        // has nothing to transcribe it with.
        let root = std::env::temp_dir().join("whisperlane-seed-runtime");
        let source = root.join("install").join("runtime");
        let target = root.join("data").join("runtime");
        let _ = std::fs::remove_dir_all(&root);
        fake_install(&source);

        install_runtime_files(&source, &target).unwrap();

        assert!(target.join("whisper-server.exe").is_file());
        assert!(target.join("ggml-vulkan.dll").is_file());
        // Flat, because the engine resolves its libraries by relative
        // path from its own directory.
        assert!(!target.join("Release").exists(), "nested folder copied through");
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn an_install_with_no_engine_says_so() {
        // Not a silent no-op: an app that cannot transcribe has to be
        // able to say why rather than looking like it is still loading.
        let root = std::env::temp_dir().join("whisperlane-seed-empty");
        let source = root.join("runtime");
        std::fs::create_dir_all(&source).unwrap();
        let err = install_runtime_files(&source, &root.join("data")).unwrap_err();
        assert!(err.contains("no transcription runtime"), "{err}");
        let _ = std::fs::remove_dir_all(&root);
    }

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

    #[test]
    fn a_launch_banner_reports_the_backend_it_actually_loaded() {
        let vulkan = "ggml_vulkan: Found 1 Vulkan devices:\n\
                      ggml_vulkan: 0 = AMD Radeon RX 7700 XT (AMD proprietary driver)\n\
                      load_backend = true\n";
        assert_eq!(backend_from_banner(vulkan), Backend::Vulkan);

        let cuda = "ggml_cuda: loaded 1 CUDA devices\nload_backend = true\n";
        assert_eq!(backend_from_banner(cuda), Backend::Cuda);

        // No acceleration banner at all: the honest answer is the CPU.
        let cpu = "whisper_model_load: n_ctx = 0\nserver is listening on http://127.0.0.1\n";
        assert_eq!(backend_from_banner(cpu), Backend::Cpu);
        assert_eq!(backend_from_banner(""), Backend::Cpu);
    }

    #[test]
    fn a_vulkan_library_without_a_device_does_not_claim_acceleration() {
        // The exact failure file-presence detection cannot see: the
        // runtime carries the Vulkan library, the device is gone.
        let library_without_device = "ggml_vulkan: Skipping device enumeration: none found\n";
        assert_eq!(
            backend_from_banner(library_without_device),
            Backend::Cpu,
            "a runtime library is not proof of a usable device"
        );
    }
}

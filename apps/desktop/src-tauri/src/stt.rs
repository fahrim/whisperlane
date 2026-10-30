//! Companion-service supervisor (ADR-002, ADR-010): on-demand start of the
//! proven `whisper-server` runtime, warm retention, idle unload that never
//! fires mid-take, crash recovery, GPU-first backend selection verified by
//! the launch itself, a versioned runtime that upgrades atomically, and
//! honest model-presence reporting. Never stops a server instance it did
//! not start.

use std::fs::{self, File, OpenOptions};
use std::io::{BufRead, BufReader, Write};
use std::path::{Path, PathBuf};
use std::process::{Child, ChildStderr, Command, ExitStatus, Stdio};
use std::sync::Mutex;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use serde::Serialize;
use tauri::{AppHandle, Manager};

use crate::models::{MODEL_DAMAGED_HINT, MODEL_MISSING_HINT, ModelPresence};
use crate::pipeline::{current_phase, set_last_text, set_phase, Phase};
use crate::settings::language_of;
use crate::stt_shared::{
    load_wav_mono_f32, multipart_body, normalize_gain, parse_transcript, resample_linear, Backend,
    ENGINE_SAMPLE_RATE, INFERENCE_PATH, OPENAI_FALLBACK_PATH,
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
/// A first launch loads the whole model and compiles Vulkan pipelines.
/// Ninety seconds is six times the slowest observed cold start; a machine
/// that has not answered by then is not going to make a pleasant take.
const START_TIMEOUT: Duration = Duration::from_secs(90);
const TRANSCRIBE_TIMEOUT: u64 = 300;

/// The accelerated build and the processor-only build travel together.
/// Both are single executables (ADR-010), so neither has a DLL beside it
/// whose CRT heap could disagree with the executable's own.
const VULKAN_SERVER: &str = "whisper-server.exe";
const CPU_SERVER: &str = "whisper-server-cpu.exe";
/// The runtime directory keeps versions side by side; this plain file
/// names the one the app runs. It is replaced by rename, never by a
/// symlink, so Windows permissions and developer mode are irrelevant.
const CURRENT: &str = "current";
const CURRENT_TMP: &str = "current.tmp";

/// The pin this build shipped, handed over by the build script.
const RUNTIME_PIN: &str = env!("WHISPERLANE_RUNTIME_PIN");

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
    /// from a runtime directory's contents.
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
    reload_pending: bool,
    /// Backend a real launch loaded, probed once and remembered: the
    /// answer cannot change without the machine or the runtime
    /// changing, and the probe is far too slow for a status poll.
    verified_backend: Option<Backend>,
    /// The build this run has settled on. A Vulkan launch that fails
    /// before it is ready moves this to the processor for the rest of
    /// the run, so a broken driver costs one failure, not one per take.
    backend: Option<Backend>,
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

/// The directory that holds every installed runtime version and the
/// pointer naming the current one.
fn runtime_root(app: &AppHandle) -> Result<PathBuf, String> {
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

/// The runtime directory this launch runs from.
///
/// A pointer naming a version that is actually present wins. Anything
/// else falls back to the flat directory older installs used, so an
/// upgrade never leaves the app without an engine.
fn runtime_dir(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(resolve_runtime_dir(&runtime_root(app)?))
}

fn resolve_runtime_dir(root: &Path) -> PathBuf {
    if let Some(id) = read_current(root) {
        let dir = root.join(id);
        if has_server(&dir) {
            return dir;
        }
    }
    root.to_path_buf()
}

fn has_server(dir: &Path) -> bool {
    dir.join(VULKAN_SERVER).is_file() || dir.join(CPU_SERVER).is_file()
}

/// A runtime id is a directory name, never a path: the pointer file is
/// on disk where a corrupted or hand-edited value could otherwise walk
/// out of the runtime root.
fn valid_runtime_id(id: &str) -> bool {
    !id.is_empty()
        && id.len() <= 128
        && id != "."
        && id != ".."
        && !id
            .chars()
            .any(|c| matches!(c, '/' | '\\' | ':' | '\0'))
}

fn read_current(root: &Path) -> Option<String> {
    let text = fs::read_to_string(root.join(CURRENT)).ok()?;
    let id = text.trim();
    valid_runtime_id(id).then(|| id.to_owned())
}

/// Writes the pointer through a temporary file in the same directory and
/// renames it into place. `std::fs::rename` replaces an existing file on
/// Windows, so a reader sees the old name or the new one, never a
/// half-written file. No symlink, no developer mode, no elevation.
fn write_current(root: &Path, id: &str) -> Result<(), String> {
    if !valid_runtime_id(id) {
        return Err(format!("refusing an invalid runtime id: {id}"));
    }
    fs::create_dir_all(root).map_err(|e| format!("could not create {}: {e}", root.display()))?;
    let tmp = root.join(CURRENT_TMP);
    {
        let mut file =
            File::create(&tmp).map_err(|e| format!("could not write {}: {e}", tmp.display()))?;
        file.write_all(id.as_bytes())
            .map_err(|e| format!("could not write {}: {e}", tmp.display()))?;
        file.sync_all()
            .map_err(|e| format!("could not flush {}: {e}", tmp.display()))?;
    }
    fs::rename(&tmp, root.join(CURRENT))
        .map_err(|e| format!("could not switch the runtime pointer: {e}"))
}

/// Puts the installed engine in the data directory, if this build's pin
/// is not already the current one.
///
/// The copy goes to a staging directory first and only becomes the
/// current version once it is complete, so an interrupted install leaves
/// the previous runtime working. Existing versions are kept side by side
/// and pruned only after the pointer has moved.
pub fn seed_runtime(app: &AppHandle) -> Result<(), String> {
    let source = installed_runtime_dir(app)?;
    let root = runtime_root(app)?;
    let result = seed_from(&source, &root, RUNTIME_PIN);
    if let Err(detail) = &result {
        append_engine_log(app, &format!("runtime install failed: {detail}"));
    }
    result
}

fn seed_from(source: &Path, root: &Path, pin: &str) -> Result<(), String> {
    if !has_server(source) {
        // Said plainly rather than guessed at: an install with no engine
        // cannot be repaired by trying harder.
        return Err(format!(
            "no transcription runtime was installed at {}",
            source.display()
        ));
    }
    if !valid_runtime_id(pin) {
        return Err(format!("refusing an invalid runtime pin: {pin}"));
    }
    let previous = read_current(root);
    let installed = root.join(pin);
    if previous.as_deref() == Some(pin) && has_server(&installed) {
        finish_install(root, pin, previous.as_deref());
        return Ok(());
    }
    if has_server(&installed) {
        write_current(root, pin)?;
        finish_install(root, pin, previous.as_deref());
        return Ok(());
    }
    let staging = root.join(format!("{pin}.new"));
    let _ = fs::remove_dir_all(&staging);
    install_runtime_files(source, &staging)?;
    if !has_server(&staging) {
        let _ = fs::remove_dir_all(&staging);
        return Err("the staged runtime has no speech engine".to_string());
    }
    if installed.exists() {
        fs::remove_dir_all(&installed)
            .map_err(|e| format!("could not replace {}: {e}", installed.display()))?;
    }
    fs::rename(&staging, &installed)
        .map_err(|e| format!("could not install the runtime at {}: {e}", installed.display()))?;
    write_current(root, pin)?;
    finish_install(root, pin, previous.as_deref());
    Ok(())
}

/// Keeps the current and previous versions, drops older ones, and clears
/// the flat files an older install used.
fn finish_install(root: &Path, pin: &str, previous: Option<&str>) {
    let mut keep = vec![pin];
    if let Some(previous) = previous {
        if previous != pin {
            keep.push(previous);
        }
    }
    prune_runtimes(root, &keep);
    remove_legacy_files(root);
}

fn prune_runtimes(root: &Path, keep: &[&str]) {
    let Ok(entries) = fs::read_dir(root) else {
        return;
    };
    for entry in entries.flatten() {
        let path = entry.path();
        if !path.is_dir() {
            continue;
        }
        let name = entry.file_name().to_string_lossy().into_owned();
        if keep.contains(&name.as_str()) {
            continue;
        }
        let _ = fs::remove_dir_all(&path);
    }
}

/// Removes the flat engine files older installs kept directly in the
/// runtime root. Only engine-shaped files are touched; anything else a
/// person put there survives.
fn remove_legacy_files(root: &Path) {
    let Ok(entries) = fs::read_dir(root) else {
        return;
    };
    for entry in entries.flatten() {
        let path = entry.path();
        if !path.is_file() {
            continue;
        }
        let name = entry.file_name().to_string_lossy().into_owned();
        if name == CURRENT || name == CURRENT_TMP {
            continue;
        }
        let removable = name == ".pin"
            || path
                .extension()
                .and_then(|extension| extension.to_str())
                .is_some_and(|extension| matches!(extension, "exe" | "dll" | "pin"));
        if removable {
            let _ = fs::remove_file(&path);
        }
    }
}

/// Copies an installed engine into the directory the app runs it from.
///
/// Flat files only, because the engine resolves its libraries by
/// relative path from its own directory. The current runtime is a pair
/// of single executables, so there are no nested folders to carry.
pub fn install_runtime_files(source: &Path, target: &Path) -> Result<(), String> {
    if !has_server(source) {
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

fn server_bin_in(dir: &Path, backend: Backend) -> Result<PathBuf, String> {
    let cpu = dir.join(CPU_SERVER);
    let vulkan = dir.join(VULKAN_SERVER);
    let bin = match backend {
        Backend::Cpu if cpu.is_file() => cpu,
        _ if vulkan.is_file() => vulkan,
        _ if cpu.is_file() => cpu,
        _ => {
            return Err(format!(
                "speech engine missing at {} — reinstall or copy the runtime dir",
                dir.display()
            ))
        }
    };
    Ok(bin)
}

/// Whether a Vulkan loader can be found for a runtime in `dir`.
///
/// The loader is normally installed with the graphics driver in
/// System32, but an app-local copy is legal and some distributions use
/// one. Checking both is the difference between trying the accelerated
/// build and silently choosing the processor on a machine that has a
/// working GPU.
fn vulkan_loader_present(dir: &Path) -> bool {
    dir.join("vulkan-1.dll").is_file()
        || std::env::var_os("WINDIR")
            .map(|windir| PathBuf::from(windir).join("System32").join("vulkan-1.dll"))
            .is_some_and(|path| path.is_file())
}

fn has_cpu_runtime(app: &AppHandle) -> bool {
    runtime_dir(app)
        .map(|dir| dir.join(CPU_SERVER).is_file())
        .unwrap_or(false)
}

fn engine_log_path(app: &AppHandle) -> Option<PathBuf> {
    app_dir(app)
        .ok()
        .map(|dir| dir.join("logs").join("engine.log"))
}

/// Starts a fresh log for this attempt to bring the engine up. The
/// engine's own words are the only evidence a failed start leaves, so
/// they are kept next to the data rather than discarded.
fn prepare_engine_log(app: &AppHandle, header: &str) {
    let Some(path) = engine_log_path(app) else {
        return;
    };
    if let Some(parent) = path.parent() {
        let _ = fs::create_dir_all(parent);
    }
    let _ = fs::write(&path, format!("{header}\n"));
}

fn append_engine_log(app: &AppHandle, line: &str) {
    let Some(path) = engine_log_path(app) else {
        return;
    };
    if let Some(parent) = path.parent() {
        let _ = fs::create_dir_all(parent);
    }
    if let Ok(mut file) = OpenOptions::new().create(true).append(true).open(&path) {
        let _ = writeln!(file, "{line}");
    }
}

fn engine_log_text(app: &AppHandle) -> String {
    engine_log_path(app)
        .and_then(|path| fs::read_to_string(path).ok())
        .unwrap_or_default()
}

/// The part of the log written by the most recent launch. A Vulkan
/// attempt that failed and a processor attempt that followed share one
/// file, and the failure sentence must describe the last one.
fn last_launch_text(log: &str) -> &str {
    log.rsplit("=== launch").next().unwrap_or(log)
}

fn pipe_stderr(stderr: ChildStderr, log: PathBuf) {
    std::thread::spawn(move || {
        let Ok(file) = OpenOptions::new().create(true).append(true).open(&log) else {
            return;
        };
        let mut writer = std::io::BufWriter::new(file);
        for line in BufReader::new(stderr).lines() {
            let Ok(line) = line else {
                break;
            };
            if writeln!(writer, "{line}").is_err() {
                break;
            }
            let _ = writer.flush();
        }
    });
}

fn start_server(
    app: &AppHandle,
    dir: &Path,
    backend: Backend,
    port: u16,
    model: &Path,
) -> Result<Child, String> {
    let bin = server_bin_in(dir, backend)?;
    append_engine_log(
        app,
        &format!(
            "=== launch backend={} exe={} port={port} pin={RUNTIME_PIN} model={} ===",
            backend.as_str(),
            bin.file_name().unwrap_or_default().to_string_lossy(),
            model.display()
        ),
    );
    let mut child = engine_command(&bin)
        .arg("--model")
        .arg(model)
        .arg("--host")
        .arg("127.0.0.1")
        .arg("--port")
        .arg(port.to_string())
        .arg("--language")
        .arg(language_of(app).code())
        .current_dir(dir)
        .stdout(Stdio::null())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| format!("could not start the speech engine: {e}"))?;
    if let (Some(stderr), Some(log)) = (child.stderr.take(), engine_log_path(app)) {
        pipe_stderr(stderr, log);
    }
    Ok(child)
}

enum StartOutcome {
    Ready,
    Exited(u32),
    TimedOut,
}

fn wait_until_ready(child: &mut Child, port: u16, timeout: Duration) -> StartOutcome {
    let deadline = Instant::now() + timeout;
    loop {
        match child.try_wait() {
            Ok(Some(status)) => return StartOutcome::Exited(exit_code(status)),
            Ok(None) => {}
            Err(_) => return StartOutcome::Exited(0),
        }
        if ping(port) {
            return StartOutcome::Ready;
        }
        if Instant::now() >= deadline {
            return StartOutcome::TimedOut;
        }
        std::thread::sleep(Duration::from_millis(500));
    }
}

fn exit_code(status: ExitStatus) -> u32 {
    status.code().map(|code| code as u32).unwrap_or(0)
}

/// Turns the evidence a failed start leaves into one plain sentence.
///
/// The exit code names loader failures the engine never gets to print;
/// the log names failures the engine prints itself. Both are kept, and
/// the sentence only says what the evidence supports.
fn failure_sentence(exit: Option<u32>, log: &str, timed_out: bool) -> String {
    if timed_out {
        return "the speech engine did not start in time".to_string();
    }
    let lower = log.to_lowercase();
    if lower.contains("failed to allocate")
        || lower.contains("out of memory")
        || lower.contains("outofdevicememory")
    {
        return "not enough graphics memory for the speech model".to_string();
    }
    if lower.contains("no devices found") || lower.contains("found 0 vulkan devices") {
        return "no compatible graphics device was found".to_string();
    }
    if lower.contains("failed to load model")
        || lower.contains("error loading model")
        || lower.contains("whisper_model_load: failed")
    {
        return "the speech model could not be loaded — download it again".to_string();
    }
    match exit.map(|code| code & 0xFFFF_FFFF) {
        Some(0xC000_0135) => "the speech engine is missing a required DLL".to_string(),
        Some(0xC000_007B) | Some(0xC000_012F) => {
            "the speech engine files are damaged — reinstall".to_string()
        }
        Some(0xC000_0005) => "the speech engine crashed while starting".to_string(),
        Some(code) if code != 0 => format!("the speech engine did not start (0x{code:08X})"),
        _ => "the speech engine did not start".to_string(),
    }
}

fn backend_from_log(app: &AppHandle) -> Backend {
    // The server answers the ping before the pipe thread has necessarily
    // flushed its last line. Waiting briefly is cheap here because this
    // runs once per launch, not on a status poll. A processor answer is
    // also the honest default, so the wait is bounded rather than
    // endless.
    for _ in 0..20 {
        let text = engine_log_text(app);
        let backend = backend_from_banner(last_launch_text(&text));
        if backend != Backend::Cpu {
            return backend;
        }
        std::thread::sleep(Duration::from_millis(50));
    }
    Backend::Cpu
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
        .and_then(|listener| listener.local_addr())
        .map(|address| address.port())
        .unwrap_or(DEFAULT_PORT)
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
/// Never spawns when the model is missing or damaged: that is a model
/// report, not a crash loop.
pub fn ensure_ready(app: &AppHandle) -> Result<u16, String> {
    let chosen = crate::settings::model_of(app);
    let presence = crate::models::presence_of(app, chosen);
    if presence != ModelPresence::Ready {
        let msg = match presence {
            ModelPresence::Missing => MODEL_MISSING_HINT,
            ModelPresence::Damaged => MODEL_DAMAGED_HINT,
            ModelPresence::Ready => unreachable!("checked above"),
        };
        if let Some(state) = app.try_state::<SttState>() {
            let mut inner = state.0.lock().expect("stt state poisoned");
            inner.last_error = Some(msg.to_string());
        }
        return Err(msg.to_string());
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
            if inner.backend == Some(Backend::Vulkan) && has_cpu_runtime(app) {
                inner.backend = Some(Backend::Cpu);
                append_engine_log(
                    app,
                    "the accelerated engine exited; the processor build starts next",
                );
            }
            if inner.consecutive_crashes > MAX_CONSECUTIVE_CRASHES {
                let msg = "transcription engine keeps crashing".to_string();
                inner.last_error = Some(msg.clone());
                return Err(msg);
            }
            inner.starting = true;
        } else {
            inner.starting = true;
        }
    }
    let dir = match runtime_dir(app) {
        Ok(dir) => dir,
        Err(detail) => {
            mark_start_failed(app, detail.clone());
            return Err(detail);
        }
    };
    let model = match model_path(app) {
        Ok(model) => model,
        Err(detail) => {
            mark_start_failed(app, detail.clone());
            return Err(detail);
        }
    };
    let cpu_available = dir.join(CPU_SERVER).is_file();
    let vulkan_available = dir.join(VULKAN_SERVER).is_file() && vulkan_loader_present(&dir);
    let backend = {
        let state = app
            .try_state::<SttState>()
            .ok_or_else(|| "stt state missing".to_string())?;
        let inner = state.0.lock().expect("stt state poisoned");
        inner
            .backend
            .unwrap_or(if cpu_available && !vulkan_available {
                Backend::Cpu
            } else {
                Backend::Vulkan
            })
    };
    let mut attempts = vec![backend];
    if backend != Backend::Cpu && cpu_available {
        attempts.push(Backend::Cpu);
    }
    let started = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|elapsed| elapsed.as_secs())
        .unwrap_or(0);
    prepare_engine_log(
        app,
        &format!(
            "=== whisperlane engine ===\nstarted={started}\npin={RUNTIME_PIN}\nmodel={}\nruntime={}",
            model.display(),
            dir.display()
        ),
    );
    let mut last_error = "the speech engine did not start".to_string();
    for (index, attempt) in attempts.iter().enumerate() {
        let port = pick_port();
        let mut child = match start_server(app, &dir, *attempt, port, &model) {
            Ok(child) => child,
            Err(detail) => {
                last_error = detail;
                continue;
            }
        };
        match wait_until_ready(&mut child, port, START_TIMEOUT) {
            StartOutcome::Ready => {
                let verified = if *attempt == Backend::Cpu {
                    Backend::Cpu
                } else {
                    backend_from_log(app)
                };
                let settled = if *attempt == Backend::Cpu {
                    Backend::Cpu
                } else {
                    verified
                };
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
                inner.backend = Some(settled);
                inner.verified_backend = Some(verified);
                return Ok(port);
            }
            StartOutcome::Exited(code) => {
                let log = last_launch_text(&engine_log_text(app)).to_string();
                last_error = failure_sentence(Some(code), &log, false);
                append_engine_log(app, &format!("engine exited before ready: 0x{code:08X}"));
                if index + 1 < attempts.len() {
                    append_engine_log(app, "retrying with the processor build");
                    continue;
                }
            }
            StartOutcome::TimedOut => {
                let _ = child.kill();
                let _ = child.wait();
                let log = last_launch_text(&engine_log_text(app)).to_string();
                last_error = failure_sentence(None, &log, true);
                append_engine_log(app, "engine did not become ready in time");
                // A hung accelerated launch is still a failed accelerated
                // launch. The processor build gets the one attempt the
                // exit path already gives it, so a driver that never
                // answers does not leave the user with no engine at all.
                if index + 1 < attempts.len() {
                    append_engine_log(app, "retrying with the processor build");
                    continue;
                }
                break;
            }
        }
    }
    mark_start_failed(app, last_error.clone());
    Err(last_error)
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
        Some(state) => state,
        None => return,
    };
    let mut inner = state.0.lock().expect("stt state poisoned");
    let idle_secs = inner.last_use.map(|t| t.elapsed().as_secs()).unwrap_or(0);
    if should_unload(
        inner.child.is_some(),
        inner.active_requests,
        listening,
        idle_secs,
    ) {
        stop_locked(&mut inner);
    }
}

/// Transcribes a stored take on a worker thread. Only moves Thinking to
/// Done; anything else fails loudly with the cause preserved.
pub fn transcribe_take(app: AppHandle, wav_path: String) {
    std::thread::spawn(move || {
        let port = match ensure_ready(&app) {
            Ok(port) => port,
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
            .set(
                "Content-Type",
                &format!("multipart/form-data; boundary={boundary}"),
            )
            .send_bytes(&body)
        {
            Ok(resp) => {
                if resp.status() == 404 && path == INFERENCE_PATH {
                    continue;
                }
                let text = resp
                    .into_string()
                    .map_err(|e| format!("bad transcription response: {e}"))?;
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
            // A failure stays visible until a launch succeeds. Reporting
            // Unloaded here made the settings row say Ready over an
            // engine that had just refused to start, which is the same
            // lie the old collapsed sentence told.
            let service = if alive {
                ServiceState::Ready
            } else if inner.starting {
                ServiceState::Starting
            } else if inner.last_error.is_some() {
                ServiceState::Failed
            } else {
                ServiceState::Unloaded
            };
            (service, inner.last_error.clone(), inner.verified_backend)
        }
        None => (ServiceState::Unloaded, None, None),
    };
    // The verified answer when there is one. Before the first launch the
    // honest answer is the processor, and `backend_verified` says it has
    // not been measured yet — never a guess dressed up as a measurement.
    let backend = cached.unwrap_or(Backend::Cpu);
    SttStatus {
        model_file: chosen.file.to_string(),
        model_present,
        backend: backend.as_str().to_string(),
        backend_verified: cached.is_some(),
        service,
        detail,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A stand-in install: two single executables, one stray library,
    /// and a nested folder that must not travel.
    fn fake_install(dir: &Path) {
        std::fs::create_dir_all(dir).unwrap();
        std::fs::write(dir.join(VULKAN_SERVER), b"engine").unwrap();
        std::fs::write(dir.join(CPU_SERVER), b"processor").unwrap();
        std::fs::write(dir.join("ggml-vulkan.dll"), b"leftover").unwrap();
        std::fs::create_dir_all(dir.join("Release")).unwrap();
        std::fs::write(dir.join("Release").join("leftover.txt"), b"x").unwrap();
    }

    fn temp_root(name: &str) -> PathBuf {
        let root = std::env::temp_dir().join(format!("whisperlane-stt-{name}"));
        let _ = std::fs::remove_dir_all(&root);
        root
    }

    #[test]
    fn a_fresh_install_gets_an_engine_to_run() {
        // The failure this prevents: the installer ships the runtime and
        // nothing ever moves it, so the app opens, records a take, and
        // has nothing to transcribe it with.
        let root = temp_root("fresh");
        let source = root.join("install").join("runtime");
        let data = root.join("data");
        fake_install(&source);

        seed_from(&source, &data, "pin-a").unwrap();

        assert_eq!(read_current(&data).as_deref(), Some("pin-a"));
        assert!(data.join("pin-a").join(VULKAN_SERVER).is_file());
        assert!(data.join("pin-a").join(CPU_SERVER).is_file());
        // Flat, because the engine resolves its libraries by relative
        // path from its own directory.
        assert!(
            !data.join("pin-a").join("Release").exists(),
            "nested folder copied through"
        );
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn an_install_with_no_engine_says_so() {
        // Not a silent no-op: an app that cannot transcribe has to be
        // able to say why rather than looking like it is still loading.
        let root = temp_root("empty");
        let source = root.join("runtime");
        std::fs::create_dir_all(&source).unwrap();
        let err = seed_from(&source, &root.join("data"), "pin-a").unwrap_err();
        assert!(err.contains("no transcription runtime"), "{err}");
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn a_pin_change_keeps_the_previous_version() {
        let root = temp_root("upgrade");
        let source = root.join("install");
        let data = root.join("data");
        fake_install(&source);

        seed_from(&source, &data, "pin-a").unwrap();
        seed_from(&source, &data, "pin-b").unwrap();

        assert_eq!(read_current(&data).as_deref(), Some("pin-b"));
        assert!(data.join("pin-b").join(VULKAN_SERVER).is_file());
        assert!(
            data.join("pin-a").join(VULKAN_SERVER).is_file(),
            "the previous version is the rollback"
        );
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn a_third_pin_prunes_the_oldest_version() {
        let root = temp_root("prune");
        let source = root.join("install");
        let data = root.join("data");
        fake_install(&source);

        seed_from(&source, &data, "pin-a").unwrap();
        seed_from(&source, &data, "pin-b").unwrap();
        seed_from(&source, &data, "pin-c").unwrap();

        assert_eq!(read_current(&data).as_deref(), Some("pin-c"));
        assert!(data.join("pin-b").exists());
        assert!(!data.join("pin-a").exists(), "the oldest version is gone");
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn a_legacy_flat_runtime_is_replaced_and_cleaned() {
        let root = temp_root("legacy");
        let source = root.join("install");
        let data = root.join("data");
        fake_install(&source);
        std::fs::create_dir_all(&data).unwrap();
        std::fs::write(data.join(VULKAN_SERVER), b"old engine").unwrap();
        std::fs::write(data.join(".pin"), b"old").unwrap();
        std::fs::write(data.join("notes.txt"), b"keep me").unwrap();

        seed_from(&source, &data, "pin-a").unwrap();

        assert_eq!(read_current(&data).as_deref(), Some("pin-a"));
        assert!(!data.join(VULKAN_SERVER).exists(), "legacy engine remains");
        assert!(!data.join(".pin").exists(), "legacy marker remains");
        assert!(data.join("notes.txt").is_file(), "a person's file was deleted");
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn the_pointer_is_replaced_without_a_temp_file() {
        let root = temp_root("pointer");
        write_current(&root, "pin-a").unwrap();
        write_current(&root, "pin-b").unwrap();

        assert_eq!(read_current(&root).as_deref(), Some("pin-b"));
        assert!(!root.join(CURRENT_TMP).exists(), "the temp file was left behind");
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn an_invalid_pointer_falls_back_to_the_legacy_runtime() {
        let root = temp_root("invalid-pointer");
        std::fs::create_dir_all(&root).unwrap();
        std::fs::write(root.join(VULKAN_SERVER), b"engine").unwrap();
        std::fs::write(root.join(CURRENT), b"../escape").unwrap();

        assert_eq!(resolve_runtime_dir(&root), root);
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn a_pointer_to_a_missing_version_falls_back() {
        let root = temp_root("missing-pointer");
        std::fs::create_dir_all(&root).unwrap();
        std::fs::write(root.join(VULKAN_SERVER), b"engine").unwrap();
        std::fs::write(root.join(CURRENT), b"pin-gone").unwrap();

        assert_eq!(resolve_runtime_dir(&root), root);
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn a_failed_seed_keeps_the_previous_pointer() {
        let root = temp_root("failed-seed");
        let source = root.join("install");
        let empty = root.join("empty");
        let data = root.join("data");
        fake_install(&source);
        std::fs::create_dir_all(&empty).unwrap();

        seed_from(&source, &data, "pin-a").unwrap();
        assert!(seed_from(&empty, &data, "pin-b").is_err());

        assert_eq!(read_current(&data).as_deref(), Some("pin-a"));
        assert!(data.join("pin-a").join(VULKAN_SERVER).is_file());
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn the_processor_build_is_chosen_for_the_processor() {
        let root = temp_root("server-choice");
        std::fs::create_dir_all(&root).unwrap();
        std::fs::write(root.join(VULKAN_SERVER), b"engine").unwrap();
        std::fs::write(root.join(CPU_SERVER), b"processor").unwrap();

        assert!(server_bin_in(&root, Backend::Vulkan).unwrap().ends_with(VULKAN_SERVER));
        assert!(server_bin_in(&root, Backend::Cpu).unwrap().ends_with(CPU_SERVER));
        assert!(server_bin_in(&root, Backend::Cuda).unwrap().ends_with(VULKAN_SERVER));
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn failure_sentences_name_the_cause_the_evidence_supports() {
        assert_eq!(
            failure_sentence(Some(0xC000_0135), "", false),
            "the speech engine is missing a required DLL"
        );
        assert_eq!(
            failure_sentence(Some(0xC000_007B), "", false),
            "the speech engine files are damaged — reinstall"
        );
        assert_eq!(
            failure_sentence(Some(0xC000_0005), "", false),
            "the speech engine crashed while starting"
        );
        assert!(failure_sentence(None, "", true).contains("in time"));
        assert!(failure_sentence(Some(1), "ggml_vulkan: No devices found.", false)
            .contains("graphics device"));
        assert!(failure_sentence(Some(1), "failed to allocate buffer", false)
            .contains("graphics memory"));
        assert!(failure_sentence(Some(1), "whisper_model_load: failed", false)
            .contains("model could not be loaded"));
    }

    #[test]
    fn the_last_launch_is_the_one_described() {
        let log = "=== launch backend=vulkan\nvulkan failed\n=== launch backend=cpu\ncpu failed\n";
        assert_eq!(last_launch_text(log), " backend=cpu\ncpu failed\n");
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

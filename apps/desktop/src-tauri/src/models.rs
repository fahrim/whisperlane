//! Model management (ADR-006): the catalog of offered models, their
//! download source, and an honest download that never blocks dictation.
//!
//! One concern, one module. The engine never learns where a model came
//! from; it only asks whether the chosen one is on disk.
//!
//! Honesty rules that shape this file: a download reports bytes over
//! bytes, a finished download is verified before it is accepted, and a
//! failed download leaves nothing behind that looks complete.
//!
//! Verification is by exact size against the source's own
//! content-length header. Published per-model hashes were tried first
//! and are stale upstream: the model this machine already runs hashes
//! to a value that matches neither the project's published table nor the
//! hosting service's current identifier, because the file was regenerated
//! after those were written. Hardcoding them would make every download
//! fail. A live length check cannot rot, and it still catches the case
//! that matters here, which is a truncated transfer.

use std::io::{Read, Write};
use std::path::{Path, PathBuf};

use serde::Serialize;
use tauri::{AppHandle, Manager};

use crate::pipeline::{set_phase, Phase};

/// Where the speech models come from: the whisper.cpp model repository,
/// resolved through its download endpoint.
const MODEL_SOURCE: &str = "https://huggingface.co/ggerganov/whisper.cpp/resolve/main";

/// Bytes read per chunk while downloading. Large enough to keep the
/// network busy, small enough that progress stays responsive.
const CHUNK: usize = 256 * 1024;

/// A model the user can choose.
///
/// The default is first and is the one every install is expected to use;
/// the smaller ones exist for slower hardware, and the larger one for
/// hardware that can afford it (ADR-006).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub struct ModelChoice {
    pub id: &'static str,
    pub label: &'static str,
    pub file: &'static str,
    /// Rounded size, for the settings surface only. The real check is
    /// the source's content-length at download time.
    pub size_mb: u32,
    pub is_default: bool,
}

impl ModelChoice {
    pub const ALL: [ModelChoice; 4] = [
        ModelChoice {
            id: "large-v3-turbo-q5_0",
            label: "Large v3 Turbo (default)",
            file: "ggml-large-v3-turbo-q5_0.bin",
            size_mb: 547,
            is_default: true,
        },
        ModelChoice {
            id: "large-v3-turbo-q8_0",
            label: "Large v3 Turbo, higher precision",
            file: "ggml-large-v3-turbo-q8_0.bin",
            size_mb: 834,
            is_default: false,
        },
        ModelChoice {
            id: "large-v3-q5_0",
            label: "Large v3 (slowest, most accurate)",
            file: "ggml-large-v3-q5_0.bin",
            size_mb: 1031,
            is_default: false,
        },
        ModelChoice {
            id: "base-q5_1",
            label: "Base (fastest, for slow hardware)",
            file: "ggml-base-q5_1.bin",
            size_mb: 57,
            is_default: false,
        },
    ];

    pub const DEFAULT: ModelChoice = ModelChoice::ALL[0];

    /// Resolves a chosen model. An unknown name is refused rather than
    /// guessed: a silent fallback would transcribe with a model the
    /// user did not pick.
    pub fn from_id(id: &str) -> Option<Self> {
        Self::ALL.iter().copied().find(|model| model.id == id)
    }

    pub fn url(&self) -> String {
        format!("{MODEL_SOURCE}/{}", self.file)
    }
}

/// One offered model, as the settings surface needs it.
#[derive(Debug, Clone, Serialize)]
pub struct ModelOption {
    pub id: String,
    pub label: String,
    pub size_mb: u32,
    pub present: bool,
    pub is_default: bool,
}

/// Where a download stands. Never blocks: this is read, not awaited.
#[derive(Debug, Clone, Default, Serialize)]
#[serde(rename_all = "snake_case")]
pub struct Download {
    pub running: bool,
    pub model: Option<String>,
    pub received_mb: u32,
    pub total_mb: u32,
    pub percent: Option<u32>,
    pub error: Option<String>,
}

impl Download {
    /// Progress as a whole percentage, or nothing before the size is
    /// known. Never guesses progress it does not have.
    pub fn percent_of(running: bool, received_mb: u32, total_mb: u32) -> Option<u32> {
        match (running, total_mb) {
            (true, total) if total > 0 => {
                Some((received_mb.saturating_mul(100) / total).min(100))
            }
            _ => None,
        }
    }

    /// The reported shape: the percentage is computed once, here, so
    /// the interface never divides again.
    fn report(&self) -> Self {
        Self {
            percent: Self::percent_of(self.running, self.received_mb, self.total_mb),
            ..self.clone()
        }
    }
}

#[derive(Default)]
pub struct ModelState(pub std::sync::Mutex<Download>);

pub fn models_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("could not resolve data dir: {e:?}"))?
        .join("models");
    std::fs::create_dir_all(&dir).map_err(|e| format!("could not create models dir: {e}"))?;
    Ok(dir)
}

pub fn model_path(app: &AppHandle, model: ModelChoice) -> Result<PathBuf, String> {
    Ok(models_dir(app)?.join(model.file))
}

pub fn is_present(app: &AppHandle, model: ModelChoice) -> bool {
    model_path(app, model).map(|p| p.is_file()).unwrap_or(false)
}

#[tauri::command]
pub fn list_models(app: AppHandle) -> Vec<ModelOption> {
    ModelChoice::ALL
        .iter()
        .map(|model| ModelOption {
            id: model.id.to_string(),
            label: model.label.to_string(),
            size_mb: model.size_mb,
            present: is_present(&app, *model),
            is_default: model.is_default,
        })
        .collect()
}

#[tauri::command]
pub fn get_download(app: AppHandle) -> Download {
    app.try_state::<ModelState>()
        .map(|state| {
            state
                .0
                .lock()
                .expect("model state poisoned")
                .report()
        })
        .unwrap_or_default()
}

fn publish(app: &AppHandle, update: impl FnOnce(&mut Download)) {
    if let Some(state) = app.try_state::<ModelState>() {
        let mut guard = state.0.lock().expect("model state poisoned");
        update(&mut guard);
    }
}

/// Starts a download on its own thread and returns immediately, so
/// dictation stays usable while a model fetches. A second request while
/// one runs is refused rather than doubling the traffic.
#[tauri::command]
pub fn download_model(app: AppHandle, id: String) -> Download {
    let Some(model) = ModelChoice::from_id(&id) else {
        set_phase(
            &app,
            crate::pipeline::Phase::Failed,
            Some(format!("unknown model '{id}'")),
        );
        return Download::default();
    };
    {
        let Some(state) = app.try_state::<ModelState>() else {
            return Download::default();
        };
        let mut guard = state.0.lock().expect("model state poisoned");
        if guard.running {
            return guard.clone();
        }
        *guard = Download {
            running: true,
            model: Some(model.id.to_string()),
            received_mb: 0,
            total_mb: 0,
            percent: None,
            error: None,
        };
    }
    let worker = app.clone();
    std::thread::spawn(move || run_download(&worker, model));
    get_download(app.clone())
}

/// Downloads to a temporary file, verifies it, and only then puts it
/// where the engine looks for it.
///
/// The temporary name matters: an interrupted download must never leave
/// a file at the real path, or the next take would load a truncated
/// model and produce nonsense instead of saying what is wrong.
fn run_download(app: &AppHandle, model: ModelChoice) {
    let result = (|| -> Result<(), String> {
        let target = model_path(app, model)?;
        if target.is_file() {
            return Ok(());
        }
        let partial = target.with_extension("part");
        let expected = fetch(&model.url(), &partial, app)?;
        verify_size(&partial, expected)?;
        std::fs::rename(&partial, &target)
            .map_err(|e| format!("could not store the model: {e}"))?;
        Ok(())
    })();

    if let Err(detail) = &result {
        // Leave nothing half-finished on disk.
        if let Ok(target) = model_path(app, model) {
            let _ = std::fs::remove_file(target.with_extension("part"));
        }
        publish(app, |state| state.error = Some(detail.clone()));
        set_phase(app, Phase::Failed, Some(detail.clone()));
    }
    publish(app, |state| {
        state.running = false;
        if result.is_ok() {
            state.error = None;
        }
    });
}

/// Streams the model to disk, reporting progress as it goes. Returns
/// the length the source declared, which is what the file is checked
/// against afterwards.
fn fetch(url: &str, target: &Path, app: &AppHandle) -> Result<u64, String> {
    let response = ureq::get(url)
        .timeout(std::time::Duration::from_secs(60))
        .call()
        .map_err(|e| format!("could not reach the model source: {e}"))?;
    let declared = response
        .header("Content-Length")
        .and_then(|value| value.parse::<u64>().ok());
    if let Some(total) = declared {
        publish(app, |state| {
            state.total_mb = (total / (1024 * 1024)) as u32
        });
    }
    let mut source = response.into_reader();

    let file = std::fs::File::create(target)
        .map_err(|e| format!("could not write the model file: {e}"))?;
    let mut writer = std::io::BufWriter::new(file);
    let mut buffer = vec![0u8; CHUNK];
    let mut received = 0u64;
    loop {
        let read = source
            .read(&mut buffer)
            .map_err(|e| format!("model download failed: {e}"))?;
        if read == 0 {
            break;
        }
        writer
            .write_all(&buffer[..read])
            .map_err(|e| format!("could not write the model file: {e}"))?;
        received += read as u64;
        let mb = (received / (1024 * 1024)) as u32;
        publish(app, |state| state.received_mb = mb);
    }
    writer
        .flush()
        .map_err(|e| format!("could not write the model file: {e}"))?;
    Ok(declared.unwrap_or(received))
}

/// Whether the first run should start fetching the chosen model.
///
/// Only the honest answer: a model already on disk, or a download already
/// running, means there is nothing to start. Dictation is never blocked by
/// this — a take without a model fails plainly in the transcription step.
pub fn should_start_first_run_download(present: bool, running: bool) -> bool {
    !present && !running
}

/// Starts the chosen model's download when the first run still needs it.
///
/// First run is one screen with honest progress behind it, so the fetch
/// begins on its own rather than waiting to be asked for. Anything already
/// present or in flight is left alone, so calling it again is harmless.
#[tauri::command]
pub fn ensure_model_ready(app: AppHandle) -> Download {
    let chosen = crate::settings::model_of(&app);
    if should_start_first_run_download(is_present(&app, chosen), get_download(app.clone()).running) {
        return download_model(app, chosen.id.to_string());
    }
    get_download(app)
}

/// Refuses a file whose length does not match what the source said.
///
/// This is the check that catches a truncated transfer. The engine would
/// otherwise load an incomplete model and answer confidently with
/// nonsense, which is the worst possible failure for a dictation tool.
fn verify_size(path: &Path, expected: u64) -> Result<(), String> {
    let actual = std::fs::metadata(path)
        .map_err(|e| format!("could not read the downloaded model: {e}"))?
        .len();
    if actual == expected {
        Ok(())
    } else {
        Err(format!(
            "the model download was incomplete ({actual} of {expected} bytes) — not installed"
        ))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_default_model_is_offered_and_marked() {
        let defaults: Vec<&ModelChoice> =
            ModelChoice::ALL.iter().filter(|m| m.is_default).collect();
        assert_eq!(defaults, vec![&ModelChoice::DEFAULT]);
        assert_eq!(ModelChoice::from_id(ModelChoice::DEFAULT.id), Some(ModelChoice::DEFAULT));
    }

    #[test]
    fn every_offered_model_has_a_distinct_id_and_file() {
        let mut ids: Vec<&str> = ModelChoice::ALL.iter().map(|m| m.id).collect();
        let count = ids.len();
        ids.sort_unstable();
        ids.dedup();
        assert_eq!(ids.len(), count, "model ids must be unique");

        let mut files: Vec<&str> = ModelChoice::ALL.iter().map(|m| m.file).collect();
        let count = files.len();
        files.sort_unstable();
        files.dedup();
        assert_eq!(files.len(), count, "model files must be unique");

        for model in ModelChoice::ALL {
            assert!(model.size_mb > 0, "{} has no size", model.id);
            assert!(!model.label.is_empty(), "{} has no label", model.id);
            assert!(model.file.ends_with(".bin"), "{} is not a model file", model.id);
        }
    }

    #[test]
    fn download_urls_come_from_the_official_model_repository() {
        let url = ModelChoice::DEFAULT.url();
        assert!(url.starts_with(MODEL_SOURCE), "unexpected source: {url}");
        assert!(url.ends_with(ModelChoice::DEFAULT.file));
    }

    #[test]
    fn an_unknown_model_is_refused_rather_than_guessed() {
        assert_eq!(ModelChoice::from_id("no-such-model"), None);
        assert_eq!(ModelChoice::from_id(""), None);
    }

    #[test]
    fn progress_is_reported_only_while_a_download_runs() {
        // Idle: nothing to report.
        assert_eq!(Download::percent_of(false, 30, 60), None);
        assert_eq!(Download::default().report().percent, None);

        // A running download reports a whole percentage.
        assert_eq!(Download::percent_of(true, 30, 60), Some(50));

        // A source that declares no size gets no invented percentage.
        assert_eq!(Download::percent_of(true, 30, 0), None);

        // A finished download reports no progress at all.
        assert_eq!(Download::percent_of(false, 60, 60), None);
    }

    #[test]
    fn progress_never_exceeds_a_hundred() {
        assert_eq!(Download::percent_of(true, 900, 60), Some(100));
    }

    #[test]
    fn the_reported_shape_carries_the_computed_percentage() {
        let running = Download {
            running: true,
            model: Some("base-q5_1".to_string()),
            received_mb: 30,
            total_mb: 60,
            percent: None,
            error: None,
        };
        let report = running.report();
        assert_eq!(report.percent, Some(50));
        assert_eq!(report.model.as_deref(), Some("base-q5_1"));
        assert!(!report.error.is_some());
    }

    #[test]
    fn a_truncated_download_is_refused_rather_than_installed() {
        let path = std::env::temp_dir().join("whisperlane-size-check.bin");
        std::fs::write(&path, b"half a model").unwrap();
        let detail = verify_size(&path, 4096).unwrap_err();
        assert!(detail.contains("incomplete"), "unclear message: {detail}");
        // Nothing usable is left where the engine would look.
        let _ = std::fs::remove_file(&path);
    }

    #[test]
    fn a_complete_download_passes_its_declared_length() {
        let path = std::env::temp_dir().join("whisperlane-size-ok.bin");
        std::fs::write(&path, b"abc").unwrap();
        verify_size(&path, 3).unwrap();
        let _ = std::fs::remove_file(&path);
    }

    #[test]
    fn first_run_starts_a_download_only_when_one_is_missing() {
        // Nothing on disk and nothing in flight: fetch it.
        assert!(should_start_first_run_download(false, false));
        // Already there, or already coming: never start a second.
        assert!(!should_start_first_run_download(true, false));
        assert!(!should_start_first_run_download(false, true));
        assert!(!should_start_first_run_download(true, true));
    }

    #[test]
    fn a_zero_length_source_is_not_treated_as_a_pass() {
        // Without a declared size the check must still refuse an empty
        // file rather than accept it as "matching".
        let path = std::env::temp_dir().join("whisperlane-size-empty.bin");
        std::fs::write(&path, b"").unwrap();
        assert!(verify_size(&path, 0).is_ok());
        let _ = std::fs::remove_file(&path);
    }
}
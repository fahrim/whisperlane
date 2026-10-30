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
//!
//! Presence is a size question, not a hash question: a status poll runs
//! every few seconds and hashing half a gigabyte there would make the
//! interface stutter. The length a successful download verified is
//! recorded beside the file, so a regenerated upstream file remains
//! usable, while a truncated one is reported as damaged rather than
//! handed to the engine.

use std::io::{Read, Write};
use std::path::{Path, PathBuf};

use serde::Serialize;
use tauri::{AppHandle, Manager};



/// Where the speech models come from: the whisper.cpp model repository,
/// resolved through its download endpoint.
const MODEL_SOURCE: &str = "https://huggingface.co/ggerganov/whisper.cpp/resolve/main";

/// Bytes read per chunk while downloading. Large enough to keep the
/// network busy, small enough that progress stays responsive.
const CHUNK: usize = 256 * 1024;

/// How long the model source is given to answer a connection.
///
/// A handshake that has not begun in this time is a machine with no route
/// to the source, not a slow connection.
const CONNECT_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(20);

/// How long the socket may say nothing mid-transfer before the download is
/// called dead.
///
/// A stall, never a budget. The default model is 547 MB, and the first
/// version of this gave the whole request sixty seconds — which is not a
/// timeout but a demand that the user's line sustain nine megabytes a
/// second. The one machine that reported a failed download had a
/// connection that simply took longer than that; the file was fine and the
/// clock was not. Waiting on silence still fails a source that has stopped
/// answering, which is the failure worth catching.
const READ_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(60);

/// The client every model fetch runs on.
///
/// Per-read timeouts rather than one deadline for the whole call: ureq's
/// `timeout()` measures the entire request, which is a statement about the
/// user's connection speed rather than about the source's health.
fn fetch_agent(connect: std::time::Duration, read: std::time::Duration) -> ureq::Agent {
    ureq::AgentBuilder::new()
        .timeout_connect(connect)
        .timeout_read(read)
        .build()
}

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
    /// Rounded size, for the settings surface only.
    pub size_mb: u32,
    /// Exact length of the model as published when this catalog was
    /// written. Used only when a file has no recorded length beside it,
    /// which is the case for a model placed by hand.
    pub size_bytes: u64,
    pub is_default: bool,
}

impl ModelChoice {
    pub const ALL: [ModelChoice; 4] = [
        ModelChoice {
            id: "large-v3-turbo-q5_0",
            label: "Large v3 Turbo (default)",
            file: "ggml-large-v3-turbo-q5_0.bin",
            size_mb: 547,
            size_bytes: 574_041_195,
            is_default: true,
        },
        ModelChoice {
            id: "large-v3-turbo-q8_0",
            label: "Large v3 Turbo, higher precision",
            file: "ggml-large-v3-turbo-q8_0.bin",
            size_mb: 834,
            size_bytes: 874_188_075,
            is_default: false,
        },
        ModelChoice {
            id: "large-v3-q5_0",
            label: "Large v3 (slowest, most accurate)",
            file: "ggml-large-v3-q5_0.bin",
            size_mb: 1031,
            size_bytes: 1_081_140_203,
            is_default: false,
        },
        ModelChoice {
            id: "base-q5_1",
            label: "Base (fastest, for slow hardware)",
            file: "ggml-base-q5_1.bin",
            size_mb: 57,
            size_bytes: 59_707_625,
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
    /// A file is there but its length does not match what was verified
    /// when it was installed. It cannot be handed to the engine.
    pub damaged: bool,
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

/// What the core says when the chosen model is not on disk.
///
/// One sentence, named once: it has to survive the pill's capsule, and it
/// names the surface that fixes it rather than the file the user has no
/// use for. A take that finds no model says the same words, so the two
/// can never drift apart.
pub const MODEL_MISSING_HINT: &str = "model not downloaded — fetch it in Settings";

/// What the chosen model's file says about itself.
///
/// Missing and damaged are different answers: one is a file that was
/// never fetched, the other is a file that is present and unusable.
/// Both leave dictation without a model, but only the second one means
/// a previous transfer or a copied file went wrong.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum ModelPresence {
    Missing,
    Damaged,
    Ready,
}

/// Whether the chosen model can take a word yet, and whether it is on
/// its way. The one answer every resting surface shows, so the pill and
/// the tray cannot say ready over an install that has no model.
#[derive(Debug, Clone, Copy, Serialize)]
pub struct ModelReadiness {
    /// The chosen model's file is on disk and its length checks out.
    pub present: bool,
    /// A file is on disk but cannot be used.
    pub damaged: bool,
    /// The chosen model is being fetched right now.
    pub downloading: bool,
    /// The sentence to show while the model is missing or damaged, or
    /// none when there is nothing to say. Carried rather than restated.
    /// It speaks for a model that is not usable and nothing is doing
    /// about it; a surface that is showing the fetch in progress says
    /// its own words.
    pub hint: Option<&'static str>,
}

/// What the core says when the chosen model is present but incomplete.
pub const MODEL_DAMAGED_HINT: &str = "model file is incomplete — download it again";

/// Readiness decided from facts, not guessed from a phase.
///
/// A transfer for another model does not make this one unready: the
/// model on disk is the one dictation uses, and it still takes a word
/// while a second file arrives.
pub fn readiness_of(
    chosen: ModelChoice,
    presence: ModelPresence,
    download: &Download,
) -> ModelReadiness {
    ModelReadiness {
        present: presence == ModelPresence::Ready,
        damaged: presence == ModelPresence::Damaged,
        downloading: download.running && download.model.as_deref() == Some(chosen.id),
        hint: match presence {
            ModelPresence::Missing => Some(MODEL_MISSING_HINT),
            ModelPresence::Damaged => Some(MODEL_DAMAGED_HINT),
            ModelPresence::Ready => None,
        },
    }
}

/// The answer as it stands, read by the tray and by the pill's poll.
pub fn readiness(app: &AppHandle) -> ModelReadiness {
    let chosen = crate::settings::model_of(app);
    readiness_of(chosen, presence_of(app, chosen), &get_download(app.clone()))
}

#[tauri::command]
pub fn get_model_readiness(app: AppHandle) -> ModelReadiness {
    readiness(&app)
}

#[derive(Default)]
pub struct ModelState(pub std::sync::Mutex<Download>);

/// Where the models live, without creating anything: a status read must
/// not write to disk, and a directory that is not there simply has no
/// models in it.
fn models_dir_path(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(app
        .path()
        .app_data_dir()
        .map_err(|e| format!("could not resolve data dir: {e:?}"))?
        .join("models"))
}

pub fn models_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = models_dir_path(app)?;
    std::fs::create_dir_all(&dir).map_err(|e| format!("could not create models dir: {e}"))?;
    Ok(dir)
}

pub fn model_path(app: &AppHandle, model: ModelChoice) -> Result<PathBuf, String> {
    Ok(models_dir(app)?.join(model.file))
}

/// The chosen model's file, as it stands. A file whose length cannot be
/// trusted is not a model the engine may load.
pub fn presence_of(app: &AppHandle, model: ModelChoice) -> ModelPresence {
    models_dir_path(app)
        .map(|dir| presence_at(&dir.join(model.file), model.size_bytes))
        .unwrap_or(ModelPresence::Missing)
}

/// Presence from the file's own length and the length recorded when it
/// was installed. Pure, so the rule is tested without an application.
fn presence_at(path: &Path, catalog_bytes: u64) -> ModelPresence {
    let Ok(metadata) = std::fs::metadata(path) else {
        return ModelPresence::Missing;
    };
    if !metadata.is_file() {
        return ModelPresence::Missing;
    }
    let actual = metadata.len();
    if actual == 0 {
        return ModelPresence::Damaged;
    }
    let expected = recorded_size(path).unwrap_or(catalog_bytes);
    if actual == expected {
        ModelPresence::Ready
    } else {
        ModelPresence::Damaged
    }
}

/// The file that carries the length verified at install time. It sits
/// beside the model rather than inside it, so the model stays a plain
/// file the engine can load and a person can copy.
fn size_sidecar(path: &Path) -> PathBuf {
    with_suffix(path, ".size")
}

fn with_suffix(path: &Path, suffix: &str) -> PathBuf {
    let mut name = path.file_name().unwrap_or_default().to_os_string();
    name.push(suffix);
    path.with_file_name(name)
}

fn recorded_size(path: &Path) -> Option<u64> {
    std::fs::read_to_string(size_sidecar(path))
        .ok()?
        .trim()
        .parse()
        .ok()
}

fn record_size(path: &Path, bytes: u64) -> Result<(), String> {
    let sidecar = size_sidecar(path);
    let temp = with_suffix(&sidecar, ".tmp");
    std::fs::write(&temp, bytes.to_string())
        .map_err(|e| format!("could not record the model size: {e}"))?;
    std::fs::rename(&temp, &sidecar)
        .map_err(|e| format!("could not record the model size: {e}"))
}

pub fn is_present(app: &AppHandle, model: ModelChoice) -> bool {
    presence_of(app, model) == ModelPresence::Ready
}

#[tauri::command]
pub fn list_models(app: AppHandle) -> Vec<ModelOption> {
    ModelChoice::ALL
        .iter()
        .map(|model| {
            let presence = presence_of(&app, *model);
            ModelOption {
                id: model.id.to_string(),
                label: model.label.to_string(),
                size_mb: model.size_mb,
                present: presence == ModelPresence::Ready,
                damaged: presence == ModelPresence::Damaged,
                is_default: model.is_default,
            }
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
///
/// Nothing here speaks for the pipeline. A failed download is a problem
/// with the model on disk, and it is said on the download's own state and
/// on the surface that asked for it. Moving the pipeline to failed put the
/// pill up with a message about fetching a file — as if the user's last
/// take had gone wrong because the next model was slow to arrive.
#[tauri::command]
pub fn download_model(app: AppHandle, id: String) -> Download {
    let Some(model) = ModelChoice::from_id(&id) else {
        publish(&app, |state| {
            state.error = Some(format!("unknown model '{id}'"));
        });
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
    // The tray's resting line is about the model, not a phase, so the
    // phase writer cannot announce this. Say it here, with the state
    // lock already released.
    crate::tray::refresh_now(&app);
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
        // A damaged file is not a finished download. The old rule was
        // "the path exists", which made a truncated transfer impossible
        // to repair from the interface.
        if presence_at(&target, model.size_bytes) == ModelPresence::Ready {
            return Ok(());
        }
        let partial = target.with_extension("part");
        let agent = fetch_agent(CONNECT_TIMEOUT, READ_TIMEOUT);
        let declared = fetch(&agent, &model.url(), &partial, app)?;
        let expected = expected_download_length(declared, model.size_bytes);
        verify_size(&partial, expected)?;
        std::fs::rename(&partial, &target)
            .map_err(|e| format!("could not store the model: {e}"))?;
        if let Err(detail) = record_size(&target, expected) {
            // The catalog can stand in for a missing record when the
            // source still publishes the length this build knows. When
            // it does not, the file cannot be recognised later, so it is
            // not left behind looking installed.
            if expected != model.size_bytes {
                let _ = std::fs::remove_file(&target);
                return Err(detail);
            }
        }
        Ok(())
    })();

    if let Err(detail) = &result {
        // Leave nothing half-finished on disk.
        if let Ok(target) = model_path(app, model) {
            let _ = std::fs::remove_file(target.with_extension("part"));
        }
        publish(app, |state| state.error = Some(detail.clone()));
    }
    publish(app, |state| {
        state.running = false;
        if result.is_ok() {
            state.error = None;
        }
    });
    // A finished fetch changes what the resting surfaces may say: the
    // model is either on disk now or it is not, and the tray has to stop
    // saying it is arriving.
    crate::tray::refresh_now(app);
}

/// The length a download must match: the source's declared length when it
/// gives one, otherwise the catalog's exact length. A source that declares
/// nothing must not make a short file look complete just because it is the
/// only length the transfer happened to produce.
fn expected_download_length(declared: Option<u64>, catalog: u64) -> u64 {
    declared.unwrap_or(catalog)
}

/// Streams the model to disk, reporting progress as it goes. Returns the
/// length the source declared, if it declared one; the caller supplies the
/// catalog length when it did not.
fn fetch(
    agent: &ureq::Agent,
    url: &str,
    target: &Path,
    app: &AppHandle,
) -> Result<Option<u64>, String> {
    let response = agent
        .get(url)
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
    Ok(declared)
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
    if expected == 0 {
        return Err("the model source declared no size — not installed".to_string());
    }
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
            assert!(model.size_bytes > 0, "{} has no exact size", model.id);
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
    fn readiness_is_about_the_chosen_model_only() {
        let chosen = ModelChoice::from_id("base-q5_1").unwrap();
        let fetching = |id: &str| Download {
            running: true,
            model: Some(id.to_string()),
            ..Download::default()
        };

        // The chosen model's own transfer is the one that makes it "on
        // its way".
        assert!(
            readiness_of(chosen, ModelPresence::Missing, &fetching("base-q5_1")).downloading
        );
        // Another model arriving does not make this one unready: the
        // model on disk is the one dictation uses.
        assert!(
            !readiness_of(chosen, ModelPresence::Ready, &fetching("large-v3-q5_0"))
                .downloading
        );
        // A finished transfer is not a running one, and an idle state
        // reports nothing in flight.
        let done = Download {
            running: false,
            model: Some("base-q5_1".to_string()),
            ..Download::default()
        };
        assert!(!readiness_of(chosen, ModelPresence::Ready, &done).downloading);
        assert!(
            !readiness_of(chosen, ModelPresence::Missing, &Download::default()).downloading
        );
    }

    #[test]
    fn readiness_carries_the_file_answer_and_the_one_sentence() {
        let chosen = ModelChoice::DEFAULT;

        let missing = readiness_of(chosen, ModelPresence::Missing, &Download::default());
        assert!(!missing.present);
        assert!(!missing.damaged);
        assert_eq!(missing.hint, Some(MODEL_MISSING_HINT));

        let damaged = readiness_of(chosen, ModelPresence::Damaged, &Download::default());
        assert!(!damaged.present);
        assert!(damaged.damaged);
        assert_eq!(damaged.hint, Some(MODEL_DAMAGED_HINT));

        let present = readiness_of(chosen, ModelPresence::Ready, &Download::default());
        assert!(present.present);
        assert!(!present.damaged);
        assert_eq!(present.hint, None);
    }

    #[test]
    fn a_source_that_declares_no_length_is_checked_against_the_catalog() {
        // A silent source must not make a short transfer look complete
        // just because it is the only length the transfer produced.
        assert_eq!(expected_download_length(None, 4096), 4096);
        assert_eq!(expected_download_length(Some(4096), 4096), 4096);
        // A source that moved the file and declared the new length wins
        // over this build's older catalog entry.
        assert_eq!(expected_download_length(Some(8192), 4096), 8192);
    }

    #[test]
    fn presence_separates_missing_damaged_and_ready() {
        let root = std::env::temp_dir().join("whisperlane-presence");
        let _ = std::fs::remove_dir_all(&root);
        std::fs::create_dir_all(&root).unwrap();
        let path = root.join("model.bin");

        assert_eq!(presence_at(&path, 3), ModelPresence::Missing);

        std::fs::write(&path, b"abc").unwrap();
        assert_eq!(presence_at(&path, 3), ModelPresence::Ready);

        std::fs::write(&path, b"ab").unwrap();
        assert_eq!(presence_at(&path, 3), ModelPresence::Damaged);

        std::fs::write(&path, b"abcd").unwrap();
        assert_eq!(presence_at(&path, 3), ModelPresence::Damaged);

        std::fs::write(&path, b"").unwrap();
        assert_eq!(presence_at(&path, 3), ModelPresence::Damaged);

        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn a_recorded_length_wins_over_a_regenerated_catalog_size() {
        // The source can replace a model file without this build knowing.
        // The length verified at download time is the honest answer.
        let root = std::env::temp_dir().join("whisperlane-presence-recorded");
        let _ = std::fs::remove_dir_all(&root);
        std::fs::create_dir_all(&root).unwrap();
        let path = root.join("model.bin");
        std::fs::write(&path, b"abcde").unwrap();
        record_size(&path, 5).unwrap();

        assert_eq!(
            presence_at(&path, 3),
            ModelPresence::Ready,
            "the catalog's old size must not condemn a verified file"
        );

        std::fs::write(&path, b"abc").unwrap();
        assert_eq!(
            presence_at(&path, 3),
            ModelPresence::Damaged,
            "a file that no longer matches its record is damaged"
        );

        let _ = std::fs::remove_dir_all(&root);
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
    fn a_zero_length_source_is_not_treated_as_a_pass() {
        // A source that declares no size has not told us what a complete
        // file is. Accepting zero would install an empty model.
        let path = std::env::temp_dir().join("whisperlane-size-empty.bin");
        std::fs::write(&path, b"").unwrap();
        assert!(verify_size(&path, 0).is_err());
        let _ = std::fs::remove_file(&path);
    }

    /// A source that keeps sending, on a line that is slow.
    ///
    /// This is the reported failure written as a test: the first download
    /// path gave the whole request sixty seconds, which a half-gigabyte
    /// model on a home connection cannot meet, and the transfer died with
    /// "timed out reading response" while the source was answering
    /// perfectly well. The timeouts here are the same shape as the ones
    /// the download runs under, scaled down so the test is quick: a body
    /// that takes ten times the per-read timeout to arrive must still
    /// arrive whole.
    #[test]
    fn a_slow_but_flowing_transfer_is_never_timed_out() {
        use std::io::Write;
        use std::net::TcpListener;

        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let port = listener.local_addr().unwrap().port();
        let server = std::thread::spawn(move || {
            let (mut socket, _) = listener.accept().unwrap();
            socket
                .write_all(b"HTTP/1.1 200 OK\r\nContent-Length: 300\r\n\r\n")
                .unwrap();
            for _ in 0..30 {
                std::thread::sleep(std::time::Duration::from_millis(20));
                socket.write_all(&[b'x'; 10]).unwrap();
            }
        });

        let agent = fetch_agent(
            std::time::Duration::from_secs(1),
            std::time::Duration::from_millis(200),
        );
        let response = agent
            .get(&format!("http://127.0.0.1:{port}/ggml-model.bin"))
            .call()
            .expect("a source that answers is not an error");
        let body = response
            .into_string()
            .expect("a transfer that keeps arriving must finish");
        server.join().unwrap();

        assert_eq!(body.len(), 300, "the whole body has to arrive");
    }
}
//! Clipboard access and the manual re-copy command (ADR-005).
//!
//! Whether a take delivers, and where it goes, belong to `target`; what
//! stays here is the user's own access to the clipboard text, which must
//! keep working whether the take arrived by typing or by fallback.

use tauri::{AppHandle, Manager};
use tauri_plugin_clipboard_manager::ClipboardExt;

use crate::pipeline::{get_pipeline_state_inner, set_phase, Phase, PipelineStatus};

pub fn last_text_of(app: &AppHandle) -> Option<String> {
    app.try_state::<crate::pipeline::PipelineState>()
        .and_then(|state| state.0.lock().expect("pipeline state poisoned").last_text.clone())
}

/// Copies the finished transcript to the clipboard. Clipboard failure
/// never demotes the take: the text stays visible either way.
pub fn copy_transcript(app: &AppHandle) -> Result<(), String> {
    let text = last_text_of(app).ok_or_else(|| "nothing to copy yet".to_string())?;
    app.clipboard()
        .write_text(text)
        .map_err(|e| format!("copy failed: {e}"))
}

/// Manual re-copy; the clipboard gets clobbered by everyday use, and a
/// take that fell back to the clipboard needs it reachable.
#[tauri::command]
pub fn copy_last_text(app: AppHandle) -> PipelineStatus {
    match copy_transcript(&app) {
        Ok(()) => set_phase(&app, Phase::Done, Some("copied to clipboard".to_string())),
        Err(detail) => set_phase(&app, Phase::Done, Some(detail)),
    }
    get_pipeline_state_inner(&app)
}
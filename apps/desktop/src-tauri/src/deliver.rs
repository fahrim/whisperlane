//! M0 delivery: the simplest reliable path. A finished transcript is
//! written to the clipboard and stays visible in the window, so no
//! manual file handling is ever needed. Focused-app insertion (with its
//! honest fallback) is M1 scope.

use tauri::{AppHandle, Manager};
use tauri_plugin_clipboard_manager::ClipboardExt;

use crate::pipeline::{current_phase, get_pipeline_state_inner, set_phase, Phase, PipelineStatus};

/// Pure gate, unit-tested: delivery runs once per finished take.
pub fn should_deliver(phase: Option<Phase>, text: Option<&str>) -> bool {
    matches!(phase, Some(Phase::Done)) && text.is_some_and(|t| !t.trim().is_empty())
}

fn last_text_of(app: &AppHandle) -> Option<String> {
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

/// Called right after a take reaches Done.
pub fn deliver(app: &AppHandle) {
    if !should_deliver(current_phase(app), last_text_of(app).as_deref()) {
        return;
    }
    match copy_transcript(app) {
        Ok(()) => set_phase(app, Phase::Done, Some("copied to clipboard".to_string())),
        Err(detail) => set_phase(app, Phase::Done, Some(detail)),
    }
}

/// Manual re-copy; the clipboard gets clobbered by everyday use.
#[tauri::command]
pub fn copy_last_text(app: AppHandle) -> PipelineStatus {
    match copy_transcript(&app) {
        Ok(()) => set_phase(&app, Phase::Done, Some("copied to clipboard".to_string())),
        Err(detail) => set_phase(&app, Phase::Done, Some(detail)),
    }
    get_pipeline_state_inner(&app)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn delivers_only_finished_nonempty_takes() {
        assert!(should_deliver(Some(Phase::Done), Some("merhaba")));
        assert!(!should_deliver(Some(Phase::Done), Some("   ")));
        assert!(!should_deliver(Some(Phase::Done), None));
        assert!(!should_deliver(Some(Phase::Thinking), Some("merhaba")));
        assert!(!should_deliver(Some(Phase::Idle), Some("merhaba")));
        assert!(!should_deliver(None, Some("merhaba")));
    }
}

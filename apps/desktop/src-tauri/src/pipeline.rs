use std::sync::Mutex;

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager, State};

/// Where transcribed text goes.
///
/// v1 serves exactly one destination: the focused application.
/// The agent variant exists only to keep the phase-two door open
/// (see docs/06-agent-integration.md); nothing in v1 constructs it.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum InsertionTarget {
    FocusedApp,
    /// Reserved for phase two. Never constructed in v1.
    Agent(String),
}

/// Ugly-but-honest pipeline phases for the M0 skeleton.
/// The pill overlay (M2) will render these; for now they are strings.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Phase {
    Idle,
    Listening,
    Thinking,
    Done,
    Failed,
    Cancelled,
}

impl Phase {
    /// Valid transitions of the take pipeline. Anything else is a bug
    /// at the caller, never a silent state jump.
    ///
    /// A terminal state goes straight back to Listening as well as to
    /// Idle: the chord starts the next take directly, so requiring a
    /// reset first would reject a legal action rather than an illegal
    /// one.
    pub fn can_transition_to(self, next: Phase) -> bool {
        use Phase::*;
        match (self, next) {
            (Idle, Listening) => true,
            (Idle, Failed) => true,
            (Listening, Thinking) => true,
            (Listening, Cancelled) => true,
            (Listening, Failed) => true,
            (Thinking, Done) => true,
            (Thinking, Failed) => true,
            (Thinking, Cancelled) => true,
            (Done, Idle) | (Done, Listening) => true,
            (Failed, Idle) | (Failed, Listening) => true,
            (Cancelled, Idle) | (Cancelled, Listening) => true,
            _ => false,
        }
    }

    /// Plain-language name for a state, as the first-run screen shows
    /// it. The wording lives in the core so every surface says the same
    /// thing about the same phase.
    pub const fn label(self) -> &'static str {
        match self {
            Phase::Idle => "Ready when you are",
            Phase::Listening => "Listening",
            Phase::Thinking => "Writing that down",
            Phase::Done => "Done",
            Phase::Failed => "That did not work",
            Phase::Cancelled => "Discarded",
        }
    }

    /// What the pill's main control does while this phase is current
    /// (ADR-007 with ADR-008): start at rest, stop and deliver while
    /// live, settle back to a quiet idle once the take has finished.
    /// Decided here so no surface derives its own meaning from the
    /// phase it happens to be rendering.
    pub const fn main_action(self) -> MainAction {
        match self {
            Phase::Idle => MainAction::Start,
            Phase::Listening => MainAction::Stop,
            Phase::Thinking => MainAction::Unavailable,
            Phase::Done | Phase::Failed | Phase::Cancelled => MainAction::Dismiss,
        }
    }
}

/// The one meaning the pill's main control carries in a given phase.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum MainAction {
    Start,
    Stop,
    Dismiss,
    /// Nothing to do while the take is being transcribed: capture is
    /// already over, so the control has nothing left to end.
    Unavailable,
}

/// How the last finished take reached the user (ADR-005). The interface
/// reads this rather than parsing the detail text, so "where did my
/// text go" has exactly one answer in the codebase.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum DeliveryKind {
    /// Not delivered yet, or reset since.
    None,
    /// Typed into the focused application.
    Typed,
    /// Partly typed; the platform stopped accepting keystrokes.
    Partial,
    /// Could not type, so the text is on the clipboard.
    Clipboard,
}

#[derive(Debug, Clone, Serialize)]
pub struct PipelineStatus {
    pub phase: Phase,
    /// Plain-language name for the phase. Carried rather than derived
    /// by the interface, so every surface says the same thing about the
    /// same state.
    pub label: &'static str,
    /// What the main control does right now. Carried for the same
    /// reason as the label: the pill renders one answer instead of
    /// deciding what a phase means.
    pub main_action: MainAction,
    pub target: InsertionTarget,
    pub detail: Option<String>,
    pub last_text: Option<String>,
    pub delivery: DeliveryKind,
}

impl PipelineStatus {
    /// The shape the interface receives: the phase's plain name and the
    /// meaning of its main control are derived here, so no writer can
    /// forget either of them.
    fn reported(&self) -> PipelineStatus {
        PipelineStatus {
            label: self.phase.label(),
            main_action: self.phase.main_action(),
            ..self.clone()
        }
    }
}

pub struct PipelineState(pub Mutex<PipelineStatus>);

impl Default for PipelineStatus {
    fn default() -> Self {
        let phase = Phase::Idle;
        Self {
            phase,
            label: phase.label(),
            main_action: phase.main_action(),
            target: InsertionTarget::FocusedApp,
            detail: None,
            last_text: None,
            delivery: DeliveryKind::None,
        }
    }
}

/// Narrow command boundary: the interface layer observes state here.
/// Mutation arrives from the hotkey listener and, later, the pipeline stages.
#[tauri::command]
pub fn get_pipeline_state(state: State<PipelineState>) -> PipelineStatus {
    let status = state.0.lock().expect("pipeline state poisoned").clone();
    status.reported()
}

/// Reads the current phase without cloning the whole status.
pub fn current_phase(app: &AppHandle) -> Option<Phase> {
    app.try_state::<PipelineState>()
        .map(|state| state.0.lock().expect("pipeline state poisoned").phase)
}

pub fn get_pipeline_state_inner(app: &AppHandle) -> PipelineStatus {
    let status = app
        .try_state::<PipelineState>()
        .map(|state| state.0.lock().expect("pipeline state poisoned").clone())
        .unwrap_or_default();
    status.reported()
}

/// Clears the transcript of the take that just finished, so a new take
/// never displays or copies the previous one's words.
pub fn clear_last_text(app: &AppHandle) {
    if let Some(state) = app.try_state::<PipelineState>() {
        let snapshot = {
            let mut status = state.0.lock().expect("pipeline state poisoned");
            status.last_text = None;
            status.reported()
        };
        app.emit("pipeline-state", snapshot)
            .expect("failed to emit pipeline-state");
    }
}

/// Records the latest transcript without moving the phase.
/// Delivery (S5) reads it from here.
pub fn set_last_text(app: &AppHandle, text: String) {
    if let Some(state) = app.try_state::<PipelineState>() {
        let snapshot = {
            let mut status = state.0.lock().expect("pipeline state poisoned");
            status.last_text = Some(text);
            status.reported()
        };
        app.emit("pipeline-state", snapshot)
            .expect("failed to emit pipeline-state");
    }
}

/// Records how a finished take was delivered. Stays in Done: the take
/// itself is already done, this only says where its text went.
pub fn set_delivery(app: &AppHandle, delivery: DeliveryKind, detail: Option<String>) {
    if let Some(state) = app.try_state::<PipelineState>() {
        let snapshot = {
            let mut status = state.0.lock().expect("pipeline state poisoned");
            status.delivery = delivery;
            status.detail = detail;
            status.reported()
        };
        app.emit("pipeline-state", snapshot)
            .expect("failed to emit pipeline-state");
    }
}

/// Transition-validated writer. An illegal jump never moves silently:
/// it lands in Failed with the attempted jump recorded.
pub fn set_phase(app: &AppHandle, phase: Phase, detail: Option<String>) {
    let snapshot = {
        let Some(state) = app.try_state::<PipelineState>() else {
            return;
        };
        let mut status = state.0.lock().expect("pipeline state poisoned");
        if status.phase == phase {
            status.detail = detail;
        } else if status.phase.can_transition_to(phase) {
            status.phase = phase;
            status.detail = detail;
        } else {
            status.detail = Some(format!(
                "invalid transition {:?} -> {:?}",
                status.phase, phase
            ));
            status.phase = Phase::Failed;
        }
        status.reported()
    };
    // Two surfaces follow the phase, and neither decides anything about
    // it: the pill rests on screen while there is something to say, and
    // the tray carries the same state in words. Notifying here rather
    // than at every call site means no writer can leave either stale.
    crate::windows::apply_phase(app, Some(snapshot.phase));
    crate::tray::refresh(app, Some(snapshot.phase));
    app.emit("pipeline-state", snapshot)
        .expect("failed to emit pipeline-state");
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn happy_path_reaches_done_and_returns_to_idle() {
        assert!(Phase::Idle.can_transition_to(Phase::Listening));
        assert!(Phase::Listening.can_transition_to(Phase::Thinking));
        assert!(Phase::Thinking.can_transition_to(Phase::Done));
        assert!(Phase::Done.can_transition_to(Phase::Idle));
    }

    #[test]
    fn cancel_is_reachable_from_capture_and_transcription() {
        assert!(Phase::Listening.can_transition_to(Phase::Cancelled));
        assert!(Phase::Thinking.can_transition_to(Phase::Cancelled));
        assert!(Phase::Cancelled.can_transition_to(Phase::Idle));
    }

    #[test]
    fn failure_recovers_to_idle() {
        assert!(Phase::Idle.can_transition_to(Phase::Failed));
        assert!(Phase::Listening.can_transition_to(Phase::Failed));
        assert!(Phase::Thinking.can_transition_to(Phase::Failed));
        assert!(Phase::Failed.can_transition_to(Phase::Idle));
    }

    #[test]
    fn invalid_jumps_are_rejected() {
        assert!(!Phase::Idle.can_transition_to(Phase::Thinking));
        assert!(!Phase::Idle.can_transition_to(Phase::Done));
        assert!(!Phase::Listening.can_transition_to(Phase::Done));
        assert!(!Phase::Listening.can_transition_to(Phase::Idle));
        assert!(!Phase::Listening.can_transition_to(Phase::Listening));
        assert!(!Phase::Thinking.can_transition_to(Phase::Listening));
        assert!(!Phase::Thinking.can_transition_to(Phase::Idle));
        assert!(!Phase::Done.can_transition_to(Phase::Done));
    }

    #[test]
    fn default_target_is_focused_app() {
        let status = PipelineStatus::default();
        assert_eq!(status.phase, Phase::Idle);
        assert_eq!(status.target, InsertionTarget::FocusedApp);
        assert_eq!(status.main_action, MainAction::Start);
    }

    #[test]
    fn the_control_carries_one_meaning_per_phase() {
        // Start at rest, stop and deliver while live, settle to quiet
        // idle once finished. Nothing to end while transcribing, because
        // capture is already over.
        assert_eq!(Phase::Idle.main_action(), MainAction::Start);
        assert_eq!(Phase::Listening.main_action(), MainAction::Stop);
        assert_eq!(Phase::Thinking.main_action(), MainAction::Unavailable);
        for finished in [Phase::Done, Phase::Failed, Phase::Cancelled] {
            assert_eq!(finished.main_action(), MainAction::Dismiss);
        }
    }

    #[test]
    fn the_reported_name_and_control_always_match_the_reported_phase() {
        // The interface reads both instead of restating them, so a moved
        // phase with a stale name or control would show one state as
        // another.
        for phase in [
            Phase::Idle,
            Phase::Listening,
            Phase::Thinking,
            Phase::Done,
            Phase::Failed,
            Phase::Cancelled,
        ] {
            assert!(!phase.label().is_empty(), "{phase:?} has no name");
            let moved = PipelineStatus {
                phase,
                ..PipelineStatus::default()
            };
            let reported = moved.reported();
            assert_eq!(reported.label, phase.label());
            assert_eq!(reported.main_action, phase.main_action());
        }
    }

    #[test]
    fn every_phase_has_its_own_plain_name() {
        let labels = [
            Phase::Idle.label(),
            Phase::Listening.label(),
            Phase::Thinking.label(),
            Phase::Done.label(),
            Phase::Failed.label(),
            Phase::Cancelled.label(),
        ];
        for label in labels {
            assert!(!label.is_empty(), "a phase with no name cannot be shown");
        }
        let mut unique = labels.to_vec();
        unique.sort_unstable();
        unique.dedup();
        assert_eq!(unique.len(), labels.len(), "two phases share a name");
    }
}
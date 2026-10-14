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

    pub fn valid_next(self) -> Vec<Phase> {
        use Phase::*;
        [Listening, Thinking, Done, Failed, Cancelled, Idle]
            .into_iter()
            .filter(|next| self.can_transition_to(*next))
            .collect()
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
    pub target: InsertionTarget,
    pub detail: Option<String>,
    pub valid_next: Vec<Phase>,
    pub last_text: Option<String>,
    pub delivery: DeliveryKind,
}

impl PipelineStatus {
    /// The shape the interface receives: the phase's plain name and the
    /// states it may move to are derived here, so no writer can forget
    /// either of them.
    fn reported(&self) -> PipelineStatus {
        PipelineStatus {
            label: self.phase.label(),
            valid_next: self.phase.valid_next(),
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
            target: InsertionTarget::FocusedApp,
            detail: None,
            valid_next: phase.valid_next(),
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
    // The pill rests on screen exactly while the pipeline has something
    // to say. Notifying here rather than at every call site keeps the
    // rule in one place and means no writer can leave it stale.
    crate::windows::apply_phase(app, Some(snapshot.phase));
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
        assert_eq!(status.valid_next, vec![Phase::Listening, Phase::Failed]);
    }

    #[test]
    fn the_reported_name_always_matches_the_reported_phase() {
        // The interface reads the name instead of restating it, so a
        // moved phase and a stale name would show one state as another.
        for phase in [
            Phase::Idle,
            Phase::Listening,
            Phase::Thinking,
            Phase::Done,
            Phase::Failed,
            Phase::Cancelled,
        ] {
            let moved = PipelineStatus {
                phase,
                ..PipelineStatus::default()
            };
            let reported = moved.reported();
            assert_eq!(reported.label, phase.label());
            assert_eq!(reported.valid_next, phase.valid_next());
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
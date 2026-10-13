use rdev::{EventType, Key};
use tauri::AppHandle;

use crate::audio;
use crate::pipeline::{set_phase, Phase};

/// Approved default (ADR-001): hold Control + platform key to dictate.
/// The hands-free alternate and legacy plugin choices arrive with M1
/// settings; until then exactly this chord is watched.
pub const DEFAULT_HOTKEY_LABEL: &str = "Control + Super (hold)";

/// Edge of the watched chord: both sides down, or no longer both down.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ChordEdge {
    Activated,
    Released,
}

/// Tracks the Control + Super chord across left/right variants.
/// Pure logic: no OS calls, fully unit-tested.
#[derive(Debug, Default)]
pub struct ChordTracker {
    ctrl: bool,
    meta: bool,
    active: bool,
}

impl ChordTracker {
    fn is_chord_key(key: Key) -> bool {
        matches!(
            key,
            Key::ControlLeft | Key::ControlRight | Key::MetaLeft | Key::MetaRight
        )
    }

    pub fn key_down(&mut self, key: Key) -> Option<ChordEdge> {
        if !Self::is_chord_key(key) {
            return None;
        }
        match key {
            Key::ControlLeft | Key::ControlRight => self.ctrl = true,
            _ => self.meta = true,
        }
        if self.ctrl && self.meta && !self.active {
            self.active = true;
            Some(ChordEdge::Activated)
        } else {
            None
        }
    }

    pub fn key_up(&mut self, key: Key) -> Option<ChordEdge> {
        if !Self::is_chord_key(key) {
            return None;
        }
        let was_active = self.active;
        match key {
            Key::ControlLeft | Key::ControlRight => self.ctrl = false,
            _ => self.meta = false,
        }
        if was_active && !(self.ctrl && self.meta) {
            self.active = false;
            Some(ChordEdge::Released)
        } else {
            None
        }
    }
}

/// Hold-to-talk intent for the M0 skeleton: press starts capture,
/// release ends it and hands the take to transcription (S3/S4 wire
/// the stages behind these phases). Toggle-to-talk is M1 scope.
pub fn resolve_edge(edge: ChordEdge, phase: Phase) -> Option<Phase> {
    match (edge, phase) {
        (ChordEdge::Activated, Phase::Idle) => Some(Phase::Listening),
        (ChordEdge::Released, Phase::Listening) => Some(Phase::Thinking),
        _ => None,
    }
}

#[tauri::command]
pub fn get_hotkey_label() -> String {
    DEFAULT_HOTKEY_LABEL.to_string()
}

/// Blocks on its own thread: feeds OS key events into the tracker and
/// moves the pipeline on chord edges. A dead listener is a Failed
/// pipeline, never a silently deaf hotkey.
pub fn run_listener(app: AppHandle) {
    let mut tracker = ChordTracker::default();
    let err_app = app.clone();
    if let Err(error) = rdev::listen(move |event| {
        let edge = match event.event_type {
            EventType::KeyPress(key) => tracker.key_down(key),
            EventType::KeyRelease(key) => tracker.key_up(key),
            _ => None,
        };
        if let Some(edge) = edge {
            match edge {
                ChordEdge::Activated => audio::begin_take(&app),
                ChordEdge::Released => audio::end_take(&app),
            }
        }
    }) {
        set_phase(
            &err_app,
            Phase::Failed,
            Some(format!("hotkey listener failed: {error:?}")),
        );
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use rdev::Key::*;

    #[test]
    fn activates_when_second_side_goes_down_either_order() {
        let mut t = ChordTracker::default();
        assert_eq!(t.key_down(ControlLeft), None);
        assert_eq!(t.key_down(MetaLeft), Some(ChordEdge::Activated));

        let mut t = ChordTracker::default();
        assert_eq!(t.key_down(MetaRight), None);
        assert_eq!(t.key_down(ControlRight), Some(ChordEdge::Activated));
    }

    #[test]
    fn repeat_press_while_held_emits_no_second_edge() {
        let mut t = ChordTracker::default();
        t.key_down(ControlLeft);
        assert_eq!(t.key_down(MetaLeft), Some(ChordEdge::Activated));
        assert_eq!(t.key_down(MetaLeft), None);
        assert_eq!(t.key_down(ControlLeft), None);
    }

    #[test]
    fn releases_when_either_side_comes_up() {
        let mut t = ChordTracker::default();
        t.key_down(ControlLeft);
        t.key_down(MetaLeft);
        assert_eq!(t.key_up(ControlLeft), Some(ChordEdge::Released));

        let mut t = ChordTracker::default();
        t.key_down(ControlRight);
        t.key_down(MetaRight);
        assert_eq!(t.key_up(MetaRight), Some(ChordEdge::Released));
    }

    #[test]
    fn unrelated_keys_are_ignored() {
        let mut t = ChordTracker::default();
        assert_eq!(t.key_down(Space), None);
        assert_eq!(t.key_up(Space), None);
        t.key_down(ControlLeft);
        assert_eq!(t.key_down(Space), None);
        assert_eq!(t.key_up(Space), None);
        assert_eq!(t.key_up(ControlLeft), None);
    }

    #[test]
    fn hold_intent_moves_idle_to_listening_to_thinking() {
        assert_eq!(
            resolve_edge(ChordEdge::Activated, Phase::Idle),
            Some(Phase::Listening)
        );
        assert_eq!(
            resolve_edge(ChordEdge::Released, Phase::Listening),
            Some(Phase::Thinking)
        );
    }

    #[test]
    fn edges_outside_a_take_are_ignored() {
        assert_eq!(resolve_edge(ChordEdge::Released, Phase::Idle), None);
        assert_eq!(resolve_edge(ChordEdge::Activated, Phase::Listening), None);
        assert_eq!(resolve_edge(ChordEdge::Activated, Phase::Thinking), None);
        assert_eq!(resolve_edge(ChordEdge::Released, Phase::Thinking), None);
    }
}

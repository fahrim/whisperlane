//! Where transcribed text goes, and how it gets there.
//!
//! One destination exists in v1: the focused application. The agent
//! variant is carried so the phase-two door is a new destination rather
//! than a redesign (docs/06-agent-integration.md); nothing here constructs
//! it.
//!
//! This module is the seam. Everything above it — capture, transcription,
//! cancellation, what the indicator says — is the same whatever the
//! destination is, and everything below it is one module per destination.
//! Adding the agent destination means adding a module and an arm below,
//! and nothing above.
//!
//! It also owns the decision of whether a take delivers at all, because
//! that decision is made in the same breath as where it goes. Split
//! across two modules it would be half in one place and half in the
//! other, and the half that answers "should this have happened" is the
//! half a caller would get wrong.
//!
//! The destinations below are private children, so the seam is a boundary
//! the compiler holds rather than a convention: no other part of the
//! program can write into an application, because the only path to one
//! is through here.

use tauri::AppHandle;

use crate::pipeline::{self, InsertionTarget, Phase};

mod focused;

/// What delivery does, given where the take was recorded as going.
///
/// A type of its own rather than matching on the destination inside the
/// delivery step, so the routing is a decision that can be checked on its
/// own. Matching inline would leave the one thing this module exists to
/// guarantee written as a comment instead of as an assertion.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Route {
    /// Type it into the focused application (ADR-005).
    FocusedApp,
    /// Reserved for phase two. Nothing constructs it in v1.
    Agent,
}

/// Where a recorded destination actually sends the text.
fn route_for(target: &InsertionTarget) -> Route {
    match target {
        InsertionTarget::FocusedApp => Route::FocusedApp,
        InsertionTarget::Agent(_) => Route::Agent,
    }
}

/// Whether a take is finished and worth sending at all.
///
/// The transcript is checked for content rather than for length: the
/// engine can return whitespace for a recording of nothing, and an empty
/// string arriving is not the same as no result.
fn should_deliver(phase: Option<Phase>, text: Option<&str>) -> bool {
    matches!(phase, Some(Phase::Done)) && text.is_some_and(|t| !t.trim().is_empty())
}

/// Delivers a finished take to the destination it was recorded for.
///
/// The one entry point. Everything the caller would need to know — is
/// there text, is the take finished, where is it going — is already
/// recorded, so a caller asks for delivery rather than for insertion and
/// cannot put text in the wrong place by mistake.
pub fn deliver(app: &AppHandle) {
    let Some(text) = crate::deliver::last_text_of(app) else {
        return;
    };
    if !should_deliver(pipeline::current_phase(app), Some(&text)) {
        return;
    }
    match route_for(&pipeline::target_of(app)) {
        Route::FocusedApp => {
            let outcome = focused::insert(app, &text);
            pipeline::set_delivery(app, outcome.kind(), outcome.notice().map(str::to_string));
        }
        Route::Agent => {
            // Unreachable while the agent destination is phase two, and
            // reported rather than ignored: if a take ever reaches a
            // destination that has no implementation, the text went
            // nowhere, and a take that says it landed when it did not is
            // the one failure this product is not allowed to make.
            pipeline::set_delivery(
                app,
                pipeline::DeliveryKind::None,
                Some("no way to deliver to the chosen destination yet".to_string()),
            );
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_take_follows_the_destination_it_was_recorded_for() {
        // The point of the seam: the destination is read, not assumed. If
        // this ever stopped holding, a second destination would arrive as
        // text typed into whatever happened to be focused — which is the
        // failure phase two has to not inherit.
        assert_eq!(route_for(&InsertionTarget::FocusedApp), Route::FocusedApp);
        assert_eq!(
            route_for(&InsertionTarget::Agent("codex".to_string())),
            Route::Agent
        );
    }

    #[test]
    fn delivers_only_finished_takes_with_something_in_them() {
        assert!(should_deliver(Some(Phase::Done), Some("merhaba")));
        // Whitespace is what the engine returns for a recording of
        // nothing; sending it would type spaces into the user's document.
        assert!(!should_deliver(Some(Phase::Done), Some("   ")));
        assert!(!should_deliver(Some(Phase::Done), None));
        assert!(!should_deliver(Some(Phase::Thinking), Some("merhaba")));
        assert!(!should_deliver(Some(Phase::Idle), Some("merhaba")));
        assert!(!should_deliver(None, Some("merhaba")));
    }
}

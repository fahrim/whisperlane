//! Focused-application insertion (ADR-005): native input synthesis is
//! the primary path, the clipboard is the fallback, and neither is
//! silent.
//!
//! Two shapes live here on purpose. Everything that decides something —
//! which keys a text needs, what a partial result means, whether a
//! fallback is honest — is pure and unit-tested. The Windows calls are a
//! thin shell with no decisions in it.
//!
//! Why synthesis and not the clipboard alone: synthesis is invisible
//! when it works, and the clipboard alone would silently destroy what
//! the user had copied while still pretending the text landed.
//!
//! Why a fallback at all: Windows refuses injection into a window that
//! runs above us in privilege, and some applications filter synthetic
//! input. In those cases the honest outcome is the clipboard plus a
//! plain notice, not a silent failure.

use serde::Serialize;
use tauri::{AppHandle, Manager};
use tauri_plugin_clipboard_manager::ClipboardExt;
use windows::Win32::UI::Input::KeyboardAndMouse::{
    INPUT, INPUT_0, INPUT_KEYBOARD, KEYBDINPUT, KEYBD_EVENT_FLAGS, KEYEVENTF_KEYUP,
    KEYEVENTF_UNICODE, VIRTUAL_KEY,
};
use windows::Win32::UI::WindowsAndMessaging::GetForegroundWindow;

use crate::pipeline::{set_delivery, DeliveryKind};

/// Events per `SendInput` call. The system buffer is finite, so a long
/// transcript is typed in chunks rather than dropped.
const CHUNK: usize = 64;

/// How the text reached the user.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum Insertion {
    /// Every keystroke landed in the focused application.
    Typed,
    /// Some of the text landed and the rest did not. The text is not
    /// re-delivered anywhere, because repeating it would duplicate the
    /// part that already arrived.
    Partial { typed_chars: usize },
    /// Nothing landed. The text is on the clipboard instead.
    Clipboard { notice: String },
}

impl Insertion {
    /// Whether the user needs to act. A clean type-in needs nothing; the
    /// other two say so in as many words.
    pub fn notice(&self) -> Option<&str> {
        match self {
            Insertion::Typed => None,
            Insertion::Clipboard { notice } => Some(notice),
            Insertion::Partial { .. } => {
                Some("only part of the text could be inserted")
            }
        }
    }

    /// How the interface should report this without re-deriving it from
    /// the wording above.
    pub const fn kind(&self) -> DeliveryKind {
        match self {
            Insertion::Typed => DeliveryKind::Typed,
            Insertion::Partial { .. } => DeliveryKind::Partial,
            Insertion::Clipboard { .. } => DeliveryKind::Clipboard,
        }
    }
}

/// A planned keystroke: one UTF-16 code unit, pressed or released.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Keystroke {
    pub unit: u16,
    pub down: bool,
}

/// The keystrokes that type `text`.
///
/// Text is sent as Unicode rather than as scan codes, so characters
/// outside the active keyboard layout still arrive correctly: a
/// Turkish user dictating gets their own letters, not the layout's.
pub fn keystrokes(text: &str) -> Vec<Keystroke> {
    let mut plan = Vec::with_capacity(text.len() * 2);
    // `encode_utf16` keeps surrogate pairs intact: each unit is its own
    // keystroke, which is what the platform expects.
    for unit in text.encode_utf16() {
        plan.push(Keystroke { unit, down: true });
        plan.push(Keystroke {
            unit,
            down: false,
        });
    }
    plan
}

/// Whether the focused window is one of ours.
///
/// Inserting into ourselves would be useless and confusing: the text
/// would land in a status panel instead of the application the user
/// meant to write in. Detected up front, because after typing there is
/// nothing to undo.
pub fn focus_is_ours(app: &AppHandle) -> bool {
    let Some(window) = app.get_webview_window("main") else {
        return false;
    };
    let Ok(ours) = window.hwnd() else {
        return false;
    };
    // Tauri hands back a handle from `windows-sys` while the platform
    // call returns one from `windows`: the same pointer in two wrapper
    // types, so the raw values are what get compared.
    // SAFETY: reading both handle values cannot fail.
    unsafe { GetForegroundWindow().0 as isize == ours.0 as isize }
}

/// What a synthesis result means.
///
/// The rule that matters: when nothing was typed, the clipboard takes
/// the text; when something was typed, nothing is re-sent, because a
/// second copy would duplicate what already arrived. `windows` ignores
/// input aimed at a more privileged window and reports zero events, so
/// a zero here means clean: nothing landed.
pub fn decide(planned_chars: usize, typed_chars: usize, ours: bool) -> Insertion {
    if ours {
        return Insertion::Clipboard {
            notice: "whisperlane has focus — text is on the clipboard".to_string(),
        };
    }
    if planned_chars == 0 {
        return Insertion::Typed;
    }
    match typed_chars {
        0 => Insertion::Clipboard {
            notice: "could not type into that app — text is on the clipboard".to_string(),
        },
        typed if typed >= planned_chars => Insertion::Typed,
        typed => Insertion::Partial { typed_chars: typed },
    }
}

/// One platform input event for a planned keystroke.
fn input_of(keystroke: Keystroke) -> INPUT {
    INPUT {
        r#type: INPUT_KEYBOARD,
        Anonymous: INPUT_0 {
            ki: KEYBDINPUT {
                wVk: VIRTUAL_KEY(0),
                wScan: keystroke.unit,
                dwFlags: KEYEVENTF_UNICODE
                    | if keystroke.down {
                        KEYBD_EVENT_FLAGS(0)
                    } else {
                        KEYEVENTF_KEYUP
                    },
                time: 0,
                dwExtraInfo: 0,
            },
        },
    }
}

/// Types `text` into the focused application, returning how many
/// characters the platform accepted.
///
/// Character count rather than event count, so a dropped release event
/// reads as an incomplete character instead of a phantom extra one.
/// Stops at the first rejection: once the platform refuses input,
/// continuing would only spray keystrokes into another window.
pub fn synthesize(text: &str) -> usize {
    let plan = keystrokes(text);
    let mut typed = 0usize;
    for chunk in plan.chunks(CHUNK * 2) {
        let sent: Vec<INPUT> = chunk.iter().copied().map(input_of).collect();
        // SAFETY: the slice is fully initialized and sized by the call.
        let accepted = unsafe {
            windows::Win32::UI::Input::KeyboardAndMouse::SendInput(&sent, 1)
        } as usize;
        // Every character needs both its press and its release to count.
        typed += accepted / 2;
        if accepted < sent.len() {
            break;
        }
    }
    typed.min(text.encode_utf16().count())
}

/// The full delivery step for a finished take: type the text, or put it
/// on the clipboard and say so.
///
/// Reports what happened through the pipeline so the user is never left
/// guessing whether the text was inserted.
pub fn insert(app: &AppHandle, text: &str) -> Insertion {
    let planned = text.encode_utf16().count();
    if text.is_empty() {
        return Insertion::Typed;
    }
    let ours = focus_is_ours(app);
    // Our own focus is known before typing: there is nothing to send.
    let typed = if ours { 0 } else { synthesize(text) };
    let outcome = decide(planned, typed, ours);
    // Some of the text already in the application is never re-sent: a
    // second copy would duplicate the part that arrived.
    let Insertion::Clipboard { notice } = outcome else {
        return outcome;
    };
    // A clipboard failure must not lose the text: the window still
    // shows it, and the notice says where it is.
    if app.clipboard().write_text(text.to_string()).is_err() {
        return Insertion::Clipboard {
            notice: format!(
                "{notice} — but the clipboard could not be written either"
            ),
        };
    }
    Insertion::Clipboard {
        notice: notice.to_string(),
    }
}

/// Called right after a take reaches Done.
pub fn deliver(app: &AppHandle) {
    let Some(text) = crate::deliver::last_text_of(app) else {
        return;
    };
    if !crate::deliver::should_deliver(crate::pipeline::current_phase(app), Some(&text)) {
        return;
    }
    let outcome = insert(app, &text);
    set_delivery(app, outcome.kind(), outcome.notice().map(str::to_string));
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn plain_text_types_and_releases_every_character() {
        let plan = keystrokes("hi");
        assert_eq!(
            plan,
            vec![
                Keystroke { unit: b'h' as u16, down: true },
                Keystroke { unit: b'h' as u16, down: false },
                Keystroke { unit: b'i' as u16, down: true },
                Keystroke { unit: b'i' as u16, down: false },
            ]
        );
    }

    #[test]
    fn characters_outside_the_layout_still_type() {
        // A Turkish dotless i: sent as Unicode, not as the layout's key.
        let plan = keystrokes("ı");
        assert_eq!(plan[0].unit, 0x0131);
        assert!(plan[0].down);
    }

    #[test]
    fn text_outside_the_basic_plane_keeps_its_surrogate_pair() {
        // One emoji is two code units, so four keystrokes.
        assert_eq!(keystrokes("😀").len(), 4);
        assert_eq!(keystrokes("😀")[0].unit, 0xD83D);
    }

    #[test]
    fn empty_text_plans_nothing() {
        assert!(keystrokes("").is_empty());
    }

    #[test]
    fn everything_accepted_is_a_clean_type_in() {
        assert_eq!(decide(10, 10, false), Insertion::Typed);
        assert_eq!(decide(10, 12, false), Insertion::Typed);
    }

    #[test]
    fn nothing_accepted_falls_back_to_the_clipboard_and_says_so() {
        let outcome = decide(10, 0, false);
        match outcome {
            Insertion::Clipboard { notice } => assert!(notice.contains("clipboard")),
            other => panic!("expected a clipboard fallback, got {other:?}"),
        }
    }

    #[test]
    fn partial_acceptance_never_sends_the_text_twice() {
        // Half the text landed: re-sending would duplicate it, so the
        // outcome is a plain report and nothing else.
        assert_eq!(
            decide(10, 5, false),
            Insertion::Partial { typed_chars: 5 }
        );
    }

    #[test]
    fn our_own_focus_never_types_into_ourselves() {
        match decide(10, 10, true) {
            Insertion::Clipboard { notice } => {
                assert!(notice.contains("whisperlane has focus"))
            }
            other => panic!("expected the clipboard, got {other:?}"),
        }
    }

    #[test]
    fn empty_text_never_types_and_never_falls_back() {
        assert_eq!(decide(0, 0, false), Insertion::Typed);
        // Focus is checked first on purpose: the caller never reaches
        // here with empty text, and if it did, saying where the text is
        // would be the honest answer.
        assert!(matches!(decide(0, 0, true), Insertion::Clipboard { .. }));
    }

    #[test]
    fn only_a_clean_type_in_needs_no_notice() {
        assert_eq!(Insertion::Typed.notice(), None);
        assert!(Insertion::Partial { typed_chars: 3 }.notice().is_some());
        assert!(Insertion::Clipboard {
            notice: "x".to_string()
        }
        .notice()
        .is_some());
    }

    #[test]
    fn every_outcome_reports_its_kind() {
        assert_eq!(Insertion::Typed.kind(), DeliveryKind::Typed);
        assert_eq!(
            Insertion::Partial { typed_chars: 3 }.kind(),
            DeliveryKind::Partial
        );
        assert_eq!(
            Insertion::Clipboard {
                notice: "x".to_string()
            }
            .kind(),
            DeliveryKind::Clipboard
        );
    }
}
//! The tray affordance: the quiet home when the pill is hidden
//! (docs/04-experience.md). Status at a glance, a way to start
//! dictating, and a path to settings — and nothing else, because the
//! tray is what stays on screen for the whole day.
//!
//! The tray reports state; it never decides any. Every item here is a
//! restatement of something the pipeline already knows.

use std::sync::OnceLock;

use tauri::{
    AppHandle, Manager,
    menu::{Menu, MenuItem, PredefinedMenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
};

use crate::audio::{TakeCommand, request};
use crate::hotkey::current_binding;
use crate::models::ModelReadiness;
use crate::pipeline::Phase;

/// The tray icon's identifier.
const TRAY: &str = "tray";

/// The five status marks, embedded rather than read from disk.
///
/// The tray has to answer "what is it doing" from a glance, and an icon
/// that has to be found on disk at the moment the phase changes is an
/// icon that can be missing at the moment it is needed. Five small
/// files, carried in the binary.
mod status_art {
    pub const IDLE: &[u8] = include_bytes!("../icons/status/tray-idle.png");
    pub const LISTENING: &[u8] = include_bytes!("../icons/status/tray-listening-active.png");
    pub const PROCESSING: &[u8] = include_bytes!("../icons/status/tray-processing.png");
    pub const MUTED: &[u8] = include_bytes!("../icons/status/tray-muted.png");
    pub const ERROR: &[u8] = include_bytes!("../icons/status/tray-error.png");
}

/// The artwork for a state, as it stands in the tray.
///
/// Every phase maps to one of the five marks. What is not a phase —
/// nothing has happened yet — reads as idle rather than as an absence,
/// because an icon that blinks when the app has only just started looks
/// like it has lost something.
///
/// At rest the mark also answers what the line answers: a model that is
/// not on disk is a mark that says the tool cannot work, and one on its
/// way is the processing mark. A live or finished take keeps its own
/// mark, because that is the moment; only the resting phase defers to
/// the model.
pub fn status_art_for(phase: Option<Phase>, readiness: ModelReadiness) -> &'static [u8] {
    match phase {
        Some(Phase::Listening) => status_art::LISTENING,
        Some(Phase::Thinking) => status_art::PROCESSING,
        Some(Phase::Failed) => status_art::ERROR,
        Some(Phase::Cancelled) => status_art::MUTED,
        Some(Phase::Done) => status_art::IDLE,
        Some(Phase::Idle) | None if readiness.downloading => status_art::PROCESSING,
        Some(Phase::Idle) | None if !readiness.present => status_art::ERROR,
        Some(Phase::Idle) | None => status_art::IDLE,
    }
}

const SHOW_PILL: &str = "show_pill";
const START: &str = "start";
const SETTINGS: &str = "settings";
const QUIT: &str = "quit";

/// The menu items this module has to rewrite as the pipeline moves.
///
/// The tray holds no getter for the menu it was built with, so the two
/// live items are kept here and updated in place.
struct TrayItems {
    status: MenuItem<tauri::Wry>,
    start: MenuItem<tauri::Wry>,
}

static ITEMS: OnceLock<TrayItems> = OnceLock::new();

/// The shortcut shown beside "Start dictating". The chord is the
/// primary gesture, so the menu points at it rather than describing the
/// button as the way in.
fn chord_hint() -> String {
    format!(" ({})", current_binding().label())
}

/// Whether starting from the tray is worth offering.
///
/// Nothing to start while a take is live or being transcribed: pressing
/// it then would be ignored by the same decision table the chord goes
/// through, and a menu item that silently does nothing is worse than one
/// that is not there.
///
/// A missing model is deliberately not consulted here. Starting without
/// one still says why — the pill shows the same sentence the resting line
/// already used — while a greyed item with no explanation would hide that
/// answer and look like a dead menu rather than a missing model.
pub fn can_start_in(phase: Option<Phase>) -> bool {
    !matches!(phase, Some(Phase::Listening) | Some(Phase::Thinking))
}

/// What the tray says while nothing is happening.
///
/// "Ready when you are" is a promise the model has to keep: an install
/// with no model cannot take a word, and the tray would be the second
/// surface repeating the pill's lie. It names the state instead, and the
/// Settings item two rows below is the way out. The tray has no room for
/// the pill's whole sentence, and does not need it — the reason behind a
/// failure belongs on the pill. A model on its way is the working state,
/// because that is what the app is doing.
fn resting_line(readiness: ModelReadiness) -> &'static str {
    if readiness.downloading {
        "Downloading the model…"
    } else if readiness.damaged {
        "Model file incomplete"
    } else if !readiness.present {
        "Model not downloaded"
    } else {
        Phase::Idle.label()
    }
}

/// The one line the tray says: the state, in the same words every other
/// surface uses. A running take keeps its own phase words, because that
/// is the moment; the resting phase defers to the model.
pub fn status_line(phase: Option<Phase>, readiness: ModelReadiness) -> &'static str {
    match phase {
        None | Some(Phase::Idle) => resting_line(readiness),
        Some(live) => live.label(),
    }
}

/// Creates the tray icon and its menu.
pub fn build(app: &AppHandle) -> tauri::Result<()> {
    // Read once, before the tray exists: the first thing the user sees
    // must be the state as it is, not the state a phase change last
    // happened to leave behind.
    let readiness = crate::models::readiness(app);
    let status = MenuItem::with_id(app, "status", status_line(None, readiness), false, None::<&str>)?;
    let show_pill = MenuItem::with_id(app, SHOW_PILL, "Show Pill", true, None::<&str>)?;
    let start = MenuItem::with_id(app, START, "Start dictating", true, Some(chord_hint()))?;
    let settings = MenuItem::with_id(app, SETTINGS, "Settings…", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, QUIT, "Quit whisperlane", true, None::<&str>)?;
    let first_rule = PredefinedMenuItem::separator(app)?;
    let last_rule = PredefinedMenuItem::separator(app)?;
    let menu = Menu::with_items(
        app,
        &[&status, &first_rule, &show_pill, &start, &settings, &last_rule, &quit],
    )?;
    // Stored before the tray exists, so the very first phase change
    // already has something to rewrite.
    let _ = ITEMS.set(TrayItems { status, start });

    // The tray opens on the idle mark rather than the window icon: the
    // tray's whole job is to say what the app is doing, and "idle" is
    // what it is doing when nothing has happened yet.
    let icon = tauri::image::Image::from_bytes(status_art_for(None, readiness))
        .expect("idle status art is not a readable image");
    TrayIconBuilder::with_id(TRAY)
        .icon(icon)
        .tooltip("whisperlane")
        .menu(&menu)
        .on_menu_event(|app, event| match event.id.as_ref() {
            QUIT => app.exit(0),
            SHOW_PILL => {
                if let Some(pill) = app.get_webview_window(crate::windows::PILL) {
                    let _ = pill.show();
                    let _ = pill.unminimize();
                }
            }
            // The same command the pill's three-dot control calls, so
            // there is one path to settings rather than two.
            SETTINGS => crate::windows::toggle_settings(app.clone()),
            // The tray's quick start is the same intent as a chord
            // press, queued to the same worker.
            START => {
                request(TakeCommand::Control);
            }
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                let pill = tray.app_handle().get_webview_window(crate::windows::PILL);
                let is_pill_visible = pill
                    .as_ref()
                    .and_then(|w| w.is_visible().ok())
                    .unwrap_or(false);
                let is_pill_minimized = pill
                    .as_ref()
                    .and_then(|w| w.is_minimized().ok())
                    .unwrap_or(false);

                if !is_pill_visible || is_pill_minimized {
                    if let Some(w) = pill {
                        let _ = w.show();
                        let _ = w.unminimize();
                    }
                } else {
                    // Pill is already visible on screen, so clicking the tray
                    // manages the settings surface.
                    crate::windows::toggle_settings(tray.app_handle().clone());
                }
            }
        })
        .build(app)?;
    Ok(())
}

/// Rewrites the tray's status line and mark for the current state.
pub fn refresh(app: &AppHandle, phase: Option<Phase>) {
    let (Some(tray), Some(items)) = (app.tray_by_id(TRAY), ITEMS.get()) else {
        return;
    };
    let readiness = crate::models::readiness(app);
    // The tooltip is the glance; the menu line is the deliberate look.
    let line = status_line(phase, readiness);
    let _ = tray.set_tooltip(Some(format!("whisperlane — {line}")));
    let _ = items.status.set_text(line);
    let _ = items.start.set_enabled(can_start_in(phase));
    if let Ok(image) = tauri::image::Image::from_bytes(status_art_for(phase, readiness)) {
        let _ = tray.set_icon(Some(image));
    }
}

/// Rewrites the tray for the state as it stands.
///
/// Some things that change what the tray says are not phases — a model
/// fetch starting or finishing, the chosen model changing — so they
/// cannot ride on the phase writer. They say so here rather than leaving
/// a line that was true only before the fetch began.
pub fn refresh_now(app: &AppHandle) {
    refresh(app, crate::pipeline::current_phase(app));
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_quiet_home_offers_a_start_only_when_one_would_work() {
        // At rest and after a finished take: there is something to
        // start.
        for resting in [
            None,
            Some(Phase::Idle),
            Some(Phase::Done),
            Some(Phase::Failed),
            Some(Phase::Cancelled),
        ] {
            assert!(can_start_in(resting), "no start offered from {resting:?}");
        }
        // A live take cannot be started, and a menu item that quietly
        // does nothing is worse than one that is absent.
        assert!(!can_start_in(Some(Phase::Listening)));
        assert!(!can_start_in(Some(Phase::Thinking)));
    }

    /// A model on disk and no fetch running: the tray's resting state.
    fn ready() -> ModelReadiness {
        ModelReadiness {
            present: true,
            damaged: false,
            downloading: false,
            hint: None,
        }
    }

    /// No model on disk, with nothing being fetched.
    fn missing() -> ModelReadiness {
        ModelReadiness {
            present: false,
            damaged: false,
            downloading: false,
            hint: Some(crate::models::MODEL_MISSING_HINT),
        }
    }

    /// A file is on disk, but it cannot be used.
    fn damaged() -> ModelReadiness {
        ModelReadiness {
            present: false,
            damaged: true,
            downloading: false,
            hint: Some(crate::models::MODEL_DAMAGED_HINT),
        }
    }

    /// The chosen model is on its way.
    fn fetching() -> ModelReadiness {
        ModelReadiness {
            present: false,
            damaged: false,
            downloading: true,
            hint: Some(crate::models::MODEL_MISSING_HINT),
        }
    }

    #[test]
    fn every_phase_shows_a_mark_and_nothing_is_left_out() {
        // A phase with no artwork would leave the tray showing the
        // previous one, which reads as a stale state rather than as a
        // missing one.
        let marks = [
            status_art_for(None, ready()),
            status_art_for(Some(Phase::Idle), ready()),
            status_art_for(Some(Phase::Listening), ready()),
            status_art_for(Some(Phase::Thinking), ready()),
            status_art_for(Some(Phase::Done), ready()),
            status_art_for(Some(Phase::Failed), ready()),
            status_art_for(Some(Phase::Cancelled), ready()),
        ];
        assert!(
            marks.iter().all(|m| !m.is_empty()),
            "an embedded mark is empty"
        );
        assert!(tauri::image::Image::from_bytes(status_art_for(None, ready())).is_ok());
        // The states a user would be confused to confuse must not share
        // a mark: recording and transcribing are both "busy" but they
        // are not the same job.
        assert_ne!(
            status_art_for(Some(Phase::Listening), ready()),
            status_art_for(Some(Phase::Thinking), ready())
        );
        assert_ne!(
            status_art_for(Some(Phase::Failed), ready()),
            status_art_for(Some(Phase::Cancelled), ready())
        );
        // Nothing has happened yet reads as idle, not as a gap.
        assert_eq!(
            status_art_for(None, ready()),
            status_art_for(Some(Phase::Idle), ready())
        );
    }

    #[test]
    fn a_resting_tray_answers_for_the_model_it_has() {
        // No model is not "ready": the mark says the tool cannot work,
        // and the line says why without swallowing a sentence.
        assert_eq!(status_art_for(None, missing()), status_art::ERROR);
        assert_eq!(status_art_for(Some(Phase::Idle), missing()), status_art::ERROR);
        assert_eq!(status_line(None, missing()), "Model not downloaded");
        assert_eq!(
            status_line(Some(Phase::Idle), missing()),
            "Model not downloaded"
        );

        // A file that is present but incomplete is its own answer; the
        // tray must not call it missing and send the user looking for a
        // download that already happened.
        assert_eq!(status_art_for(None, damaged()), status_art::ERROR);
        assert_eq!(status_line(None, damaged()), "Model file incomplete");

        // A model arriving is the working state, the same one a take
        // being written down uses.
        assert_eq!(status_art_for(None, fetching()), status_art::PROCESSING);
        assert_eq!(
            status_art_for(Some(Phase::Idle), fetching()),
            status_art_for(Some(Phase::Thinking), ready())
        );
        assert_eq!(
            status_line(Some(Phase::Idle), fetching()),
            "Downloading the model…"
        );

        // With the model on disk the tray is quiet again.
        assert_eq!(status_art_for(None, ready()), status_art::IDLE);
        assert_eq!(status_line(Some(Phase::Idle), ready()), Phase::Idle.label());
    }

    #[test]
    fn a_take_keeps_its_own_mark_and_words() {
        // The model cannot speak for a take that is on screen: listening
        // while a fetch runs is still listening.
        assert_eq!(
            status_art_for(Some(Phase::Listening), fetching()),
            status_art::LISTENING
        );
        assert_eq!(
            status_line(Some(Phase::Listening), fetching()),
            Phase::Listening.label()
        );
        assert_eq!(
            status_line(Some(Phase::Failed), fetching()),
            Phase::Failed.label()
        );
    }

    #[test]
    fn the_status_line_names_the_state_in_the_core_words() {
        assert_eq!(status_line(None, ready()), Phase::Idle.label());
        assert_eq!(status_line(Some(Phase::Idle), ready()), Phase::Idle.label());
        for phase in [
            Phase::Listening,
            Phase::Thinking,
            Phase::Done,
            Phase::Failed,
            Phase::Cancelled,
        ] {
            assert_eq!(status_line(Some(phase), ready()), phase.label());
        }
    }
}

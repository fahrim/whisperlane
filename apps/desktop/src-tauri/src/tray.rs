//! The tray affordance: the quiet home when the pill is hidden
//! (docs/04-experience.md). Status at a glance, a way to start
//! dictating, and a path to settings — and nothing else, because the
//! tray is what stays on screen for the whole day.
//!
//! The tray reports state; it never decides any. Every item here is a
//! restatement of something the pipeline already knows.

use std::sync::OnceLock;

use tauri::{
    AppHandle,
    menu::{Menu, MenuItem, PredefinedMenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
};

use crate::audio::{TakeCommand, request};
use crate::hotkey::current_binding;
use crate::pipeline::Phase;

/// The tray icon's identifier.
const TRAY: &str = "tray";

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
pub fn can_start_in(phase: Option<Phase>) -> bool {
    !matches!(phase, Some(Phase::Listening) | Some(Phase::Thinking))
}

/// The one line the tray says: the state, in the same words every other
/// surface uses. The reason behind a failure belongs on the pill, which
/// has room for it — a tray line that swallowed a whole sentence would
/// be unreadable at a glance, the only moment it is looked at.
pub fn status_line(phase: Option<Phase>) -> &'static str {
    match phase {
        None | Some(Phase::Idle) => Phase::Idle.label(),
        Some(live) => live.label(),
    }
}

/// Creates the tray icon and its menu.
pub fn build(app: &AppHandle) -> tauri::Result<()> {
    let status = MenuItem::with_id(app, "status", status_line(None), false, None::<&str>)?;
    let start = MenuItem::with_id(app, START, "Start dictating", true, Some(chord_hint()))?;
    let settings = MenuItem::with_id(app, SETTINGS, "Settings…", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, QUIT, "Quit whisperlane", true, None::<&str>)?;
    let first_rule = PredefinedMenuItem::separator(app)?;
    let last_rule = PredefinedMenuItem::separator(app)?;
    let menu = Menu::with_items(
        app,
        &[&status, &first_rule, &start, &settings, &last_rule, &quit],
    )?;
    // Stored before the tray exists, so the very first phase change
    // already has something to rewrite.
    let _ = ITEMS.set(TrayItems { status, start });

    let icon = app
        .default_window_icon()
        .cloned()
        .expect("default window icon missing");
    TrayIconBuilder::with_id(TRAY)
        .icon(icon)
        .tooltip("whisperlane")
        .menu(&menu)
        .on_menu_event(|app, event| match event.id.as_ref() {
            QUIT => app.exit(0),
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
                // The tray's home is settings: the pill is the face, and
                // the tray is where the occasional setting is reached.
                crate::windows::toggle_settings(tray.app_handle().clone());
            }
        })
        .build(app)?;
    Ok(())
}

/// Rewrites the tray's status line for the current phase.
pub fn refresh(app: &AppHandle, phase: Option<Phase>) {
    let (Some(tray), Some(items)) = (app.tray_by_id(TRAY), ITEMS.get()) else {
        return;
    };
    // The tooltip is the glance; the menu line is the deliberate look.
    let line = status_line(phase);
    let _ = tray.set_tooltip(Some(format!("whisperlane — {line}")));
    let _ = items.status.set_text(line);
    let _ = items.start.set_enabled(can_start_in(phase));
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

    #[test]
    fn the_status_line_names_the_state_in_the_core_words() {
        assert_eq!(status_line(None), Phase::Idle.label());
        assert_eq!(status_line(Some(Phase::Idle)), Phase::Idle.label());
        for phase in [
            Phase::Listening,
            Phase::Thinking,
            Phase::Done,
            Phase::Failed,
            Phase::Cancelled,
        ] {
            assert_eq!(status_line(Some(phase)), phase.label());
        }
    }
}

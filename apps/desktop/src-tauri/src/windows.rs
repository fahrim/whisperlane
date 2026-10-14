//! The application's windows: the pill overlay, and the main window the
//! pill's options control opens. One concern — where the product's
//! surfaces live and when they are on screen. No take decisions live
//! here; the pill is shown or hidden because of what the pipeline is
//! doing, never the other way round.

use tauri::{AppHandle, Manager, WebviewUrl, WebviewWindowBuilder};

use crate::pipeline::Phase;

/// Label of the compact overlay the user looks at while dictating.
pub const PILL: &str = "pill";

/// Label of the window holding first run and settings.
pub const MAIN: &str = "main";

/// Compact pill size, and how far above the bottom edge it rests.
const PILL_WIDTH: f64 = 380.0;
const PILL_HEIGHT: f64 = 76.0;
const PILL_BOTTOM_MARGIN: f64 = 48.0;

/// Whether the pill rests on screen for a phase.
///
/// Idle means quiet, so the pill hides and the tray is the home. Every
/// other phase has something to say, including the terminal ones: the
/// transcript and the reason stay readable there until the next take
/// replaces them, which is what keeps the user from ever wondering
/// whether their text was inserted.
pub fn pill_visible_in(phase: Option<Phase>) -> bool {
    !matches!(phase, None | Some(Phase::Idle))
}

/// Where a pill of this size rests on a screen: centred, near the
/// bottom, close to where the caret already is. Never negative, so a
/// small screen cannot push the window off its own origin.
pub fn pill_origin(screen: (f64, f64)) -> (f64, f64) {
    let (width, height) = screen;
    (
        ((width - PILL_WIDTH) / 2.0).max(0.0),
        (height - PILL_HEIGHT - PILL_BOTTOM_MARGIN).max(0.0),
    )
}

/// Creates the pill overlay.
///
/// Borderless, above everything, and never focusable: an overlay that
/// took focus would starve the global chord and would become the
/// destination for the very text it exists to announce. It starts
/// hidden, because resting quietly is the tray's job, not the pill's.
pub fn build_pill(app: &AppHandle) -> tauri::Result<()> {
    let origin = app
        .primary_monitor()
        .ok()
        .flatten()
        .map(|monitor| {
            let size = monitor.size().to_logical::<f64>(monitor.scale_factor());
            pill_origin((size.width, size.height))
        })
        .unwrap_or((0.0, 0.0));
    WebviewWindowBuilder::new(app, PILL, WebviewUrl::default())
        .title("whisperlane")
        .inner_size(PILL_WIDTH, PILL_HEIGHT)
        .position(origin.0, origin.1)
        .decorations(false)
        .resizable(false)
        .shadow(false)
        .always_on_top(true)
        .skip_taskbar(true)
        .focusable(false)
        .visible(false)
        .build()?;
    Ok(())
}

/// Shows or hides the pill for the phase the pipeline is in.
pub fn apply_phase(app: &AppHandle, phase: Option<Phase>) {
    let Some(pill) = app.get_webview_window(PILL) else {
        return;
    };
    let _ = if pill_visible_in(phase) {
        pill.show()
    } else {
        pill.hide()
    };
}

/// Brings the first-run and settings window forward. The pill's
/// three-dot control is the mouse-driven path to it.
#[tauri::command]
pub fn open_settings(app: AppHandle) {
    let Some(main) = app.get_webview_window(MAIN) else {
        return;
    };
    let _ = main.show();
    let _ = main.unminimize();
    let _ = main.set_focus();
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn idle_is_quiet_and_every_other_phase_is_shown() {
        // Idle and a pipeline with no state yet both rest hidden.
        assert!(!pill_visible_in(None));
        assert!(!pill_visible_in(Some(Phase::Idle)));
        for phase in [
            Phase::Listening,
            Phase::Thinking,
            Phase::Done,
            Phase::Failed,
            Phase::Cancelled,
        ] {
            assert!(pill_visible_in(Some(phase)), "{phase:?} has to be legible");
        }
    }

    #[test]
    fn the_pill_sits_centred_above_the_bottom_edge() {
        let (x, y) = pill_origin((1920.0, 1080.0));
        assert_eq!(x, (1920.0 - PILL_WIDTH) / 2.0);
        assert_eq!(y, 1080.0 - PILL_HEIGHT - PILL_BOTTOM_MARGIN);
        // The gap above the bottom edge is the resting margin, not a
        // coincidence of the numbers.
        assert!(y > 0.0 && y < 1080.0 - PILL_HEIGHT);
    }

    #[test]
    fn a_screen_too_small_for_the_pill_still_starts_at_the_origin() {
        // A negative coordinate would push the window off-screen on one
        // side, which reads as a pill that never appears.
        assert_eq!(pill_origin((PILL_WIDTH - 10.0, PILL_HEIGHT)), (0.0, 0.0));
        assert_eq!(pill_origin((0.0, 0.0)), (0.0, 0.0));
    }

    #[test]
    fn a_screen_with_room_keeps_the_resting_margin_above_the_bottom() {
        // Narrow and short, but tall enough for the pill: it still rests
        // above the bottom edge rather than being pinned to the origin.
        let (x, y) = pill_origin((640.0, 300.0));
        assert_eq!(x, (640.0 - PILL_WIDTH) / 2.0);
        assert_eq!(y, 300.0 - PILL_HEIGHT - PILL_BOTTOM_MARGIN);
    }

    #[test]
    fn the_windows_have_their_own_labels() {
        // Insertion refuses to type into either of them, so a label
        // change that missed one would start typing into the pill.
        assert_ne!(PILL, MAIN);
    }
}
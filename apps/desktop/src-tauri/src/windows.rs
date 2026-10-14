//! The application's windows: the pill overlay, and the main window the
//! pill's options control opens. One concern — where the product's
//! surfaces live and when they are on screen. No take decisions live
//! here; the pill is shown or hidden because of what the pipeline is
//! doing, never the other way round.

use std::sync::atomic::Ordering;

use tauri::{AppHandle, Manager, WebviewUrl, WebviewWindowBuilder};
use windows::Win32::Foundation::POINT;
use windows::Win32::UI::WindowsAndMessaging::GetCursorPos;

use crate::pipeline::Phase;

/// Label of the compact overlay the user looks at while dictating.
pub const PILL: &str = "pill";

/// Label of the window holding first run and settings.
pub const MAIN: &str = "main";

/// The pill's own size, matching `--pill-height` in the token set.
///
/// The width is the widest the capsule can ever grow to, not a fixed box:
/// the pill sizes itself to its content and never past this. Claiming more
/// than the pill can reach would make the click-through pad swallow clicks
/// on an empty band beside it.
const PILL_WIDTH: f64 = 430.0;
const PILL_HEIGHT: f64 = 56.0;

/// The accent circles, matching the pill's stylesheet: each one's
/// diameter and how far it is inset from its own edge.
///
/// A circle's glow is the part that still carries light after the
/// gradient falls off and the layer is blurred. It clears an edge only
/// when its own inset plus its own radius covers that reach — a
/// different question at the sides, where the circles sit against the
/// edges rather than at the window's centre.
const AURA_MAIN_DIAMETER: f64 = 130.0;
const AURA_BLUR: f64 = 28.0;
/// Where the radial gradient reaches transparent.
const AURA_FALLOFF: f64 = 0.7;

/// How far a circle of this diameter still carries light.
const fn glow_reach(diameter: f64) -> f64 {
    diameter / 2.0 * AURA_FALLOFF + AURA_BLUR
}

/// Half the window's height, measured from the glow with room to spare.
///
/// The margin is the point. A CSS blur spreads further than its radius
/// suggests, so a window cut exactly to the computed reach still shows a
/// flat line where the light stops; only slack removes it.
const HALF_HEIGHT: f64 = glow_reach(AURA_MAIN_DIAMETER) * 1.7;

/// Empty room around the pill inside the window.
///
/// The material is painted outside the pill — its glow, its shadow, and
/// its upward popover — and a window clips whatever reaches its own
/// edge, so the window is sized with headroom above the pill rather than
/// picked by eye. The extra room costs nothing to whatever sits
/// underneath: the empty part of the window passes the pointer straight
/// through.
const POPOVER_HEADROOM: f64 = 110.0;
const BLEED_X: f64 = 52.0;
const BLEED_TOP: f64 = HALF_HEIGHT - PILL_HEIGHT / 2.0 + POPOVER_HEADROOM;
const BLEED_BOTTOM: f64 = HALF_HEIGHT + 4.0 - PILL_HEIGHT / 2.0;

/// The window is the pill plus its room. Named so this geometry and the
/// CSS padding around the pill can be checked against each other.
const WINDOW_WIDTH: f64 = PILL_WIDTH + BLEED_X * 2.0;
const WINDOW_HEIGHT: f64 = PILL_HEIGHT + BLEED_TOP + BLEED_BOTTOM;

/// What this module's geometry has to keep, checked where it is defined
/// rather than only when the tests happen to run. Every one of these is
/// a way the window could lose the glow, or the pointer.
const _: () = {
    assert!(WINDOW_WIDTH > PILL_WIDTH, "no room at the sides");
    assert!(WINDOW_HEIGHT > PILL_HEIGHT, "no room above or below");
    assert!(
        BLEED_TOP > HALF_HEIGHT,
        "the top room has to fit both the glow and the upward popover"
    );
    // Slack, not a fit: cutting the window to the exact reach of the
    // glow is what draws a line across the light.
    assert!(
        HALF_HEIGHT > glow_reach(AURA_MAIN_DIAMETER) * 1.5,
        "the window leaves too little slack for the glow"
    );
    assert!(
        BLEED_X > 0.0 && PILL_WIDTH > 0.0,
        "the pill's own box cannot be empty"
    );
};

/// The cursor's position on the screen, in physical pixels.
///
/// Read from the platform rather than from the window, because the
/// window's own reading is the one thing a passing-through window cannot
/// be trusted to report. `None` only if the platform refuses outright.
fn cursor_on_screen() -> Option<(f64, f64)> {
    let mut point = POINT::default();
    // SAFETY: the pointer is valid and the call fills the point or fails.
    unsafe { GetCursorPos(&mut point) }.ok()?;
    Some((point.x as f64, point.y as f64))
}

/// The pad of screen around the pill that the pill claims for input.
///
/// Wider than the pill on purpose. A click that lands in the pad but
/// just outside the pill still belongs to the pill rather than to the
/// application underneath, and an overlay that swallows a stray click
/// is more surprising than one that catches a slightly late one.
const HOVER_PAD: f64 = 8.0;

/// Whether a cursor on screen at this point is over the pill rather
/// than over the empty room the window carries around it.
///
/// The window has to be larger than the pill or the glow is clipped,
/// and a larger window catches clicks meant for whatever sits beneath
/// it. The empty room therefore passes the pointer straight through and
/// only the pill itself takes it, so the room costs the application
/// underneath nothing.
pub fn pointer_over_pill(cursor: (f64, f64), window_at: (f64, f64)) -> bool {
    let (cx, cy) = cursor;
    let (wx, wy) = window_at;
    let left = wx + BLEED_X - HOVER_PAD;
    let top = wy + BLEED_TOP - HOVER_PAD;
    (left..=left + PILL_WIDTH + HOVER_PAD * 2.0).contains(&cx)
        && (top..=top + PILL_HEIGHT + HOVER_PAD * 2.0).contains(&cy)
}

/// Whether the pill's popover menu is currently open, expanding the
/// click-receiving area into the upper bleed room while open.
pub struct PopoverOpen(pub std::sync::atomic::AtomicBool);

/// Sets whether the pill's popover menu is open so click-through can
/// allow pointer interaction with the popover above the pill.
#[tauri::command]
pub fn set_popover_open(app: AppHandle, open: bool) {
    if let Some(state) = app.try_state::<PopoverOpen>() {
        state.0.store(open, Ordering::Relaxed);
    }
}

/// Whether the pill is currently taking the cursor, so the next poll
/// knows whether the platform flag has to change at all.
pub struct CursorPassthrough(pub std::sync::atomic::AtomicBool);

/// Keeps the empty room transparent to the mouse and the pill opaque to
/// it.
///
/// Polled rather than driven by hover, because a window that passes its
/// own pointer through cannot receive the hover that would turn it back
/// off. The check only runs while the pill is on screen, so an overlay
/// resting at idle costs nothing.
pub fn spawn_click_through(app: &AppHandle) {
    let worker = app.clone();
    std::thread::spawn(move || {
        loop {
            std::thread::sleep(std::time::Duration::from_millis(60));
            let Some(window) = worker.get_webview_window(PILL) else {
                continue;
            };
            let visible = window.is_visible().unwrap_or(false);
            if !visible {
                continue;
            };
            let (Some((cx, cy)), Ok(at)) = (cursor_on_screen(), window.outer_position()) else {
                continue;
            };
            let popover_open = worker
                .try_state::<PopoverOpen>()
                .is_some_and(|state| state.0.load(Ordering::Relaxed));
            let over_pill = if popover_open {
                let (wx, wy) = (at.x as f64, at.y as f64);
                let left = wx + BLEED_X - HOVER_PAD;
                let top = wy;
                (left..=left + PILL_WIDTH + HOVER_PAD * 2.0).contains(&cx)
                    && (top..=wy + BLEED_TOP + PILL_HEIGHT + HOVER_PAD).contains(&cy)
            } else {
                pointer_over_pill((cx, cy), (at.x as f64, at.y as f64))
            };
            let already = worker
                .try_state::<CursorPassthrough>()
                .is_some_and(|state| state.0.load(Ordering::Relaxed));
            if over_pill != already {
                let _ = window.set_ignore_cursor_events(!over_pill);
                if let Some(state) = worker.try_state::<CursorPassthrough>() {
                    state.0.store(over_pill, Ordering::Relaxed);
                }
            }
        }
    });
}

/// How far above the bottom edge the pill's own edge rests.
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
/// Where the pill window rests on a screen: centred, with the pill's own
/// bottom edge at the resting margin. Centring the window rather than
/// the pill is what keeps the glow symmetric, because the room around
/// the pill is not itself symmetric.
pub fn pill_origin(screen: (f64, f64)) -> (f64, f64) {
    let (width, height) = screen;
    (
        ((width - WINDOW_WIDTH) / 2.0).max(0.0),
        (height - PILL_HEIGHT - PILL_BOTTOM_MARGIN - BLEED_TOP).max(0.0),
    )
}

/// Creates the pill overlay.
///
/// Borderless, above everything, and never focusable: an overlay that
/// took focus would starve the global chord and would become the
/// destination for the very text it exists to announce. It starts
/// hidden, because resting quietly is the tray's job, not the pill's.
///
/// Transparent because the material is painted outside the pill's own
/// edge. A window that paints its own background would cut the glow and
/// the shadow off at its border, which is the one thing the glass
/// cannot survive. Windows draws its own shadow for frameless windows,
/// so ours is turned off rather than doubled.
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
        .inner_size(WINDOW_WIDTH, WINDOW_HEIGHT)
        .position(origin.0, origin.1)
        .decorations(false)
        .transparent(true)
        .resizable(false)
        .shadow(false)
        .always_on_top(true)
        .skip_taskbar(true)
        .focusable(false)
        .visible(false)
        .build()?;
    // The room around the pill passes the pointer through from the very
    // first moment, so nothing underneath is ever unreachable by it.
    if let Some(window) = app.get_webview_window(PILL) {
        let _ = window.set_ignore_cursor_events(true);
    }
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

/// Whether asking for settings should close them rather than open them.
///
/// Visibility alone, with no question asked about focus. Focus is not a
/// reliable answer at the moment the control is pressed — the click
/// itself moves focus out from under the check, so a rule that waits
/// for the window to still be in front takes the open branch and the
/// control appears to do nothing. One control, one honest flip.
///
/// The cost is that pressing it while settings sit behind another
/// window puts them away instead of bringing them forward. The user
/// presses it to dismiss or to open, never to rearrange, and a second
/// press puts it right.
fn settings_toggle_closes(visible: bool) -> bool {
    visible
}

/// Brings the settings window forward, or puts it away again when it is
/// already showing.
///
/// A toggle rather than a plain open, so one control both reveals
/// settings and dismisses them. The pill's three-dot control and the
/// tray's item are the same door, and neither should need a second
/// thought to close.
#[tauri::command]
pub fn toggle_settings(app: AppHandle) {
    let Some(main) = app.get_webview_window(MAIN) else {
        return;
    };
    if settings_toggle_closes(main.is_visible().unwrap_or(false)) {
        let _ = main.hide();
        return;
    }
    let _ = main.show();
    let _ = main.unminimize();
    let _ = main.set_focus();
}

/// Exits the application cleanly from the pill's popover menu, matching
/// the tray's quit item.
#[tauri::command]
pub fn quit_app(app: AppHandle) {
    app.exit(0);
}

#[cfg(test)]
mod tests {
    use super::settings_toggle_closes;

    #[test]
    fn the_settings_control_flips_on_every_press() {
        // Hidden: this press opens it.
        assert!(!settings_toggle_closes(false));
        // Showing: this press puts it away, whatever else is happening
        // to focus — the click that asked is itself moving focus, so
        // asking about it would answer "open" and the control would
        // appear dead.
        assert!(settings_toggle_closes(true));
    }
    use super::*;

    /// The secondary accent circle and both circles' insets, from the
    /// pill's stylesheet. They only decide whether the glow clears the
    /// window's left and right edges, which is a check rather than a
    /// size, so they live here rather than beside the window geometry.
    const AURA_MAIN_INSET: f64 = 24.0;
    const AURA_SECONDARY_DIAMETER: f64 = 110.0;
    const AURA_SECONDARY_INSET: f64 = 28.0;

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
    fn the_room_is_wide_enough_for_the_glow_to_fade_before_the_border() {
        // The failure this prevents is invisible in review and obvious
        // on screen: a flat line across the glow where the window ends.
        // The circles sit against the left and right edges, so those are
        // judged by inset plus radius; the vertical slack is a constant
        // invariant checked where the constants live.
        let main = glow_reach(AURA_MAIN_DIAMETER);
        let secondary = glow_reach(AURA_SECONDARY_DIAMETER);
        assert!(
            AURA_MAIN_INSET + AURA_MAIN_DIAMETER / 2.0 > main,
            "the main glow reaches {main}px from a circle only {AURA_MAIN_INSET}px in"
        );
        assert!(
            AURA_SECONDARY_INSET + AURA_SECONDARY_DIAMETER / 2.0 > secondary,
            "the secondary glow reaches {secondary}px from a circle only {AURA_SECONDARY_INSET}px in"
        );
        assert!(
            WINDOW_HEIGHT / 2.0 > main,
            "the glow reaches {main}px but the window is only {WINDOW_HEIGHT}px tall"
        );
    }

    #[test]
    fn only_the_pill_itself_takes_the_pointer() {
        // The window is far larger than the pill so the glow is not
        // clipped. If the empty room took clicks too, it would swallow
        // clicks meant for whatever the user is actually working in.
        let origin = (900.0, 400.0);
        let on_pill = |x: f64, y: f64| pointer_over_pill((origin.0 + x, origin.1 + y), origin);
        assert!(on_pill(BLEED_X + 1.0, BLEED_TOP + 1.0));
        assert!(on_pill(
            BLEED_X + PILL_WIDTH - 1.0,
            BLEED_TOP + PILL_HEIGHT - 1.0
        ));
        // The room's own corners, and the strip just past the pad.
        assert!(!on_pill(0.0, 0.0));
        assert!(!on_pill(WINDOW_WIDTH, WINDOW_HEIGHT));
        assert!(!on_pill(BLEED_X / 2.0, BLEED_TOP + PILL_HEIGHT / 2.0));
        assert!(!on_pill(
            BLEED_X + PILL_WIDTH / 2.0,
            BLEED_TOP + PILL_HEIGHT + HOVER_PAD + 2.0
        ));
        // A click in the pad but outside the pill is still the pill's,
        // not the application's underneath.
        assert!(on_pill(BLEED_X - HOVER_PAD / 2.0, BLEED_TOP + 10.0));
        // A window that is not at the origin must not shift the answer:
        // the offsets are measured from the window, never from the
        // screen. Getting this wrong makes the pill unclickable exactly
        // where it sits — centred, as it always is.
        assert!(pointer_over_pill(
            (1280.0, 1235.0 + BLEED_TOP + 25.0),
            (998.0, 1235.0)
        ));
        assert!(!pointer_over_pill(
            (1280.0, 1235.0 + BLEED_TOP - 35.0),
            (998.0, 1235.0)
        ));
    }

    #[test]
    fn the_pill_rests_above_the_bottom_edge_with_its_shadow_room() {
        let (width, height) = (1920.0, 1080.0);
        let (x, y) = pill_origin((width, height));
        assert_eq!(x, (width - WINDOW_WIDTH) / 2.0);
        // What has to stay on screen is the pill and its resting margin. The
        // room below it may run past the screen edge: by then the glow
        // has faded to nothing, and the screen's own edge is the
        // boundary the eye already expects.
        assert_eq!(
            y + BLEED_TOP + PILL_HEIGHT,
            height - PILL_BOTTOM_MARGIN,
            "the pill keeps its resting margin"
        );
        assert!(y >= 0.0 && y + BLEED_TOP + PILL_HEIGHT <= height);
        let past = (y + WINDOW_HEIGHT - height).max(0.0);
        assert!(past < BLEED_BOTTOM, "the room runs off by {past}px");
    }

    #[test]
    fn a_screen_too_small_for_the_pill_still_starts_at_the_origin() {
        // A negative coordinate would push the window off-screen on one
        // side, which reads as a pill that never appears. Only a screen
        // too small for the pill and its resting margin clamps: a screen
        // that merely cannot fit the empty room is left alone, because
        // the room is transparent and may run past the edge.
        assert_eq!(pill_origin((120.0, 100.0)), (0.0, 0.0));
        assert_eq!(pill_origin((0.0, 0.0)), (0.0, 0.0));
        // Exactly the window's own height is still room enough for the
        // pill, so nothing clamps and the resting margin is kept.
        let (_, y) = pill_origin((WINDOW_WIDTH, WINDOW_HEIGHT));
        assert_eq!(
            y + BLEED_TOP + PILL_HEIGHT,
            WINDOW_HEIGHT - PILL_BOTTOM_MARGIN
        );
    }

    #[test]
    fn a_screen_with_room_keeps_the_resting_margin_above_the_bottom() {
        let (x, y) = pill_origin((900.0, 400.0));
        assert_eq!(x, (900.0 - WINDOW_WIDTH) / 2.0);
        assert_eq!(y + BLEED_TOP + PILL_HEIGHT, 400.0 - PILL_BOTTOM_MARGIN);
    }

    #[test]
    fn the_windows_have_their_own_labels() {
        // Insertion refuses to type into either of them, so a label
        // change that missed one would start typing into the pill.
        assert_ne!(PILL, MAIN);
    }
}

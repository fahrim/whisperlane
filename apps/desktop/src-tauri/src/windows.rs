//! The application's windows: the pill overlay, and the main window the
//! pill's options control opens. One concern — where the product's
//! surfaces live and when they are on screen. No take decisions live
//! here; the pill is shown or hidden because of what the pipeline is
//! doing, never the other way round.

use std::sync::atomic::Ordering;
use std::sync::Mutex;

use serde::Serialize;
use tauri::{AppHandle, LogicalPosition, LogicalSize, Manager, WebviewUrl, WebviewWindowBuilder};
use windows::Win32::Foundation::{BOOL, HWND, LPARAM, POINT, RECT};
use windows::Win32::Graphics::Gdi::{
    EnumDisplayMonitors, GetMonitorInfoW, HDC, HMONITOR, MONITORINFO,
};
use windows::Win32::UI::WindowsAndMessaging::{GetCursorPos, SetWindowPos, SWP_NOACTIVATE, SWP_NOZORDER};

use crate::pipeline::Phase;

/// Label of the compact overlay the user looks at while dictating.
pub const PILL: &str = "pill";

/// Label of the window holding first run and settings.
pub const MAIN: &str = "main";

/// The pill's own size, matching `--pill-height` in the token set.
///
/// Wide enough for the waveform, the written line and the controls
/// without any of them being squeezed. The wave is the primary thing
/// the user watches, and the line beside it still has to read in full
/// rather than truncate to an initial.
const PILL_WIDTH: f64 = 460.0;
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
/// The room above is spent on the glow that spills over the pill and on
/// the tallest panel the pill may open above itself, because an upward
/// panel is drawn inside this room: moving the window up to make space for
/// it would move the pill, and the pill's place on screen must not depend
/// on what is open beside it. The room below carries the shadow. Neither
/// costs anything to whatever sits underneath: the empty part of the window
/// passes the pointer straight through.
const PANEL_HEADROOM: f64 = 240.0;
const BLEED_X: f64 = 52.0;

/// How far the glow spills above the pill on its own.
const GLOW_ABOVE: f64 = HALF_HEIGHT - PILL_HEIGHT / 2.0;

const BLEED_TOP: f64 = if PANEL_HEADROOM > GLOW_ABOVE {
    PANEL_HEADROOM
} else {
    GLOW_ABOVE
};
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
        BLEED_TOP >= PANEL_HEADROOM,
        "the top room has to hold an upward panel"
    );
    assert!(
        BLEED_TOP >= GLOW_ABOVE,
        "the top room has to hold the glow above the pill"
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

/// How far above the bottom edge the pill's own edge rests.
const PILL_BOTTOM_MARGIN: f64 = 48.0;

/// Where a panel opened, and which side of the pill it is pinned to.
///
/// Alignment is answered here rather than by the interface because it is
/// the same measurement: the side with more room is the side the panel
/// can hang off without running off the screen.
#[derive(Debug, Clone, Copy, Serialize)]
pub struct PanelPlacement {
    pub direction: Expansion,
}

/// The gap a panel leaves between itself and the pill, named once here so
/// the window's growth and the panel's own margin cannot disagree.
const PANEL_GAP: f64 = 10.0;

/// Which way a panel opens out of the pill.
///
/// The name says which way the panel goes, not which way the window
/// grows, because those are the same thing only by accident of the
/// anchoring: the window always grows in the direction the panel opens,
/// and the pill is re-anchored to the window's opposite edge so it does
/// not move.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum Expansion {
    Down,
    Up,
}

/// Which way a panel of this height opens out of a pill with this much
/// room above and below it.
///
/// Pure and separately tested, because the machine that measures the
/// screen cannot also be trusted to reason about it. Room below wins
/// whenever it is enough, and otherwise the side with more room wins —
/// so a panel only opens upward when opening downward would visibly run
/// off the screen.
pub fn expand_toward(above: f64, below: f64, required: f64) -> Expansion {
    if below >= required || below >= above {
        Expansion::Down
    } else {
        Expansion::Up
    }
}

/// How much screen the pill itself has above and below it.
///
/// The pill's place inside the window is a constant, so the room it has is
/// just the room between its own edges and the screen's edges: an upward
/// panel needs to know the first, a downward one the second.
#[derive(Debug, Clone, Copy)]
pub struct PillSpace {
    pub above: f64,
    pub below: f64,
}

/// The window's rectangle in logical pixels, and its top-left corner in
/// the physical pixels the platform measures in.
///
/// Both are needed and they are not interchangeable: the room around the
/// pill is reasoned about in logical pixels, while the monitor probe is
/// a platform call that wants physical ones. At anything but 100% scaling
/// the two disagree, and a probe handed the wrong one can land on the
/// wrong monitor entirely.
fn window_rect(window: &tauri::WebviewWindow) -> Option<((f64, f64), (f64, f64, f64, f64))> {
    let scale = window.scale_factor().ok()?;
    if scale <= 0.0 {
        return None;
    }
    let position = window.outer_position().ok()?;
    let size = window.outer_size().ok()?;
    Some((
        (position.x as f64, position.y as f64),
        (
            position.x as f64 / scale,
            position.y as f64 / scale,
            size.width as f64 / scale,
            size.height as f64 / scale,
        ),
    ))
}

/// The union of every monitor's work area, in physical pixels.
///
/// The union rather than the monitor under the window, because the window
/// is wider than the pill: at the pill's own edge the window's corner is
/// already past it, so a clamp written against that corner's monitor
/// reaches across to the neighbour and yanks the pill fully onto it. The
/// union also lets the pill rest between two screens, which is where any
/// window manager leaves a window. Empty work area when the platform
/// refuses to enumerate.
fn virtual_work_area() -> (f64, f64, f64, f64) {
    let mut bounds = (i32::MAX, i32::MAX, i32::MIN, i32::MIN);
    // SAFETY: the callback only reads what the system filled in for each
    // monitor and folds it into `bounds`, which outlives the call.
    let enumerated = unsafe {
        EnumDisplayMonitors(
            None,
            None,
            Some(collect_monitor),
            LPARAM(&raw mut bounds as isize),
        )
    };
    if !enumerated.as_bool() || bounds.2 <= bounds.0 || bounds.3 <= bounds.1 {
        return (0.0, 0.0, 0.0, 0.0);
    }
    (
        bounds.0 as f64,
        bounds.1 as f64,
        (bounds.2 - bounds.0) as f64,
        (bounds.3 - bounds.1) as f64,
    )
}

/// Folds one monitor's work area into the running bounds.
///
/// A monitor whose work area the platform will not describe is left out
/// rather than guessed at: a wrong rectangle is worse than a missing one,
/// because the clamp would then hold the pill inside somewhere it cannot
/// actually be.
unsafe extern "system" fn collect_monitor(
    monitor: HMONITOR,
    _dc: HDC,
    _clip: *mut RECT,
    data: LPARAM,
) -> BOOL {
    // SAFETY: the pointer is the one handed to EnumDisplayMonitors above,
    // and it is alive for the whole enumeration.
    let bounds = unsafe { &mut *(data.0 as *mut (i32, i32, i32, i32)) };
    let mut info = MONITORINFO {
        cbSize: std::mem::size_of::<MONITORINFO>() as u32,
        ..Default::default()
    };
    // SAFETY: the handle comes from the enumeration and the struct is
    // ours, sized as the call requires.
    if unsafe { GetMonitorInfoW(monitor, &mut info) }.as_bool() {
        bounds.0 = bounds.0.min(info.rcWork.left);
        bounds.1 = bounds.1.min(info.rcWork.top);
        bounds.2 = bounds.2.max(info.rcWork.right);
        bounds.3 = bounds.3.max(info.rcWork.bottom);
    }
    true.into()
}

/// The union of every monitor's work area, in logical pixels.
///
/// Read from the platform, because nothing in the webview can know where
/// the taskbar is: this window is a floating overlay with no relationship
/// to the desktop layout. Empty when the platform refuses to say, which
/// the clamp reads as "no measurement, no clamp".
fn work_area(scale: f64) -> (f64, f64, f64, f64) {
    let (x, y, width, height) = virtual_work_area();
    (x / scale, y / scale, width / scale, height / scale)
}

/// How much screen the pill itself has above and below it.
///
/// Measured from the pill's own edges rather than the window's: the window
/// carries empty room that runs past the screen edges by design, and
/// counting that as space is how a panel gets told it fits where it does
/// not. The pill's place inside the window is a constant, so this needs no
/// more than where the window was left.
fn pill_space(window: &tauri::WebviewWindow) -> PillSpace {
    let none = PillSpace {
        above: 0.0,
        below: 0.0,
    };
    let scale = window.scale_factor().unwrap_or(1.0);
    let (_, work_y, work_width, work_height) = work_area(scale);
    if work_width <= 0.0 || work_height <= 0.0 {
        return none;
    }
    let Some((_, (_, y, _, _))) = window_rect(window) else {
        return none;
    };
    let pill_top = y + BLEED_TOP;
    let pill_bottom = pill_top + PILL_HEIGHT;
    PillSpace {
        above: pill_top - work_y,
        below: (work_y + work_height) - pill_bottom,
    }
}

/// Where a window may be placed so the pill inside it stays on screen.
///
/// The window is larger than the pill on every side, and the platform will
/// not let a dragged window's top edge cross the screen's own top. Those
/// two facts together are why a pill carrying room above it can never be
/// dragged to the top: the frame stops first, at a distance the user
/// cannot see. So this clamps the *pill*, and lets the window hang off the
/// screen by exactly the room the pill carries — the glow above it then
/// falls outside the screen, which is where light that has nowhere to land
/// belongs.
///
/// The bounds are the union of every screen's work area rather than one
/// screen's, so the pill may rest between two monitors the way any window
/// may, and may be taken across and back.
///
/// Pure, because the arithmetic is the whole decision and a screen is not
/// something a test can provide.
pub fn clamp_pill_origin(desired: (f64, f64), work: (f64, f64, f64, f64)) -> (f64, f64) {
    let (work_x, work_y, work_width, work_height) = work;
    if work_width <= 0.0 || work_height <= 0.0 {
        return desired;
    }
    // Where the window's corner sits when the pill's own corner is on the
    // work area's edge, at each end.
    let leftmost = work_x - BLEED_X;
    let rightmost = work_x + work_width - BLEED_X - PILL_WIDTH;
    let topmost = work_y - BLEED_TOP;
    let bottommost = work_y + work_height - BLEED_TOP - PILL_HEIGHT;
    (
        desired
            .0
            .clamp(leftmost.min(rightmost), leftmost.max(rightmost)),
        desired
            .1
            .clamp(topmost.min(bottommost), topmost.max(bottommost)),
    )
}

/// A drag in progress: where the window was, where the cursor was when the
/// pointer went down, and when it last moved.
///
/// The whole drag is kept here rather than in the webview because the
/// webview cannot express it cleanly: its `await`ed reads of the window's
/// own position arrive on a later turn, by which time the pointer event
/// they belong to has been released, and a window that follows a moving
/// cursor needs both read at the same instant.
pub struct DragState {
    pub window: (f64, f64),
    pub grab: (f64, f64),
    /// The last time the pointer moved while the button was down.
    pub touched: std::time::Instant,
}

/// How long a drag survives without a pointer move before it is treated as
/// over.
///
/// The interface ends a drag explicitly, but a drag that never ends — a
/// pointer event lost to a window that moved out from under it — would
/// leave the pill unable to take the pointer at all. Time makes the state
/// heal itself instead of trusting one message to arrive.
const DRAG_STALE: std::time::Duration = std::time::Duration::from_millis(400);

/// The drag in flight, if any. See `DragState`.
pub struct PillDrag(pub Mutex<Option<DragState>>);

/// Begins a drag from wherever the pointer is now.
#[tauri::command]
pub fn begin_pill_drag(app: AppHandle) {
    let Some(window) = app.get_webview_window(PILL) else {
        return;
    };
    let (Some((_, (x, y, _, _))), Some(cursor)) = (window_rect(&window), cursor_on_screen())
    else {
        return;
    };
    if let Some(state) = app.try_state::<PillDrag>() {
        *state.0.lock().expect("pill drag poisoned") = Some(DragState {
            window: (x, y),
            grab: cursor,
            touched: std::time::Instant::now(),
        });
    }
}

/// Moves the pill to wherever the pointer has taken it.
///
/// The cursor is read here rather than passed in from the interface, so
/// the position that gets clamped and the position that was measured are
/// the same reading. Returns where the window ended up.
#[tauri::command]
pub fn continue_pill_drag(app: AppHandle) -> Option<(f64, f64)> {
    let window = app.get_webview_window(PILL)?;
    let cursor = cursor_on_screen()?;
    let state = app.try_state::<PillDrag>()?;
    let (origin, grab) = {
        let mut drag = state.0.lock().expect("pill drag poisoned");
        let drag = drag.as_mut()?;
        drag.touched = std::time::Instant::now();
        (drag.window, drag.grab)
    };
    let scale = window.scale_factor().unwrap_or(1.0);
    let desired = (
        origin.0 + (cursor.0 - grab.0) / scale,
        origin.1 + (cursor.1 - grab.1) / scale,
    );
    // Carrying an open panel would mean re-deriving the whole hit box on
    // every frame. A drag is the user taking the pill somewhere, so the
    // panel closes instead.
    if let Some(expansion) = app.try_state::<PanelExpansion>() {
        *expansion.0.lock().expect("panel expansion poisoned") = None;
    }
    let (x, y) = clamp_pill_origin(desired, work_area(scale));
    place_window(&window, x, y, WINDOW_WIDTH, WINDOW_HEIGHT);
    Some((x, y))
}

/// Ends a drag. The pill stays where the last move put it.
#[tauri::command]
pub fn end_pill_drag(app: AppHandle) {
    if let Some(state) = app.try_state::<PillDrag>() {
        *state.0.lock().expect("pill drag poisoned") = None;
    }
}

/// Whether the pill is being dragged right now.
///
/// While it is, the click-through poller has to leave the pointer alone.
/// Moving the window under a stationary cursor makes the pill's own box
/// lag the pointer for a frame or two, and a poller that read that as the
/// cursor leaving would turn the window's pointer handling off in the
/// middle of a drag — which is exactly how a drag stops dead.
fn drag_in_flight(app: &AppHandle) -> bool {
    app.try_state::<PillDrag>()
        .is_some_and(|state| {
            state
                .0
                .lock()
                .expect("pill drag poisoned")
                .as_ref()
                .is_some_and(|drag| drag.touched.elapsed() < DRAG_STALE)
        })
}

/// Which way a panel opened out of the pill, and how much room it took.
///
/// Kept because the click-through poller has to claim the panel: an
/// overlay that stops taking the pointer where its own menu begins is an
/// overlay with a hole in it.
pub struct PanelExpansion(pub Mutex<Option<(Expansion, f64)>>);

/// The pill's own box on screen, grown to cover an open panel.
///
/// One rule for the collapsed and the expanded pill alike: the room around
/// the pill is room the user cannot click through, and a panel extends
/// that box in whichever direction it opened. The pill's place inside the
/// window never changes, so neither does this need to know where the window
/// went.
pub fn pill_hit_box(
    window_at: (f64, f64),
    expansion: Option<(Expansion, f64)>,
) -> (f64, f64, f64, f64) {
    let (wx, wy) = window_at;
    let pill_top = wy + BLEED_TOP;
    let mut top = pill_top - HOVER_PAD;
    let mut bottom = pill_top + PILL_HEIGHT + HOVER_PAD;
    if let Some((direction, extra)) = expansion {
        let panel = (extra - PANEL_GAP).max(0.0);
        match direction {
            Expansion::Up => top = pill_top - PANEL_GAP - panel - HOVER_PAD,
            Expansion::Down => {
                bottom = pill_top + PILL_HEIGHT + PANEL_GAP + panel + HOVER_PAD
            }
        }
    }
    (
        wx + BLEED_X - HOVER_PAD,
        top,
        PILL_WIDTH + HOVER_PAD * 2.0,
        bottom - top,
    )
}

/// Whether a cursor on screen at this point is over the pill or over a
/// panel opened out of it, rather than over the empty room the window
/// carries around it.
///
/// The window has to be larger than the pill or the glow is clipped,
/// and a larger window catches clicks meant for whatever sits beneath
/// it. The empty room therefore passes the pointer straight through and
/// only the pill takes it, so the room costs the application underneath
/// nothing.
pub fn pointer_over_pill_expanded(
    cursor: (f64, f64),
    window_at: (f64, f64),
    expansion: Option<(Expansion, f64)>,
) -> bool {
    let (left, top, width, height) = pill_hit_box(window_at, expansion);
    let (cx, cy) = cursor;
    (left..=left + width).contains(&cx) && (top..=top + height).contains(&cy)
}

/// Moves and resizes the pill window in a single system call.
///
/// Tauri's own setters arrive as two separate calls, and the compositor
/// can paint between them: the window is already taller while still
/// sitting at its old origin, so the pill visibly jumps and snaps back
/// every time a panel opens or closes. One SetWindowPos applies the new
/// rectangle all at once, so there is no intermediate frame to paint.
/// Activation and stacking are left exactly as they are — the pill must
/// never steal focus or rise above itself just because a menu opened.
fn place_window(window: &tauri::WebviewWindow, x: f64, y: f64, width: f64, height: f64) {
    let scale = window.scale_factor().unwrap_or(1.0);
    let (x, y, width, height) = (
        (x * scale).round() as i32,
        (y * scale).round() as i32,
        (width * scale).round().max(1.0) as i32,
        (height * scale).round().max(1.0) as i32,
    );
    // SAFETY: the handle belongs to our own window, the rectangle is the
    // one the caller computed, and neither flag changes activation order.
    //
    // The handle crosses crate versions as a raw pointer rather than as
    // a typed HWND, because the shell's windows crate is not the same
    // version as the toolkit's: the two HWND types are layout-identical
    // but the compiler treats them as strangers.
    let placed = window.hwnd().map(|hwnd| {
        let raw: *mut std::ffi::c_void = hwnd.0 as *mut std::ffi::c_void;
        unsafe {
            SetWindowPos(
                HWND(raw),
                HWND(std::ptr::null_mut()),
                x,
                y,
                width,
                height,
                SWP_NOZORDER | SWP_NOACTIVATE,
            )
        }
    });
    if placed.is_err() {
        let _ = window.set_size(LogicalSize::new(width as f64 / scale, height as f64 / scale));
        let _ = window.set_position(LogicalPosition::new(x as f64 / scale, y as f64 / scale));
    }
}

/// Opens a panel out of the pill, or puts the window back when asked for
/// no panel at all.
///
/// The window is resized and never moved, because the pill's place on
/// screen is derived from the window's origin alone. An upward panel draws
/// inside the room the window already carries above the pill; a downward
/// one grows the window below it. Both leave the origin where it was, which
/// is the whole reason the pill cannot flinch when a panel opens: there is
/// no moment in which the window has moved and the pill has not.
#[tauri::command]
pub fn set_pill_panel(app: AppHandle, required_height: f64) -> Option<PanelPlacement> {
    let Some(window) = app.get_webview_window(PILL) else {
        return None;
    };
    let Some(state) = app.try_state::<PanelExpansion>() else {
        return None;
    };
    let extra = if required_height > 0.0 {
        required_height + PANEL_GAP
    } else {
        0.0
    };
    let Some((_, (x, y, _width, _height))) = window_rect(&window) else {
        return None;
    };
    if extra <= 0.0 {
        place_window(&window, x, y, WINDOW_WIDTH, WINDOW_HEIGHT);
        *state.0.lock().expect("panel expansion poisoned") = None;
        return None;
    }
    let space = pill_space(&window);
    let direction = expand_toward(space.above, space.below, extra);
    // Only a downward panel needs room the window does not already have.
    let height = match direction {
        Expansion::Down => WINDOW_HEIGHT + extra,
        Expansion::Up => WINDOW_HEIGHT,
    };
    place_window(&window, x, y, WINDOW_WIDTH, height);
    *state.0.lock().expect("panel expansion poisoned") = Some((direction, extra));
    Some(PanelPlacement { direction })
}

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
            // A drag is in flight: the window is being moved under the
            // cursor by our own code, so the pointer is the pill's by
            // definition and no poll should second-guess it.
            if drag_in_flight(&worker) {
                continue;
            }
            let Some((cx, cy)) = cursor_on_screen() else {
                continue;
            };
            let Ok(at) = window.outer_position() else {
                continue;
            };
            // The window's own position is physical; the box is in
            // logical pixels, so it has to be scaled before the two are
            // compared. At anything but 100% scaling they disagree.
            let scale = window.scale_factor().unwrap_or(1.0);
            let cursor = (cx as f64 / scale, cy as f64 / scale);
            let at = (at.x as f64 / scale, at.y as f64 / scale);
            let expansion = worker
                .try_state::<PanelExpansion>()
                .and_then(|state| *state.0.lock().expect("panel expansion poisoned"));
            let over_pill = pointer_over_pill_expanded(cursor, at, expansion);
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

/// Whether the pill is currently taking the cursor, so the next poll
/// knows whether the platform flag has to change at all.
pub struct CursorPassthrough(pub std::sync::atomic::AtomicBool);

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
        let on_pill = |x: f64, y: f64| pointer_over_pill_expanded((origin.0 + x, origin.1 + y), origin, None);
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
        assert!(pointer_over_pill_expanded(
            (1280.0, 1235.0 + BLEED_TOP + 25.0),
            (998.0, 1235.0),
            None
        ));
        assert!(!pointer_over_pill_expanded(
            (1280.0, 1235.0 + BLEED_TOP - 35.0),
            (998.0, 1235.0),
            None
        ));
    }

    #[test]
    fn a_panel_claims_the_room_it_opened_into() {
        // An overlay that stopped taking the pointer where its own menu
        // begins is an overlay with a hole in it: the panel is the part
        // of the window the user is most certainly aiming at.
        let origin = (900.0, 400.0);
        let panel = 190.0 + PANEL_GAP;
        let x = origin.0 + BLEED_X + PILL_WIDTH / 2.0;

        // Opened below: the box reaches down from the pill, and the pill's own
        // box is unchanged at the top of it.
        let (d_x, d_y, d_width, d_height) =
            pill_hit_box(origin, Some((Expansion::Down, panel)));
        let d_bottom = d_y + d_height;
        let (c_x, c_y, c_width, c_height) = pill_hit_box(origin, None);
        let c_bottom = c_y + c_height;
        assert_eq!(d_x, c_x);
        assert_eq!(d_width, c_width);
        assert_eq!(d_y, c_y, "the pill's own box does not move");
        assert_eq!(d_bottom - c_bottom, panel, "the panel is added below");
        let middle = c_bottom + panel / 2.0;
        assert!(pointer_over_pill_expanded(
            (x, middle),
            origin,
            Some((Expansion::Down, panel))
        ));
        assert!(!pointer_over_pill_expanded(
            (x, d_bottom + 4.0),
            origin,
            Some((Expansion::Down, panel))
        ));

        // Opened above: the box grows up from the pill from the SAME
        // window origin, because the panel is drawn inside the room the
        // window already carries and the window does not move.
        let (u_x, u_y, u_width, u_height) =
            pill_hit_box(origin, Some((Expansion::Up, panel)));
        assert_eq!(u_x, c_x);
        assert_eq!(u_width, c_width);
        // The pill's own part of the box sits at the box's bottom.
        assert_eq!(
            u_y + u_height,
            c_bottom,
            "the pill's own box does not move"
        );
        assert_eq!(u_y, c_y - panel, "the panel is added above, in place");
        // Inside the panel band, the pointer is ours.
        assert!(pointer_over_pill_expanded(
            (x, c_y - panel / 2.0),
            origin,
            Some((Expansion::Up, panel))
        ));
        // Just past it, it is not.
        assert!(!pointer_over_pill_expanded(
            (x, u_y - 4.0),
            origin,
            Some((Expansion::Up, panel))
        ));
    }

    #[test]
    fn a_panel_only_opens_upward_when_downward_would_not_fit() {
        // Plenty of room below: downward, even with more room above.
        assert_eq!(expand_toward(400.0, 900.0, 200.0), Expansion::Down);
        // Room below is short but room above is shorter still: downward,
        // because upward would be worse.
        assert_eq!(expand_toward(50.0, 80.0, 200.0), Expansion::Down);
        // Room below cannot fit it and there is more room above: upward.
        assert_eq!(expand_toward(600.0, 80.0, 200.0), Expansion::Up);
        // Exactly enough below is enough. A panel that fits must not flip
        // for the sake of an extra pixel of headroom.
        assert_eq!(expand_toward(600.0, 200.0, 200.0), Expansion::Down);
        // No room either way: the tie still opens downward, which is
        // where the pill's resting margin already leaves space.
        assert_eq!(expand_toward(0.0, 0.0, 200.0), Expansion::Down);
    }

    #[test]
    fn an_open_panel_does_not_move_the_pill_a_pixel() {
        // The property the whole design exists for. The pill's screen
        // rectangle is the window's origin plus the top bleed, and the
        // window's origin does not change when a panel opens: an upward
        // panel is drawn inside the room the window already carries, a
        // downward one grows the window below it, and neither touches the
        // top edge.
        let origin = (600.0, 500.0);
        let resting_top = origin.1 + BLEED_TOP;
        for direction in [Expansion::Up, Expansion::Down] {
            let panel = 190.0 + PANEL_GAP;
            // Downward grows the window; upward draws inside the room it
            // already has. Either way the origin is the window's own.
            let window_height = match direction {
                Expansion::Up => WINDOW_HEIGHT,
                Expansion::Down => WINDOW_HEIGHT + panel,
            };
            assert!(
                window_height <= WINDOW_HEIGHT || direction == Expansion::Down,
                "an upward panel never needs a taller window"
            );
            let pill_top = origin.1 + BLEED_TOP;
            assert_eq!(
                pill_top,
                resting_top,
                "{direction:?} moved the pill on screen"
            );
        }
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
    fn the_stylesheets_room_agrees_with_this_window_geometry() {
        // The whole zero-jump contract is that the pill lands on the same
        // pixels whichever way a panel opens, and half of that lives in a
        // stylesheet this file cannot see. Read it and pin the one number
        // that has to match: the room above the pill, which is this
        // module's top bleed rounded for the pixel grid.
        let stylesheet = include_str!("../../src/pill.css");
        assert!(
            stylesheet.contains(&format!("padding-top: {}px;", BLEED_TOP.round() as i64)),
            "the pill's top room in pill.css no longer matches BLEED_TOP ({BLEED_TOP}), \
             so the pill's place on screen would depend on the window's height"
        );
    }

    #[test]
    fn the_pill_can_be_dragged_to_every_edge_of_the_screen() {
        // The window is taller than the pill by its glow, and the platform
        // will not let a dragged window cross the top of the screen. So
        // the clamp is written against the pill: at the extreme the window
        // is off-screen and the pill is exactly on the work area's edge.
        let work = (0.0, 0.0, 1920.0, 1040.0);
        let (x, y) = clamp_pill_origin((-9999.0, -9999.0), work);
        assert_eq!(x + BLEED_X, work.0, "the pill's left edge reaches the left");
        assert_eq!(y + BLEED_TOP, work.1, "the pill's top edge reaches the top");
        assert!(y < 0.0, "the window itself has to hang off the top");

        let (x, y) = clamp_pill_origin((9999.0, 9999.0), work);
        assert_eq!(x + BLEED_X + PILL_WIDTH, work.0 + work.2);
        assert_eq!(
            y + BLEED_TOP + PILL_HEIGHT,
            work.1 + work.3,
            "the pill's bottom edge reaches the bottom"
        );
    }

    #[test]
    fn a_drag_inside_the_screen_is_left_exactly_where_it_was_asked_for() {
        // The clamp must not nudge a pill the user placed somewhere it
        // fits: a position that is legal is legal.
        let work = (0.0, 0.0, 1920.0, 1040.0);
        let wanted = (700.0, 400.0);
        assert_eq!(clamp_pill_origin(wanted, work), wanted);
        // A second monitor to the left owns negative coordinates, and a
        // pill parked there is not off-screen — it is on that screen.
        let left_hand_screen = (-1920.0, 0.0, 1920.0, 1040.0);
        let wanted = (-1200.0, 300.0);
        assert_eq!(clamp_pill_origin(wanted, left_hand_screen), wanted);
    }

    #[test]
    fn a_screen_with_no_room_leaves_the_position_alone() {
        // The platform refusing to report a work area must not collapse
        // the pill to the origin: no measurement means no clamp.
        assert_eq!(clamp_pill_origin((700.0, 400.0), (0.0, 0.0, 0.0, 0.0)), (700.0, 400.0));
    }

    #[test]
    fn the_windows_have_their_own_labels() {
        // Insertion refuses to type into either of them, so a label
        // change that missed one would start typing into the pill.
        assert_ne!(PILL, MAIN);
    }
}

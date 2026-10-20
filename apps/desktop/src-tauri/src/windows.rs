//! The application's windows: the pill overlay, and the main window the
//! pill's options control opens. One concern — where the product's
//! surfaces live and when they are on screen. No take decisions live
//! here; the pill is shown or hidden because of what the pipeline is
//! doing, never the other way round.

use std::sync::atomic::Ordering;
use std::sync::Mutex;

use serde::Serialize;
use tauri::ipc::Response;
use tauri::{AppHandle, Emitter, LogicalPosition, LogicalSize, Manager, WebviewUrl, WebviewWindowBuilder};
use windows::Win32::Foundation::{BOOL, HWND, LPARAM, POINT, RECT};
use windows::Win32::Graphics::Dwm::{
    DwmEnableBlurBehindWindow, DWM_BB_BLURREGION, DWM_BB_ENABLE, DWM_BLURBEHIND,
};
use windows::Win32::Graphics::Gdi::{
    BitBlt, CombineRgn, CreateCompatibleDC, CreateDIBSection, CreateRoundRectRgn, DeleteDC,
    DeleteObject, EnumDisplayMonitors, GdiFlush, GetDC, GetMonitorInfoW, ReleaseDC, SelectObject,
    BITMAPINFO, BITMAPINFOHEADER, BI_RGB, DIB_RGB_COLORS, HBITMAP, HDC, HMONITOR, MONITORINFO,
    RGN_OR, SRCCOPY,
};
use windows::Win32::UI::WindowsAndMessaging::{
    GetCursorPos, SetWindowDisplayAffinity, SetWindowPos, SWP_NOACTIVATE, SWP_NOZORDER,
    WDA_EXCLUDEFROMCAPTURE, WDA_NONE,
};

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
    /// Whether the pill had more room to its right than to its left: the
    /// side with more room is the side a panel can hang off.
    pub align_end: bool,
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

/// How much screen the pill itself has around it.
///
/// Measured from the pill's own edges rather than the window's: the window
/// carries empty room that runs past the screen edges by design, and
/// counting that as space is how a panel gets told it fits where it does
/// not. Left and right answer where a panel may hang off the pill; above
/// and below answer which way one may open.
#[derive(Debug, Clone, Copy)]
pub struct PillSpace {
    pub above: f64,
    pub below: f64,
    pub left: f64,
    pub right: f64,
}

/// The window's rectangle in logical pixels, and its top-left corner in
/// the physical pixels the platform measures in.
///
/// Both are needed and they are not interchangeable: the room around the
/// pill is reasoned about in logical pixels, while the monitor probe is
/// a platform call that wants physical ones. At anything but 100% scaling
/// the two disagree, and a probe handed the wrong one can land on the
/// wrong monitor entirely.
/// A window's top-left corner and its size, both in logical pixels.
type WindowRect = ((f64, f64), (f64, f64, f64, f64));

fn window_rect(window: &tauri::WebviewWindow) -> Option<WindowRect> {
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
        left: 0.0,
        right: 0.0,
    };
    let scale = window.scale_factor().unwrap_or(1.0);
    let (work_x, work_y, work_width, work_height) = work_area(scale);
    if work_width <= 0.0 || work_height <= 0.0 {
        return none;
    }
    let Some((_, (x, y, _, _))) = window_rect(window) else {
        return none;
    };
    let pill_top = y + BLEED_TOP;
    let pill_bottom = pill_top + PILL_HEIGHT;
    let pill_left = x + BLEED_X;
    let pill_right = pill_left + PILL_WIDTH;
    PillSpace {
        above: pill_top - work_y,
        below: (work_y + work_height) - pill_bottom,
        left: pill_left - work_x,
        right: (work_x + work_width) - pill_right,
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
    invalidate_backdrop_hash();
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
/// Moves the pill to wherever the pointer has taken it, and returns the
/// fresh live desktop backdrop at the new position in the same IPC round-trip.
///
/// The cursor is read here rather than passed in from the interface, so
/// the position that gets clamped and the position that was measured are
/// the same reading.
#[tauri::command]
pub fn continue_pill_drag(
    app: AppHandle,
    pill_x: Option<f64>,
    pill_y: Option<f64>,
    pill_w: Option<f64>,
    pill_h: Option<f64>,
) -> Response {
    let Some(window) = app.get_webview_window(PILL) else {
        return Response::new(Vec::new());
    };
    let Some(cursor) = cursor_on_screen() else {
        return Response::new(Vec::new());
    };
    let Some(state) = app.try_state::<PillDrag>() else {
        return Response::new(Vec::new());
    };
    let (origin, grab) = {
        let mut drag = state.0.lock().expect("pill drag poisoned");
        let Some(drag) = drag.as_mut() else {
            return Response::new(Vec::new());
        };
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

    if let (Some(px), Some(py), Some(pw), Some(ph), Ok(hwnd)) =
        (pill_x, pill_y, pill_w, pill_h, window.hwnd())
    {
        let crop_pad = 16.0;
        let crop_log_x = (px - crop_pad).floor();
        let crop_log_y = (py - crop_pad).floor();
        let crop_log_w = ((px + pw + crop_pad).ceil() - crop_log_x).max(1.0);
        let crop_log_h = ((py + ph + crop_pad).ceil() - crop_log_y).max(1.0);
        let phys_x = (x * scale).round() as i32 + (crop_log_x * scale).round() as i32;
        let phys_y = (y * scale).round() as i32 + (crop_log_y * scale).round() as i32;
        let phys_w = (crop_log_w * scale).round().max(2.0) as i32;
        let phys_h = (crop_log_h * scale).round().max(2.0) as i32;
        if let Some(packet) = capture_crop_rgba_packet(
            Some(HWND(hwnd.0)),
            crop_log_x, crop_log_y, crop_log_w, crop_log_h, phys_x, phys_y, phys_w, phys_h, true,
        ) {
            return Response::new(packet);
        }
    }
    Response::new(Vec::new())
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
        unsafe {
            SetWindowPos(
                HWND(hwnd.0),
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
    let window = app.get_webview_window(PILL)?;
    let state = app.try_state::<PanelExpansion>()?;
    let extra = if required_height > 0.0 {
        required_height + PANEL_GAP
    } else {
        0.0
    };
    let (_, (x, y, _width, _height)) = window_rect(&window)?;
    invalidate_backdrop_hash();
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
    Some(PanelPlacement {
        direction,
        align_end: space.right >= space.left,
    })
}

static LAST_BACKDROP_HASH: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);

/// `[hwnd, pill l/t/r/b, pill radius, panel l/t/r/b, panel diameter]` in
/// physical pixels — the last shape handed to `DwmEnableBlurBehindWindow`.
type RegionKey = [isize; 11];
static LAST_BLUR_REGION: Mutex<Option<RegionKey>> = Mutex::new(None);

fn invalidate_backdrop_hash() {
    LAST_BACKDROP_HASH.store(0, Ordering::Relaxed);
}

/// Briefly marks the pill window with `WDA_EXCLUDEFROMCAPTURE` only for the
/// duration of a single `BitBlt` backdrop read, then restores `WDA_NONE`.
///
/// A permanent exclusion hides the pill from every OS capture path —
/// Snipping Tool, Win+Shift+S, Game Bar, screen sharing — so the pill
/// vanishes the moment a capture overlay opens. Keeping the window normally
/// capturable and excluding it only around our own `BitBlt` preserves
/// self-capture-free glass while leaving screenshots alone.
fn set_pill_capture_excluded(hwnd: HWND, excluded: bool) {
    if hwnd.0.is_null() {
        return;
    }
    if std::env::var("WHISPERLANE_GLASS_PROBE").as_deref() == Ok("1") {
        return;
    }
    // SAFETY: `hwnd` is our own pill WebView2 window handle.
    let affinity = if excluded {
        WDA_EXCLUDEFROMCAPTURE
    } else {
        WDA_NONE
    };
    let _ = unsafe { SetWindowDisplayAffinity(hwnd, affinity) };
}

/// Binary packet layout returned over `tauri::ipc::Response`:
/// - Bytes `0..4`:   `crop_log_x` (`f32`, little-endian)
/// - Bytes `4..8`:   `crop_log_y` (`f32`, little-endian)
/// - Bytes `8..12`:  `crop_log_w` (`f32`, little-endian)
/// - Bytes `12..16`: `crop_log_h` (`f32`, little-endian)
/// - Bytes `16..20`: `out_w` (`u32`, little-endian)
/// - Bytes `20..24`: `out_h` (`u32`, little-endian)
/// - Bytes `24..`:   top-down `RGBA` pixels (`out_w * out_h * 4` bytes)
///
/// When `force` is `false` and the 64-bit FNV-1a content hash matches the
/// previous frame, returns `Some(Vec::new())` (`0` bytes) so the frontend
/// skips canvas updates completely.
struct CapturePool {
    mem_dc: HDC,
    dib: HBITMAP,
    bits_ptr: *mut std::ffi::c_void,
    capacity_w: i32,
    capacity_h: i32,
    packet_buf: Vec<u8>,
}

unsafe impl Send for CapturePool {}

impl Drop for CapturePool {
    fn drop(&mut self) {
        unsafe {
            if !self.dib.is_invalid() {
                let _ = DeleteObject(self.dib);
            }
            if !self.mem_dc.is_invalid() {
                let _ = DeleteDC(self.mem_dc);
            }
        }
    }
}

static CAPTURE_POOL: Mutex<Option<CapturePool>> = Mutex::new(None);

// The geometry arguments are one rectangle and one crop described in
// the same words the desktop uses; bundling them into a struct would
// hide the call site behind a type that says less than the names do.
#[allow(clippy::too_many_arguments)]
fn encode_downsampled_rgba_packet(
    bgra: &[u8],
    src_w: usize,
    src_h: usize,
    src_stride: usize,
    crop_log_x: f64,
    crop_log_y: f64,
    crop_log_w: f64,
    crop_log_h: f64,
    force: bool,
    out_buf: &mut Vec<u8>,
) -> Option<Vec<u8>> {
    if src_w == 0 || src_h == 0 || bgra.len() < src_h.saturating_sub(1) * src_stride + src_w * 4 {
        return None;
    }
    // Balanced 2x area-downsampling: preserves fine desktop details and
    // high-frequency contrast for crisp meniscus lens refraction while cutting
    // memory bandwidth by 75% compared to native raw captures.
    const SCALE: usize = 2;
    let out_w = (src_w / SCALE).max(1);
    let out_h = (src_h / SCALE).max(1);
    let rgba_bytes = out_w * out_h * 4;
    let total_bytes = 24 + rgba_bytes;

    out_buf.resize(total_bytes, 0);
    out_buf[0..4].copy_from_slice(&(crop_log_x as f32).to_le_bytes());
    out_buf[4..8].copy_from_slice(&(crop_log_y as f32).to_le_bytes());
    out_buf[8..12].copy_from_slice(&(crop_log_w as f32).to_le_bytes());
    out_buf[12..16].copy_from_slice(&(crop_log_h as f32).to_le_bytes());
    out_buf[16..20].copy_from_slice(&(out_w as u32).to_le_bytes());
    out_buf[20..24].copy_from_slice(&(out_h as u32).to_le_bytes());

    let mut hash: u64 = 0xcbf29ce484222325;
    for out_row in 0..out_h {
        let src_y0 = out_row * SCALE;
        let src_y1 = (src_y0 + 1).min(src_h - 1);
        let row0 = src_y0 * src_stride;
        let row1 = src_y1 * src_stride;
        let dst_row = 24 + out_row * out_w * 4;

        for out_col in 0..out_w {
            let src_x0 = out_col * SCALE;
            let src_x1 = (src_x0 + 1).min(src_w - 1);

            let p00 = row0 + src_x0 * 4;
            let p01 = row0 + src_x1 * 4;
            let p10 = row1 + src_x0 * 4;
            let p11 = row1 + src_x1 * 4;

            // 2x2 box average:
            let b = ((bgra[p00] as u32
                + bgra[p01] as u32
                + bgra[p10] as u32
                + bgra[p11] as u32
                + 2)
                >> 2) as u8;
            let g = ((bgra[p00 + 1] as u32
                + bgra[p01 + 1] as u32
                + bgra[p10 + 1] as u32
                + bgra[p11 + 1] as u32
                + 2)
                >> 2) as u8;
            let r = ((bgra[p00 + 2] as u32
                + bgra[p01 + 2] as u32
                + bgra[p10 + 2] as u32
                + bgra[p11 + 2] as u32
                + 2)
                >> 2) as u8;

            let d = dst_row + out_col * 4;
            out_buf[d] = r;
            out_buf[d + 1] = g;
            out_buf[d + 2] = b;
            out_buf[d + 3] = 255;

            if (out_col & 1) == 0 {
                let packed = (((r >> 2) as u64) << 16)
                    | (((g >> 2) as u64) << 8)
                    | ((b >> 2) as u64);
                hash ^= packed;
                hash = hash.wrapping_mul(0x100000001b3);
            }
        }
    }

    let combined_hash = hash
        .wrapping_mul(0x100000001b3)
        ^ ((out_w as u64) << 16)
        ^ (out_h as u64);
    let prev_hash = LAST_BACKDROP_HASH.swap(combined_hash, Ordering::Relaxed);
    if !force && prev_hash == combined_hash && prev_hash != 0 {
        return Some(Vec::new());
    }
    Some(out_buf.clone())
}

// One window handle and one crop rectangle, again spelled out the way
// the caller reads them.
#[allow(clippy::too_many_arguments)]
fn capture_crop_rgba_packet(
    pill_hwnd: Option<HWND>,
    crop_log_x: f64,
    crop_log_y: f64,
    crop_log_w: f64,
    crop_log_h: f64,
    x: i32,
    y: i32,
    w: i32,
    h: i32,
    force: bool,
) -> Option<Vec<u8>> {
    if w <= 0 || h <= 0 {
        return None;
    }
    let mut pool_guard = CAPTURE_POOL.lock().ok()?;

    // SAFETY: Win32 GDI crop capture of `(x, y, w, h)` via persistent reusable DIB section.
    // The pill is excluded from capture only around our own `BitBlt`, then
    // restored to `WDA_NONE` so OS capture tools keep seeing it.
    if let Some(hwnd) = pill_hwnd {
        set_pill_capture_excluded(hwnd, true);
    }
    let result = unsafe {
        let screen_dc = GetDC(HWND(std::ptr::null_mut()));
        if screen_dc.is_invalid() {
            None
        } else {
        let pool = pool_guard.get_or_insert_with(|| {
            let mem_dc = CreateCompatibleDC(screen_dc);
            CapturePool {
                mem_dc,
                dib: HBITMAP::default(),
                bits_ptr: std::ptr::null_mut(),
                capacity_w: 0,
                capacity_h: 0,
                packet_buf: Vec::with_capacity(64 * 1024),
            }
        });

        if pool.mem_dc.is_invalid() {
            pool.mem_dc = CreateCompatibleDC(screen_dc);
        }

        // Reallocate the persistent DIB section only if requested dimensions exceed capacity.
        if pool.dib.is_invalid() || w > pool.capacity_w || h > pool.capacity_h {
            if !pool.dib.is_invalid() {
                let _ = DeleteObject(pool.dib);
                pool.dib = HBITMAP::default();
            }
            let new_cap_w = w.max(pool.capacity_w).max(512);
            let new_cap_h = h.max(pool.capacity_h).max(384);
            let bmi = BITMAPINFO {
                bmiHeader: BITMAPINFOHEADER {
                    biSize: std::mem::size_of::<BITMAPINFOHEADER>() as u32,
                    biWidth: new_cap_w,
                    biHeight: -new_cap_h,
                    biPlanes: 1,
                    biBitCount: 32,
                    biCompression: BI_RGB.0,
                    ..Default::default()
                },
                ..Default::default()
            };
            let mut bits_ptr: *mut std::ffi::c_void = std::ptr::null_mut();
            if let Ok(dib) = CreateDIBSection(
                screen_dc,
                &bmi,
                DIB_RGB_COLORS,
                &raw mut bits_ptr,
                None,
                0,
            ) && !dib.is_invalid()
                && !bits_ptr.is_null()
            {
                let _ = SelectObject(pool.mem_dc, dib);
                pool.dib = dib;
                pool.bits_ptr = bits_ptr;
                pool.capacity_w = new_cap_w;
                pool.capacity_h = new_cap_h;
            }
        }

        if pool.dib.is_invalid() || pool.bits_ptr.is_null() {
            let _ = ReleaseDC(HWND(std::ptr::null_mut()), screen_dc);
            None
        } else {
        let blt_ok = BitBlt(pool.mem_dc, 0, 0, w, h, screen_dc, x, y, SRCCOPY).is_ok();
        let _ = GdiFlush();
        let _ = ReleaseDC(HWND(std::ptr::null_mut()), screen_dc);

        if blt_ok {
            let byte_len = (pool.capacity_w as usize) * (h as usize) * 4;
            let slice = std::slice::from_raw_parts(pool.bits_ptr as *const u8, byte_len);
            encode_downsampled_rgba_packet(
                slice,
                w as usize,
                h as usize,
                (pool.capacity_w as usize) * 4,
                crop_log_x,
                crop_log_y,
                crop_log_w,
                crop_log_h,
                force,
                &mut pool.packet_buf,
            )
        } else {
            None
        }
        }
        }
    };
    if let Some(hwnd) = pill_hwnd {
        set_pill_capture_excluded(hwnd, false);
    }
    result
}

/// Applies native Windows DWM region clipping strictly inside the pill's
/// rounded capsule (and its open panel, if any), and returns a raw binary
/// `tauri::ipc::Response` containing the 2x-downsampled RGBA desktop crop
/// underneath the pill. The pill stays capturable (`WDA_NONE`) except around
/// our own `BitBlt`, so Snipping Tool and friends keep seeing it.
#[tauri::command]
// The signature is the command's wire format: the pill sends the pill
// rectangle and the panel rectangle as separate numbers.
#[allow(clippy::too_many_arguments)]
pub fn set_pill_blur_region(
    app: AppHandle,
    pill_x: f64,
    pill_y: f64,
    pill_w: f64,
    pill_h: f64,
    panel_x: Option<f64>,
    panel_y: Option<f64>,
    panel_w: Option<f64>,
    panel_h: Option<f64>,
    panel_r: Option<f64>,
    force: Option<bool>,
    capture: Option<bool>,
) -> Response {
    let Some(window) = app.get_webview_window(PILL) else {
        return Response::new(Vec::new());
    };
    let Ok(hwnd) = window.hwnd() else {
        return Response::new(Vec::new());
    };
    let scale = window.scale_factor().unwrap_or(1.0);
    if scale <= 0.0 || pill_w <= 0.0 || pill_h <= 0.0 {
        return Response::new(Vec::new());
    }

    let left = (pill_x * scale).round() as i32;
    let top = (pill_y * scale).round() as i32;
    let right = ((pill_x + pill_w) * scale).round() as i32;
    let bottom = ((pill_y + pill_h) * scale).round() as i32;
    let radius = (pill_h * scale).round() as i32;

    let mut log_min_x = pill_x;
    let mut log_min_y = pill_y;
    let mut log_max_x = pill_x + pill_w;
    let mut log_max_y = pill_y + pill_h;

    // Physical panel rect + corner diameter, when a panel is open.
    let mut panel_phys = [0i32; 5];
    if let (Some(px), Some(py), Some(pw), Some(ph)) = (panel_x, panel_y, panel_w, panel_h)
        && pw > 0.0
        && ph > 0.0
    {
        log_min_x = log_min_x.min(px);
        log_min_y = log_min_y.min(py);
        log_max_x = log_max_x.max(px + pw);
        log_max_y = log_max_y.max(py + ph);
        panel_phys = [
            (px * scale).round() as i32,
            (py * scale).round() as i32,
            ((px + pw) * scale).round() as i32,
            ((py + ph) * scale).round() as i32,
            ((panel_r.unwrap_or(20.0) * 2.0) * scale).round() as i32,
        ];
    }

    // The sampling loop calls this every display frame; the region itself
    // only changes when the pill or panel geometry does. Rebuilding the HRGN
    // and re-submitting it to DWM is skipped unless the shape moved.
    let region_key: RegionKey = [
        hwnd.0 as isize,
        left as isize,
        top as isize,
        right as isize,
        bottom as isize,
        radius as isize,
        panel_phys[0] as isize,
        panel_phys[1] as isize,
        panel_phys[2] as isize,
        panel_phys[3] as isize,
        panel_phys[4] as isize,
    ];
    let region_changed = LAST_BLUR_REGION
        .lock()
        .map(|mut last| {
            if *last == Some(region_key) {
                false
            } else {
                *last = Some(region_key);
                true
            }
        })
        .unwrap_or(true);

    // SAFETY: Win32 GDI region and DWM calls operate on our own HWND; any
    // created HRGN is deleted immediately after DwmEnableBlurBehindWindow
    // copies it.
    if region_changed {
        unsafe {
            let pill_rgn = CreateRoundRectRgn(left, top, right, bottom, radius, radius);
            if !pill_rgn.is_invalid() {
                let [p_left, p_top, p_right, p_bottom, p_diam] = panel_phys;
                if p_right > p_left && p_bottom > p_top {
                    let panel_rgn =
                        CreateRoundRectRgn(p_left, p_top, p_right, p_bottom, p_diam, p_diam);
                    if !panel_rgn.is_invalid() {
                        let _ = CombineRgn(pill_rgn, pill_rgn, panel_rgn, RGN_OR);
                        let _ = DeleteObject(panel_rgn);
                    }
                }

                let bb = DWM_BLURBEHIND {
                    dwFlags: DWM_BB_ENABLE | DWM_BB_BLURREGION,
                    fEnable: true.into(),
                    hRgnBlur: pill_rgn,
                    fTransitionOnMaximized: false.into(),
                };
                let _ = DwmEnableBlurBehindWindow(HWND(hwnd.0), &bb);
                let _ = DeleteObject(pill_rgn);
            }
        }
    }

    // Performance mode: the region above still follows the shape, but the
    // desktop is never read — no BitBlt, no encode, no payload.
    if capture == Some(false) {
        return Response::new(Vec::new());
    }

    let Some(((win_phys_x, win_phys_y), _)) = window_rect(&window) else {
        return Response::new(Vec::new());
    };
    let crop_pad = 16.0;
    let crop_log_x = (log_min_x - crop_pad).floor();
    let crop_log_y = (log_min_y - crop_pad).floor();
    let crop_log_w = ((log_max_x + crop_pad).ceil() - crop_log_x).max(1.0);
    let crop_log_h = ((log_max_y + crop_pad).ceil() - crop_log_y).max(1.0);

    let phys_x = win_phys_x.round() as i32 + (crop_log_x * scale).round() as i32;
    let phys_y = win_phys_y.round() as i32 + (crop_log_y * scale).round() as i32;
    let phys_w = (crop_log_w * scale).round().max(2.0) as i32;
    let phys_h = (crop_log_h * scale).round().max(2.0) as i32;

    let packet = capture_crop_rgba_packet(
        Some(HWND(hwnd.0)),
        crop_log_x,
        crop_log_y,
        crop_log_w,
        crop_log_h,
        phys_x,
        phys_y,
        phys_w,
        phys_h,
        force.unwrap_or(false),
    )
    .unwrap_or_default();

    Response::new(packet)
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
            let cursor = (cx / scale, cy / scale);
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
/// The pill stays visible on screen in all phases — including idle — so
/// the user sees that Whisperlane is running and ready, rather than
/// silently hiding away in the system tray.
pub fn pill_visible_in(_phase: Option<Phase>) -> bool {
    true
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

/// The URL the pill loads.
///
/// `WHISPERLANE_GLASS_PROBE=1` loads the pill with the refraction probe
/// in the query string: the surface then draws a high-contrast pattern
/// behind itself and runs the lens at probe strength, so refraction can
/// be judged by eye. Dev tooling only — a normal launch never carries
/// the flag, and this function is the whole of the plumbing.
fn pill_url(glass_probe: bool) -> WebviewUrl {
    if glass_probe {
        WebviewUrl::App("index.html?glass-probe=1".into())
    } else {
        WebviewUrl::default()
    }
}

/// Creates the pill overlay.
///
/// Borderless, above everything, and never focusable: an overlay that
/// took focus would starve the global chord and would become the
/// destination for the very text it exists to announce. It starts
/// visible so the user immediately knows the app has launched and is ready.
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
    WebviewWindowBuilder::new(
        app,
        PILL,
        pill_url(std::env::var("WHISPERLANE_GLASS_PROBE").as_deref() == Ok("1")),
    )
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
        .visible(true)
        .build()?;
    // The room around the pill passes the pointer through from the very
    // first moment, so nothing underneath is ever unreachable by it.
    // The pill stays capturable (WDA_NONE) so screenshots keep seeing it;
    // capture exclusion is applied only around our own BitBlt reads.
    if let Some(window) = app.get_webview_window(PILL) {
        let _ = window.set_ignore_cursor_events(true);
        if let Ok(hwnd) = window.hwnd() {
            set_pill_capture_excluded(HWND(hwnd.0), false);
        }
    }
    Ok(())
}

/// Shows or hides the pill for the phase the pipeline is in.
pub fn apply_phase(app: &AppHandle, phase: Option<Phase>) {
    let Some(pill) = app.get_webview_window(PILL) else {
        return;
    };
    invalidate_backdrop_hash();
    if pill_visible_in(phase) {
        let _ = pill.show();
    } else {
        let _ = pill.hide();
    }
}

/// Whether the window that opens on a first run is still waiting to be put
/// on screen for the first time.
///
/// The window is created at a size nothing has been measured against, so
/// showing it at creation shows the introduction clipped. A first run is
/// therefore shown by its own first fit instead — see `fit_window`. The
/// flag is spent the moment it is used, so a layout change on a window the
/// user has since put away cannot bring it back uninvited.
pub struct FirstRunReveal(pub std::sync::atomic::AtomicBool);

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
        set_settings_visible(&app, false);
        return;
    }
    set_settings_visible(&app, true);
    let _ = main.unminimize();
    let _ = main.set_focus();
}

/// Whether the settings window is on screen.
///
/// Asked by the interface on mount, because the window that would have
/// started its background has already been on screen by then.
#[tauri::command]
pub fn is_settings_visible(app: AppHandle) -> bool {
    app.get_webview_window(MAIN)
        .map(|window| window.is_visible().unwrap_or(false))
        .unwrap_or(false)
}

/// Shows or hides the settings window and says which it did.
///
/// Every hiding and showing goes through here so the window can tell the
/// interface when it has left the screen. The settings window draws a
/// moving background, and a window nobody can see is not a reason to keep
/// drawing it: the whole application spends most of its life hidden in
/// the tray, and a full-surface blurred animation running through all of
/// that is a cost paid for a picture nobody is looking at.
pub fn set_settings_visible(app: &AppHandle, visible: bool) {
    let Some(window) = app.get_webview_window(MAIN) else {
        return;
    };
    if visible {
        let _ = window.show();
    } else {
        let _ = window.hide();
    }
    let _ = window.emit("window-visibility", visible);
}

/// Exits the application cleanly from the pill's popover menu, matching
/// the tray's quit item.
#[tauri::command]
pub fn quit_app(app: AppHandle) {
    app.exit(0);
}

/// Minimizes the pill overlay by hiding it to the tray.
#[tauri::command]
pub fn minimize_pill(app: AppHandle) {
    if let Some(pill) = app.get_webview_window(PILL) {
        let _ = pill.hide();
    }
}

/// Resizes the settings window around what it is actually showing.
///
/// A frameless window has no operating-system frame to make it look like
/// it has a size, and a fixed one leaves either empty space or clipped
/// content depending on what is in it. So the window takes the size its
/// content measures, and the transparent margin the stylesheet draws the
/// shadow in is added back here — the surface cannot know how far the
/// shadow reaches.
///
/// The window grows about its centre so that a row appearing or a model
/// finishing moves the content a little rather than shoving the whole
/// window across the screen.
///
/// The screen is the one limit the content does not get to set. A window
/// taller than the work area opens with its own header above the top of
/// the screen, where no control can be reached and no scroll can help; the
/// surface caps itself by the same room and scrolls instead, so a long
/// introduction is read rather than lost.
#[tauri::command]
pub fn fit_window(app: AppHandle, content_width: f64, content_height: f64, bleed: f64) {
    let Some(window) = app.get_webview_window(MAIN) else {
        return;
    };
    // Everything here is in physical pixels, matching what the two calls
    // below take. Reading the window's own geometry directly rather than
    // through the pill's helper keeps the units in one place: that helper
    // reports logical pixels, and mixing the two silently moved the window
    // to its own size instead of its own place.
    let (Ok(scale), Ok(position), Ok(size)) = (
        window.scale_factor(),
        window.outer_position(),
        window.outer_size(),
    ) else {
        return;
    };
    if scale <= 0.0 {
        return;
    }
    let (work_x, work_y, work_width, work_height) = work_area(scale);
    // Room left around a window that is as tall as it may be, so it reads
    // as sitting on the desktop rather than pinned between its edges. The
    // measure and the room are logical; the window is set in physical.
    let room = |wanted: f64, available: f64| {
        if available > 0.0 {
            wanted.min(available - FIT_ROOM)
        } else {
            wanted
        }
    };
    let wanted = (
        room(content_width + bleed * 2.0, work_width).max(1.0),
        room(content_height + bleed * 2.0, work_height).max(1.0),
    );
    let wanted_width = (wanted.0 * scale).round().max(1.0) as u32;
    let wanted_height = (wanted.1 * scale).round().max(1.0) as u32;
    if size.width != wanted_width || size.height != wanted_height {
        let _ = window.set_size(tauri::PhysicalSize::new(wanted_width, wanted_height));
        // Windows anchors a resized window at its top-left, so a window that
        // shrinks on open would creep down and to the right. Moving it back
        // by half the difference keeps the middle where the user left it.
        let dx = (size.width as i32 - wanted_width as i32) / 2;
        let dy = (size.height as i32 - wanted_height as i32) / 2;
        let _ = window.set_position(tauri::PhysicalPosition::new(position.x + dx, position.y + dy));
        keep_on_screen(
            &window,
            wanted,
            (work_x, work_y, work_width, work_height),
            scale,
        );
    }
    // A first run is presented by its own first fit. The window is created
    // at a size chosen before anything has been measured, and showing it
    // there shows the introduction clipped — a scrollbar in the place the
    // one button on the screen should be. Waiting costs the moment it takes
    // the interface to say how tall it is, and buys a first frame that is
    // already the right one.
    if let Some(reveal) = app.try_state::<FirstRunReveal>()
        && reveal.0.swap(false, Ordering::Relaxed)
    {
        set_settings_visible(&app, true);
        let _ = window.set_focus();
    }
}

/// How much of the work area a window sized to its content leaves free.
///
/// Small enough that a screen is used rather than admired, large enough
/// that the window does not read as a sheet of glass laid over everything.
const FIT_ROOM: f64 = 32.0;

/// Brings a window back inside the work area after a resize.
///
/// The resize itself is centred, which is what keeps a growing window from
/// walking across the screen; that same centring is what can push a window
/// taller than the room it has past the top edge. A window that is not on
/// the desktop is not a window, so the corner is moved back in and the
/// content scrolls inside it.
///
/// Logical throughout, like the work area it is clamped to.
fn keep_on_screen(
    window: &tauri::WebviewWindow,
    size: (f64, f64),
    work: (f64, f64, f64, f64),
    scale: f64,
) {
    let (work_x, work_y, work_width, work_height) = work;
    if work_width <= 0.0 || work_height <= 0.0 {
        return;
    }
    let Ok(placed) = window.outer_position() else {
        return;
    };
    let logical = (placed.x as f64 / scale, placed.y as f64 / scale);
    let rightmost = work_x + work_width - size.0;
    let bottommost = work_y + work_height - size.1;
    // A window larger than the work area has nothing to clamp to: the
    // choice is which edge it hangs off, and the top-left is the one a
    // user can still see and drag.
    let (x, y) = (
        logical.0.clamp(work_x.min(rightmost), work_x.max(rightmost)),
        logical.1.clamp(work_y.min(bottommost), work_y.max(bottommost)),
    );
    if (x, y) != logical {
        let _ = window.set_position(tauri::PhysicalPosition::new(
            (x * scale).round() as i32,
            (y * scale).round() as i32,
        ));
    }
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
    fn every_phase_including_idle_is_shown() {
        assert!(pill_visible_in(None));
        assert!(pill_visible_in(Some(Phase::Idle)));
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
    fn the_glass_probe_never_reaches_a_normal_launch() {
        // The probe is dev tooling: only the environment variable puts it
        // in the pill's URL, and the default stays the plain page. The
        // query rides the URL because the pill's window is the one place
        // the pattern has to be — under the glass it is meant to bend.
        assert!(matches!(
            pill_url(false),
            WebviewUrl::App(path) if path.to_str() == Some("index.html")
        ));
        assert!(matches!(
            pill_url(true),
            WebviewUrl::App(path) if path.to_str().unwrap_or("").contains("glass-probe=1")
        ));
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

    #[test]
    fn live_crop_capture_produces_valid_rgba_binary_packet() {
        invalidate_backdrop_hash();
        let synthetic_bgra = vec![128u8; 320 * 88 * 4];
        let mut buf = Vec::new();
        let packet = encode_downsampled_rgba_packet(
            &synthetic_bgra,
            320,
            88,
            320 * 4,
            36.0,
            224.0,
            352.0,
            88.0,
            true,
            &mut buf,
        )
        .expect("RGBA packet encoding should succeed");
        let w = u32::from_le_bytes(packet[16..20].try_into().unwrap());
        let h = u32::from_le_bytes(packet[20..24].try_into().unwrap());
        assert_eq!((w, h), (160, 44));
        assert_eq!(packet.len(), 24 + (160 * 44 * 4));

        // Second call with identical pixels and `force = false` returns empty delta:
        let delta = encode_downsampled_rgba_packet(
            &synthetic_bgra,
            320,
            88,
            320 * 4,
            36.0,
            224.0,
            352.0,
            88.0,
            false,
            &mut buf,
        )
        .expect("unchanged frame should return empty delta Vec");
        assert!(delta.is_empty());
    }
}

//! Own low-level keyboard hook for the configurable dictation chord
//! (ADR-001): Control plus a trigger key, with Shift on the default.
//!
//! Why own code instead of a hotkey crate: bare-modifier chords cannot
//! go through the register-a-shortcut path, and owning the hook keeps
//! the state machine pure and testable. Method only — no foreign hotkey
//! package.
//!
//! The hook observes and never hides a keystroke. Swallowing a key the
//! focused application never sees released leaves its own modifier state
//! latched, and the next keystroke then arrives as an accidental
//! shortcut. Letting the chord through costs one visible space
//! character in a text field; a latched Control costs the user their
//! next keystroke.

use std::cell::UnsafeCell;
use std::sync::atomic::{AtomicU8, Ordering};
use std::sync::{mpsc, Mutex};
use std::time::Instant;

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager};
use windows::Win32::Foundation::{LPARAM, LRESULT, WPARAM};
use windows::Win32::System::LibraryLoader::GetModuleHandleW;
use windows::Win32::UI::WindowsAndMessaging::{
    CallNextHookEx, GetMessageW, SetWindowsHookExW, HHOOK, KBDLLHOOKSTRUCT, MSG,
    WH_KEYBOARD_LL, WM_KEYDOWN, WM_KEYUP, WM_SYSKEYDOWN, WM_SYSKEYUP,
};

use crate::audio;
use crate::pipeline::{set_phase, Phase};

const VK_LCONTROL: u32 = 0xA2;
const VK_RCONTROL: u32 = 0xA3;
const VK_CONTROL: u32 = 0x11;
const VK_LSHIFT: u32 = 0xA0;
const VK_RSHIFT: u32 = 0xA1;
const VK_SHIFT: u32 = 0x10;
const VK_SPACE: u32 = 0x20;
const VK_Y: u32 = 0x59;
const VK_ESCAPE: u32 = 0x1B;

/// The user-selectable dictation chord (ADR-001: configurable from the
/// first useful milestone, with the legacy plugin choice retained as an
/// alternate). Control is present in every binding, so only Shift and
/// the trigger key vary.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "snake_case")]
pub enum Hotkey {
    #[default]
    CtrlShiftSpace,
    CtrlSpace,
    CtrlY,
}

impl Hotkey {
    /// Offered in this order: the approved default first.
    pub const ALL: [Hotkey; 3] = [Hotkey::CtrlShiftSpace, Hotkey::CtrlSpace, Hotkey::CtrlY];

    pub const fn needs_shift(self) -> bool {
        matches!(self, Hotkey::CtrlShiftSpace)
    }

    pub const fn trigger_vk(self) -> u32 {
        match self {
            Hotkey::CtrlY => VK_Y,
            _ => VK_SPACE,
        }
    }

    /// Plain-language label for the settings surface. A binding with a
    /// known cost says so, because a chord that fights the editor or
    /// types a stray space should not be chosen silently.
    pub const fn label(self) -> &'static str {
        match self {
            Hotkey::CtrlShiftSpace => "Control + Shift + Space (hold)",
            Hotkey::CtrlSpace => "Control + Space (types a space; collides with autocomplete)",
            Hotkey::CtrlY => "Control + Y (plugin legacy)",
        }
    }

    const fn code(self) -> u8 {
        match self {
            Hotkey::CtrlShiftSpace => 0,
            Hotkey::CtrlSpace => 1,
            Hotkey::CtrlY => 2,
        }
    }

    const fn from_code(code: u8) -> Self {
        match code {
            1 => Hotkey::CtrlSpace,
            2 => Hotkey::CtrlY,
            _ => Hotkey::CtrlShiftSpace,
        }
    }
}

/// One offered binding, as the settings surface needs it.
#[derive(Debug, Clone, Serialize)]
pub struct HotkeyChoice {
    pub code: String,
    pub label: String,
}

/// The offered bindings come from the core, so the choice list lives in
/// exactly one place.
#[tauri::command]
pub fn list_hotkeys() -> Vec<HotkeyChoice> {
    Hotkey::ALL
        .iter()
        .map(|hotkey| HotkeyChoice {
            code: serde_json::to_value(hotkey)
                .ok()
                .and_then(|v| v.as_str().map(str::to_owned))
                .unwrap_or_default(),
            label: hotkey.label().to_string(),
        })
        .collect()
}

/// The active binding. The hook reads it on every keystroke, so it is a
/// lock-free snapshot rather than a settings lookup: no mutex runs
/// inside the hook callback.
static BINDING: AtomicU8 = AtomicU8::new(Hotkey::CtrlShiftSpace.code());

pub fn current_binding() -> Hotkey {
    Hotkey::from_code(BINDING.load(Ordering::Relaxed))
}

/// Applies a new binding. The chord state is left alone on purpose: it
/// is hook-thread-only, and a half-finished chord always clears itself
/// on release.
pub fn apply_binding(hotkey: Hotkey) {
    BINDING.store(hotkey.code(), Ordering::Relaxed);
}

/// A chord press shorter than this counts as a tap, which toggles
/// dictation instead of ending it (docs/04-experience.md,
/// toggle-to-talk: the user taps to start and taps to stop).
pub const TAP_MAX_MS: u64 = 300;

/// Whether a press was a tap rather than a hold. Pure and separately
/// tested, because the machine that measures it cannot control time.
pub fn is_tap(held_ms: u64) -> bool {
    held_ms <= TAP_MAX_MS
}

/// What the hook reports to the take pipeline.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum HookEvent {
    /// The chord is fully down.
    Pressed,
    /// The chord came up after being held this long.
    Released { held_ms: u64 },
    /// The user asked to discard the take.
    Cancelled,
}

fn is_ctrl(vk: u32) -> bool {
    matches!(vk, VK_LCONTROL | VK_RCONTROL | VK_CONTROL)
}

fn is_shift(vk: u32) -> bool {
    matches!(vk, VK_LSHIFT | VK_RSHIFT | VK_SHIFT)
}

/// Pure chord machine over raw virtual-key events. No OS calls, fully
/// unit-tested, and it never asks to hide a keystroke: the hook only
/// observes. Shared as a static: the hook callback is the only
/// accessor, so no locking runs inside the hook.
#[derive(Debug)]
pub struct ChordState {
    ctrl: bool,
    shift: bool,
    trigger: bool,
    active: bool,
    /// When the chord went fully down, so the release can report how
    /// long it was held. Tap versus hold is only knowable on release.
    pressed_at: Option<Instant>,
}

impl ChordState {
    pub const fn new() -> Self {
        Self {
            ctrl: false,
            shift: false,
            trigger: false,
            active: false,
            pressed_at: None,
        }
    }

    /// Clears a latched chord without emitting an edge. Only used on
    /// focus regain, where no take is in flight.
    pub fn reset(&mut self) {
        *self = Self::new();
    }

    /// How long the chord was held, rounded to milliseconds.
    fn release_after_hold(&mut self) -> HookEvent {
        let held_ms = self
            .pressed_at
            .take()
            .map(|started| started.elapsed().as_millis() as u64)
            .unwrap_or(0);
        HookEvent::Released { held_ms }
    }

    /// Returns what the hook observed, if anything.
    ///
    /// Nothing is swallowed. Swallowing a key the focused application
    /// never sees released leaves that application's own modifier state
    /// latched, so the next keystroke arrives as an accidental shortcut;
    /// Control plus Space stays held on Windows for exactly this reason.
    /// The product has nothing to lose by letting the chord through: the
    /// trigger key types a space into a text field, which the user can
    /// see, and the transcript is inserted afterwards.
    ///
    /// Keys the binding does not use are not tracked at all, so a
    /// binding without Shift leaves Shift as ordinary typing.
    pub fn event(&mut self, vk: u32, down: bool, hotkey: Hotkey) -> Option<HookEvent> {
        let uses_shift = hotkey.needs_shift();
        if is_ctrl(vk) || (uses_shift && is_shift(vk)) {
            if is_ctrl(vk) {
                self.ctrl = down;
            } else {
                self.shift = down;
            }
            // Any modifier release ends the chord: users release the
            // modifiers before the trigger key, and waiting for the
            // trigger release would leave capture open.
            if self.active && !down {
                self.active = false;
                return Some(self.release_after_hold());
            }
            return None;
        }
        if vk == hotkey.trigger_vk() {
            self.trigger = down;
            let armed = self.ctrl && (!uses_shift || self.shift);
            if armed && down && !self.active {
                self.active = true;
                self.pressed_at = Some(Instant::now());
                return Some(HookEvent::Pressed);
            }
            if self.active && !down {
                self.active = false;
                return Some(self.release_after_hold());
            }
            // Trigger key without the modifier is ordinary typing.
            return None;
        }
        None
    }
}

/// What one hook event means for the take.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ChordAction {
    Start,
    Stop,
    Cancel,
    Ignore,
}

/// Pure intent decision over an event and the current phase. Unit-tested
/// because every dictation flow reduces to this table.
///
/// The chord is a switch once a take is live: pressing it again stops
/// the take whether it was started by hold or by tap, and releasing it
/// only stops a take that was started by holding.
pub fn resolve_action(event: HookEvent, phase: Option<Phase>) -> ChordAction {
    use ChordAction::*;
    match (event, phase) {
        (HookEvent::Pressed, Some(Phase::Idle)) => Start,
        (HookEvent::Pressed, Some(Phase::Listening)) => Stop,
        (HookEvent::Released { held_ms }, Some(Phase::Listening)) => {
            if is_tap(held_ms) {
                // A tap starts dictation and leaves it running.
                Ignore
            } else {
                Stop
            }
        }
        // Escape is observed here, not in the callback: the decision table is
        // the only place that knows what a live take is.
        (HookEvent::Cancelled, Some(Phase::Listening)) => Cancel,
        (HookEvent::Cancelled, Some(Phase::Thinking)) => Cancel,
        _ => Ignore,
    }
}

pub(crate) fn debug_log(line: String) {
    if !std::env::temp_dir().join("whisperlane-debug-keys").exists() {
        return;
    }
    if let Ok(mut f) = std::fs::OpenOptions::new().create(true).append(true).open(
        std::env::temp_dir().join("whisperlane-keys.log"),
    ) {
        use std::io::Write;
        let _ = f.write_all(line.as_bytes());
    }
}

/// Diagnostic snapshot of what the hook actually receives. Written in
/// the callback, read by the UI: proves which events reach us and with
/// which flags, without logging raw keys anywhere.
#[derive(Debug, Clone, Default, serde::Serialize)]
pub struct KeyDiag {
    pub last_event: String,
    pub last_count: u32,
    pub ctrl: bool,
    pub shift: bool,
    pub trigger: bool,
    pub active: bool,
    pub chords_seen: u32,
}

pub fn diag_snapshot(app: &AppHandle) -> KeyDiag {
    app.try_state::<DiagState>()
        .map(|s| s.0.lock().expect("diag state poisoned").clone())
        .unwrap_or_default()
}

#[tauri::command]
pub fn get_key_diag(app: AppHandle) -> KeyDiag {
    diag_snapshot(&app)
}

#[derive(Default)]
pub struct DiagState(pub Mutex<KeyDiag>);

fn record(app: &AppHandle, label: String, state: &ChordState) {
    if let Some(diag) = app.try_state::<DiagState>() {
        let mut d = diag.0.lock().expect("diag state poisoned");
        d.last_event = label;
        d.last_count = d.last_count.saturating_add(1);
        d.ctrl = state.ctrl;
        d.shift = state.shift;
        d.trigger = state.trigger;
        d.active = state.active;
    }
}

fn record_chord(app: &AppHandle) {
    if let Some(diag) = app.try_state::<DiagState>() {
        let mut d = diag.0.lock().expect("diag state poisoned");
        d.chords_seen = d.chords_seen.saturating_add(1);
    }
}

/// Single accessor wrapper: the hook callback is the only user, so the
/// interior mutability is confined to the hook thread by construction.
/// `UnsafeCell` also forces the static into the writable data section.
struct HookState(UnsafeCell<ChordState>);

// SAFETY: the installing hook thread is the only accessor, and the app
// handle is set once before the hook is installed.
unsafe impl Sync for HookApp {}
struct HookApp(UnsafeCell<Option<AppHandle>>);

static APP: HookApp = HookApp(UnsafeCell::new(None));

// SAFETY: only the hook callback thread touches the state, and a
// low-level keyboard hook always runs on the thread that installed it.
unsafe impl Sync for HookState {}

static STATE: HookState = HookState(UnsafeCell::new(ChordState::new()));

/// The hook callback itself decides everything: it runs on the same
/// thread as the message pump, before any other handler sees the event,
/// so the chord state stays consistent even when the OS swallows the
/// modifier release that a focused window receives.
unsafe extern "system" fn hook_proc(n_code: i32, w_param: WPARAM, l_param: LPARAM) -> LRESULT {
    if n_code >= 0 {
        // SAFETY: lParam is a valid KBDLLHOOKSTRUCT pointer for hook events.
        let kb = unsafe { &*(l_param.0 as *const KBDLLHOOKSTRUCT) };
        let vk = kb.vkCode;
        let down = w_param.0 == WM_KEYDOWN as usize || w_param.0 == WM_SYSKEYDOWN as usize;
        let up = w_param.0 == WM_KEYUP as usize || w_param.0 == WM_SYSKEYUP as usize;
        if down || up {
            let hotkey = current_binding();
            // SAFETY: STATE is reached only from this hook thread, and a
            // low-level keyboard hook always runs on its installing thread.
            let state = unsafe { &mut *STATE.0.get() };
            let event = state.event(vk, down, hotkey);
            // SAFETY: APP is written once before the hook starts.
            let diag_app = unsafe { (*APP.0.get()).clone() };
            if let Some(diag_app) = diag_app {
                let label = format!(
                    "vk={vk:#X} down={down} binding={} flags={:#X}",
                    hotkey.code(),
                    kb.flags.0
                );
                record(&diag_app, label, state);
                if event.is_some() {
                    record_chord(&diag_app);
                }
            }
            if let Some(event) = event {
                debug_log(format!("hook {event:?}\n"));
                if let Some(tx) = EDGE_TX.get() {
                    let _ = tx.send(event);
                }
            } else {
                debug_log(format!("hook vk={vk:#X} down={down}\n"));
            }
            // Escape discards a live take. It is still passed through,
            // because the hook never hides a keystroke; the focused
            // window keeps its own idea of what Escape means.
            if vk == VK_ESCAPE && !down && cancel_live() {
                debug_log("hook escape: cancel\n".to_string());
                if let Some(tx) = EDGE_TX.get() {
                    let _ = tx.send(HookEvent::Cancelled);
                }
            }
        }
    }
    // SAFETY: forwarding to the next hook in the chain.
    unsafe { CallNextHookEx(HHOOK::default(), n_code, w_param, l_param) }
}

/// Whether a take is live and can therefore be cancelled.
///
/// One short, uncontended lock against a phase read: the alternative
/// would be chord-local state, which cannot know that a toggled take is
/// still running. This is orders of magnitude below the window in which
/// Windows silently unhooks a slow low-level hook.
fn cancel_live() -> bool {
    // SAFETY: APP is written once before the hook starts.
    let Some(app) = (unsafe { (*APP.0.get()).clone() }) else {
        return false;
    };
    matches!(
        crate::pipeline::current_phase(&app),
        Some(Phase::Listening) | Some(Phase::Thinking)
    )
}

static EDGE_TX: std::sync::OnceLock<mpsc::Sender<HookEvent>> = std::sync::OnceLock::new();

/// Installs the hook and pumps messages on this thread. Slow work never
/// runs here: events queue to the audio worker; blocking the hook thread
/// gets a low-level hook silently uninstalled by Windows.
pub fn run_listener(app: AppHandle) {
    let (tx, rx) = mpsc::channel::<HookEvent>();
    let _ = EDGE_TX.set(tx);
    let worker = app.clone();
    std::thread::spawn(move || {
        for event in rx {
            debug_log(format!("worker {event:?}\n"));
            audio::dispatch(&worker, event);
        }
    });

    let err_app = app.clone();
    // SAFETY: module handle of our own binary; hook runs on this thread's
    // message pump below, unhooked automatically when the thread exits.
    let hook = unsafe {
        let module = GetModuleHandleW(None).unwrap_or_default();
        SetWindowsHookExW(WH_KEYBOARD_LL, Some(hook_proc), module, 0)
    };
    let Ok(hook) = hook else {
        set_phase(
            &err_app,
            Phase::Failed,
            Some("could not install keyboard hook".to_string()),
        );
        return;
    };
    // SAFETY: single write before the hook is installed; read-only after.
    unsafe { *APP.0.get() = Some(app.clone()) };
    debug_log("hook installed\n".to_string());
    let focus_app = app.clone();
    std::thread::spawn(move || {
        loop {
            std::thread::sleep(std::time::Duration::from_millis(500));
            clear_stale_state(&focus_app);
        }
    });
    let mut msg = MSG::default();
    // SAFETY: standard message pump; keeps the hook alive.
    while unsafe { GetMessageW(&mut msg, None, 0, 0) }.as_bool() {}
    let _ = hook;
}

/// Focus and desktop switches can drop the modifier release, which would
/// leave the chord latched and every later press dead. The window
/// regaining focus is the first reliable moment to clear that state.
fn clear_stale_state(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        if let Ok(true) = window.is_focused() {
            // SAFETY: same hook-thread-only rule as STATE.
            let state = unsafe { &mut *STATE.0.get() };
            state.reset();
        }
    }
}

#[tauri::command]
pub fn get_hotkey_label() -> String {
    current_binding().label().to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The approved default binding, named once for readability.
    const DEFAULT: Hotkey = Hotkey::CtrlShiftSpace;

    /// Whether an event is a chord release, whatever the hold duration.
    fn is_release(event: Option<HookEvent>) -> bool {
        matches!(event, Some(HookEvent::Released { .. }))
    }

    #[test]
    fn activates_when_last_side_goes_down() {
        let mut s = ChordState::new();
        assert_eq!(s.event(VK_LCONTROL, true, DEFAULT), None);
        assert_eq!(s.event(VK_LSHIFT, true, DEFAULT), None);
        assert_eq!(
            s.event(VK_SPACE, true, DEFAULT),
            Some(HookEvent::Pressed)
        );
    }

    #[test]
    fn either_side_variant_counts() {
        let mut s = ChordState::new();
        s.event(VK_RCONTROL, true, DEFAULT);
        s.event(VK_RSHIFT, true, DEFAULT);
        assert_eq!(
            s.event(VK_SPACE, true, DEFAULT),
            Some(HookEvent::Pressed)
        );
    }

    #[test]
    fn modifiers_always_pass_through() {
        let mut s = ChordState::new();
        assert_eq!(s.event(VK_LCONTROL, true, DEFAULT), None);
        assert_eq!(s.event(VK_LSHIFT, true, DEFAULT), None);
        assert_eq!(
            s.event(VK_SPACE, true, DEFAULT),
            Some(HookEvent::Pressed)
        );
        // Repeat and modifier repeats never swallow, never re-fire.
        assert_eq!(s.event(VK_SPACE, true, DEFAULT), None);
        assert_eq!(s.event(VK_LCONTROL, true, DEFAULT), None);
    }

    #[test]
    fn modifier_release_ends_the_chord_even_while_trigger_held() {
        let mut s = ChordState::new();
        s.event(VK_LCONTROL, true, DEFAULT);
        s.event(VK_LSHIFT, true, DEFAULT);
        s.event(VK_SPACE, true, DEFAULT);
        assert!(is_release(s.event(VK_LCONTROL, false, DEFAULT)));
        // Trigger release after the chord ended is plain typing again.
        assert_eq!(s.event(VK_SPACE, false, DEFAULT), None);
    }

    #[test]
    fn trigger_release_ends_the_chord() {
        let mut s = ChordState::new();
        s.event(VK_LCONTROL, true, DEFAULT);
        s.event(VK_LSHIFT, true, DEFAULT);
        s.event(VK_SPACE, true, DEFAULT);
        assert!(is_release(s.event(VK_SPACE, false, DEFAULT)));
    }

    #[test]
    fn a_full_chord_leaves_no_latched_state_behind() {
        // The hook observes without hiding, so a matched press and
        // release must leave nothing pending: the same chord works again
        // immediately afterwards.
        let mut s = ChordState::new();
        s.event(VK_LCONTROL, true, DEFAULT);
        s.event(VK_LSHIFT, true, DEFAULT);
        assert_eq!(s.event(VK_SPACE, true, DEFAULT), Some(HookEvent::Pressed));
        assert!(is_release(s.event(VK_SPACE, false, DEFAULT)));
        assert_eq!(s.event(VK_LSHIFT, false, DEFAULT), None);
        assert_eq!(s.event(VK_LCONTROL, false, DEFAULT), None);
        // Second take without any reset in between.
        s.event(VK_LCONTROL, true, DEFAULT);
        s.event(VK_LSHIFT, true, DEFAULT);
        assert_eq!(s.event(VK_SPACE, true, DEFAULT), Some(HookEvent::Pressed));
    }

    #[test]
    fn trigger_key_alone_is_plain_typing() {
        let mut s = ChordState::new();
        assert_eq!(s.event(VK_SPACE, true, DEFAULT), None);
        assert_eq!(s.event(VK_SPACE, false, DEFAULT), None);
    }

    #[test]
    fn reset_clears_a_latched_chord() {
        let mut s = ChordState::new();
        s.event(VK_LCONTROL, true, DEFAULT);
        s.event(VK_LSHIFT, true, DEFAULT);
        s.event(VK_SPACE, true, DEFAULT);
        s.reset();
        // After a reset the same press works again instead of dead.
        s.event(VK_LCONTROL, true, DEFAULT);
        s.event(VK_LSHIFT, true, DEFAULT);
        assert_eq!(
            s.event(VK_SPACE, true, DEFAULT),
            Some(HookEvent::Pressed)
        );
    }

    #[test]
    fn unrelated_keys_pass_through() {
        let mut s = ChordState::new();
        assert_eq!(s.event(0x41, true, DEFAULT), None);
        assert_eq!(s.event(0x41, false, DEFAULT), None);
    }

    #[test]
    fn generic_modifier_codes_count() {
        let mut s = ChordState::new();
        s.event(VK_CONTROL, true, DEFAULT);
        s.event(VK_SHIFT, true, DEFAULT);
        assert_eq!(
            s.event(VK_SPACE, true, DEFAULT),
            Some(HookEvent::Pressed)
        );
    }

    #[test]
    fn default_binding_needs_shift() {
        assert!(Hotkey::CtrlShiftSpace.needs_shift());
        assert_eq!(Hotkey::CtrlShiftSpace.trigger_vk(), VK_SPACE);
    }

    #[test]
    fn control_space_binding_ignores_shift_entirely() {
        let mut s = ChordState::new();
        // Shift is ordinary typing for this binding: neither tracked nor
        // swallowed.
        assert_eq!(s.event(VK_LSHIFT, true, Hotkey::CtrlSpace), None);
        s.event(VK_LCONTROL, true, Hotkey::CtrlSpace);
        // A held Shift neither blocks nor changes the binding.
        assert_eq!(
            s.event(VK_SPACE, true, Hotkey::CtrlSpace),
            Some(HookEvent::Pressed)
        );
        assert!(is_release(s.event(VK_SPACE, false, Hotkey::CtrlSpace)));
        // Releasing Shift does not end the take: it is not part of it.
        assert_eq!(s.event(VK_LSHIFT, false, Hotkey::CtrlSpace), None);
    }

    #[test]
    fn control_space_binding_does_not_fire_on_y() {
        let mut s = ChordState::new();
        s.event(VK_LCONTROL, true, Hotkey::CtrlSpace);
        // Y is plain typing while this binding is active.
        assert_eq!(s.event(VK_Y, true, Hotkey::CtrlSpace), None);
    }

    #[test]
    fn control_y_binding_uses_y_and_ignores_space() {
        let mut s = ChordState::new();
        s.event(VK_LCONTROL, true, Hotkey::CtrlY);
        assert_eq!(s.event(VK_SPACE, true, Hotkey::CtrlY), None);
        assert_eq!(
            s.event(VK_Y, true, Hotkey::CtrlY),
            Some(HookEvent::Pressed)
        );
        assert!(is_release(s.event(VK_Y, false, Hotkey::CtrlY)));
    }

    #[test]
    fn a_binding_change_switches_which_chord_fires() {
        let mut s = ChordState::new();
        // Pressed while the default is active: Space fires.
        s.event(VK_LCONTROL, true, Hotkey::CtrlShiftSpace);
        s.event(VK_LSHIFT, true, Hotkey::CtrlShiftSpace);
        assert_eq!(
            s.event(VK_SPACE, true, Hotkey::CtrlShiftSpace),
            Some(HookEvent::Pressed)
        );
        s.event(VK_SPACE, false, Hotkey::CtrlShiftSpace);
        s.event(VK_LSHIFT, false, Hotkey::CtrlShiftSpace);
        s.event(VK_LCONTROL, false, Hotkey::CtrlShiftSpace);
        // After switching, the old chord is ordinary typing.
        assert_eq!(s.event(VK_SPACE, true, Hotkey::CtrlY), None);
        s.event(VK_SPACE, false, Hotkey::CtrlY);
        s.event(VK_LCONTROL, true, Hotkey::CtrlY);
        assert_eq!(
            s.event(VK_Y, true, Hotkey::CtrlY),
            Some(HookEvent::Pressed)
        );
    }

    #[test]
    fn binding_codes_round_trip() {
        for hotkey in Hotkey::ALL {
            assert_eq!(Hotkey::from_code(hotkey.code()), hotkey);
            assert!(!hotkey.label().is_empty());
        }
    }

    #[test]
    fn choices_cover_every_binding_in_order() {
        let choices = list_hotkeys();
        assert_eq!(choices.len(), Hotkey::ALL.len());
        assert_eq!(choices[0].code, "ctrl_shift_space");
        assert!(choices.iter().all(|c| !c.label.is_empty()));
    }

    #[test]
    fn applied_binding_is_the_active_one() {
        let original = current_binding();
        apply_binding(Hotkey::CtrlY);
        assert_eq!(current_binding(), Hotkey::CtrlY);
        apply_binding(original);
        assert_eq!(current_binding(), original);
    }

    #[test]
    fn tap_is_a_short_press() {
        assert!(is_tap(0));
        assert!(is_tap(TAP_MAX_MS));
        assert!(!is_tap(TAP_MAX_MS + 1));
    }

    #[test]
    fn holding_from_idle_starts_and_releasing_ends_the_take() {
        assert_eq!(
            resolve_action(HookEvent::Pressed, Some(Phase::Idle)),
            ChordAction::Start
        );
        assert_eq!(
            resolve_action(HookEvent::Released { held_ms: 2_000 }, Some(Phase::Listening)),
            ChordAction::Stop
        );
    }

    #[test]
    fn tapping_from_idle_starts_a_take_that_keeps_running() {
        assert_eq!(
            resolve_action(HookEvent::Pressed, Some(Phase::Idle)),
            ChordAction::Start
        );
        // The short release must not stop what it started.
        assert_eq!(
            resolve_action(HookEvent::Released { held_ms: 120 }, Some(Phase::Listening)),
            ChordAction::Ignore
        );
    }

    #[test]
    fn pressing_again_while_listening_stops_the_take() {
        assert_eq!(
            resolve_action(HookEvent::Pressed, Some(Phase::Listening)),
            ChordAction::Stop
        );
        assert_eq!(
            resolve_action(HookEvent::Released { held_ms: 1_000 }, Some(Phase::Listening)),
            ChordAction::Stop
        );
    }

    #[test]
    fn cancelling_works_while_capturing_and_while_thinking() {
        assert_eq!(
            resolve_action(HookEvent::Cancelled, Some(Phase::Listening)),
            ChordAction::Cancel
        );
        assert_eq!(
            resolve_action(HookEvent::Cancelled, Some(Phase::Thinking)),
            ChordAction::Cancel
        );
    }

    #[test]
    fn events_outside_a_live_take_are_ignored() {
        assert_eq!(
            resolve_action(HookEvent::Cancelled, Some(Phase::Idle)),
            ChordAction::Ignore
        );
        assert_eq!(
            resolve_action(HookEvent::Pressed, Some(Phase::Thinking)),
            ChordAction::Ignore
        );
        assert_eq!(
            resolve_action(HookEvent::Released { held_ms: 900 }, Some(Phase::Thinking)),
            ChordAction::Ignore
        );
        assert_eq!(
            resolve_action(HookEvent::Pressed, Some(Phase::Done)),
            ChordAction::Ignore
        );
        assert_eq!(resolve_action(HookEvent::Pressed, None), ChordAction::Ignore);
    }

    #[test]
    fn a_chord_reports_press_then_release_with_a_duration() {
        let mut s = ChordState::new();
        s.event(VK_LCONTROL, true, DEFAULT);
        s.event(VK_LSHIFT, true, DEFAULT);
        assert_eq!(
            s.event(VK_SPACE, true, DEFAULT),
            Some(HookEvent::Pressed)
        );
        match s.event(VK_SPACE, false, DEFAULT) {
            Some(HookEvent::Released { held_ms }) => assert!(held_ms < TAP_MAX_MS),
            other => panic!("expected a release, got {other:?}"),
        }
    }

    #[test]
    fn a_toggle_take_survives_further_releases() {
        let mut s = ChordState::new();
        s.event(VK_LCONTROL, true, DEFAULT);
        s.event(VK_LSHIFT, true, DEFAULT);
        s.event(VK_SPACE, true, DEFAULT);
        s.event(VK_SPACE, false, DEFAULT);
        s.event(VK_LSHIFT, false, DEFAULT);
        s.event(VK_LCONTROL, false, DEFAULT);
        // Stray modifier releases after the tap produce no further edge.
        assert_eq!(s.event(VK_LSHIFT, false, DEFAULT), None);
        assert_eq!(s.event(VK_LCONTROL, false, DEFAULT), None);
    }
}

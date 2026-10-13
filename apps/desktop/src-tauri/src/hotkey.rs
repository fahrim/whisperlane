//! Own low-level keyboard hook for the approved default chord
//! (ADR-001): hold Control + platform key to dictate.
//!
//! Why own code instead of a hotkey crate: the chord is bare modifiers
//! (no plain key), so `RegisterHotKey`-based crates cannot express it,
//! and owning the hook gives us the raw virtual-key log that diagnosed
//! the first skeleton issues. Method only — no foreign hotkey package.
//!
//! Blocking rule (skeleton): while the chord is active, its key events
//! are swallowed so the platform key never wakes the Start menu.
//! Everything else passes through untouched.

use std::sync::mpsc;
use std::sync::atomic::{AtomicBool, Ordering};

use tauri::AppHandle;
use windows::Win32::Foundation::{LPARAM, LRESULT, WPARAM};
use windows::Win32::System::LibraryLoader::GetModuleHandleW;
use windows::Win32::UI::WindowsAndMessaging::{
    CallNextHookEx, GetMessageW, SetWindowsHookExW, HHOOK, KBDLLHOOKSTRUCT, MSG,
    WH_KEYBOARD_LL, WM_KEYDOWN, WM_KEYUP, WM_SYSKEYDOWN, WM_SYSKEYUP,
};

use crate::audio;
use crate::pipeline::{set_phase, Phase};

/// Approved default (ADR-001, amended by ADR-003): hold Control +
/// Shift + Space to dictate. Modifier-only Control + Super proved
/// undeliverable on keyboards with key masking, so the default moved to
/// a chord with a plain key. Alternates arrive with M1 settings.
pub const DEFAULT_HOTKEY_LABEL: &str = "Control + Shift + Space (hold)";

const VK_LCONTROL: u32 = 0xA2;
const VK_RCONTROL: u32 = 0xA3;
const VK_CONTROL: u32 = 0x11;
const VK_LSHIFT: u32 = 0xA0;
const VK_RSHIFT: u32 = 0xA1;
const VK_SHIFT: u32 = 0x10;
const VK_SPACE: u32 = 0x20;

/// Edge of the watched chord: both sides down, or no longer both down.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ChordEdge {
    Activated,
    Released,
}

fn is_ctrl(vk: u32) -> bool {
    matches!(vk, VK_LCONTROL | VK_RCONTROL | VK_CONTROL)
}

fn is_shift(vk: u32) -> bool {
    matches!(vk, VK_LSHIFT | VK_RSHIFT | VK_SHIFT)
}

fn is_space(vk: u32) -> bool {
    vk == VK_SPACE
}

/// Pure chord machine over raw virtual-key events. No OS calls,
/// fully unit-tested. Returns the edge plus whether to swallow the event.
#[derive(Debug, Default)]
pub struct ChordState {
    ctrl: bool,
    shift: bool,
    space: bool,
    active: bool,
}

impl ChordState {
    pub fn event(&mut self, vk: u32, down: bool) -> (Option<ChordEdge>, bool) {
        if is_ctrl(vk) {
            self.ctrl = down;
        } else if is_shift(vk) {
            self.shift = down;
        } else if is_space(vk) {
            self.space = down;
        } else {
            return (None, false);
        }
        if self.ctrl && self.shift && self.space && !self.active {
            self.active = true;
            (Some(ChordEdge::Activated), true)
        } else if self.active && !(self.ctrl && self.shift && self.space) {
            self.active = false;
            (Some(ChordEdge::Released), true)
        } else {
            (None, self.active)
        }
    }
}

/// Hold-to-talk intent for the M0 skeleton: press starts capture,
/// release ends it and hands the take to transcription. Toggle-to-talk
/// is M1 scope.
pub fn resolve_edge(edge: ChordEdge, phase: Phase) -> Option<Phase> {
    match (edge, phase) {
        (ChordEdge::Activated, Phase::Idle) => Some(Phase::Listening),
        (ChordEdge::Released, Phase::Listening) => Some(Phase::Thinking),
        _ => None,
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

static HOOK_ALIVE: AtomicBool = AtomicBool::new(false);

unsafe extern "system" fn hook_proc(n_code: i32, w_param: WPARAM, l_param: LPARAM) -> LRESULT {
    if n_code >= 0 {
        // SAFETY: lParam is a valid KBDLLHOOKSTRUCT pointer for hook events.
        let kb = unsafe { &*(l_param.0 as *const KBDLLHOOKSTRUCT) };
        let vk = kb.vkCode;
        let down = w_param.0 == WM_KEYDOWN as usize || w_param.0 == WM_SYSKEYDOWN as usize;
        let up = w_param.0 == WM_KEYUP as usize || w_param.0 == WM_SYSKEYUP as usize;
        if (down || up) && (is_ctrl(vk) || is_shift(vk) || is_space(vk)) {
            if let Some(tx) = HOOK_TX.get() {
                let _ = tx.send((vk, down));
            }
            // Swallowing decision needs shared state; the forwarder thread
            // owns it and replies through the same channel pair. To keep
            // this callback in microseconds, swallow optimistically here
            // only when the chord was already active.
            if HOOK_ACTIVE.load(Ordering::SeqCst) {
                debug_log(format!("hook vk={vk:#X} down={down} swallowed\n"));
                return LRESULT(1);
            }
            debug_log(format!("hook vk={vk:#X} down={down} passed\n"));
        }
    }
    // SAFETY: forwarding to the next hook in the chain.
    unsafe { CallNextHookEx(HHOOK::default(), n_code, w_param, l_param) }
}

static HOOK_TX: std::sync::OnceLock<mpsc::Sender<(u32, bool)>> = std::sync::OnceLock::new();
static HOOK_ACTIVE: AtomicBool = AtomicBool::new(false);

/// Installs the hook and pumps messages on this thread. Slow work never
/// runs here: edges queue to the audio worker; blocking the hook thread
/// gets a low-level hook silently uninstalled by Windows.
pub fn run_listener(app: AppHandle) {
    let (tx, rx) = mpsc::channel::<ChordEdge>();
    let worker = app.clone();
    std::thread::spawn(move || {
        for edge in rx {
            debug_log(format!("worker {edge:?}\n"));
            match edge {
                ChordEdge::Activated => audio::begin_take(&worker),
                ChordEdge::Released => audio::end_take(&worker),
            }
        }
    });
    let (raw_tx, raw_rx) = mpsc::channel::<(u32, bool)>();
    let _ = HOOK_TX.set(raw_tx);
    let edge_tx = tx.clone();
    std::thread::spawn(move || {
        let mut state = ChordState::default();
        for (vk, down) in raw_rx {
            let (edge, active) = state.event(vk, down);
            HOOK_ACTIVE.store(active, Ordering::SeqCst);
            if let Some(edge) = edge {
                debug_log(format!("edge {edge:?}\n"));
                if edge_tx.send(edge).is_err() {
                    break;
                }
            }
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
    HOOK_ALIVE.store(true, Ordering::SeqCst);
    debug_log("hook installed\n".to_string());
    let mut msg = MSG::default();
    // SAFETY: standard message pump; keeps the hook alive.
    while unsafe { GetMessageW(&mut msg, None, 0, 0) }.as_bool() {}
    let _ = hook;
    HOOK_ALIVE.store(false, Ordering::SeqCst);
}

#[tauri::command]
pub fn get_hotkey_label() -> String {
    DEFAULT_HOTKEY_LABEL.to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn activates_when_last_side_goes_down() {
        let mut s = ChordState::default();
        assert_eq!(s.event(VK_LCONTROL, true), (None, false));
        assert_eq!(s.event(VK_LSHIFT, true), (None, false));
        assert_eq!(s.event(VK_SPACE, true), (Some(ChordEdge::Activated), true));
    }

    #[test]
    fn either_side_variant_counts() {
        let mut s = ChordState::default();
        s.event(VK_RCONTROL, true);
        s.event(VK_RSHIFT, true);
        assert_eq!(s.event(VK_SPACE, true), (Some(ChordEdge::Activated), true));
    }

    #[test]
    fn repeats_while_held_stay_swallowed_without_new_edge() {
        let mut s = ChordState::default();
        s.event(VK_LCONTROL, true);
        s.event(VK_LSHIFT, true);
        assert_eq!(s.event(VK_SPACE, true), (Some(ChordEdge::Activated), true));
        assert_eq!(s.event(VK_SPACE, true), (None, true));
        assert_eq!(s.event(VK_LCONTROL, true), (None, true));
    }

    #[test]
    fn releases_when_any_side_comes_up() {
        let mut s = ChordState::default();
        s.event(VK_LCONTROL, true);
        s.event(VK_LSHIFT, true);
        s.event(VK_SPACE, true);
        assert_eq!(s.event(VK_LCONTROL, false), (Some(ChordEdge::Released), true));

        let mut s = ChordState::default();
        s.event(VK_LCONTROL, true);
        s.event(VK_LSHIFT, true);
        s.event(VK_SPACE, true);
        assert_eq!(s.event(VK_SPACE, false), (Some(ChordEdge::Released), true));
    }

    #[test]
    fn unrelated_keys_pass_through() {
        let mut s = ChordState::default();
        assert_eq!(s.event(0x41, true), (None, false));
        assert_eq!(s.event(0x41, false), (None, false));
    }

    #[test]
    fn generic_modifier_codes_count() {
        let mut s = ChordState::default();
        s.event(VK_CONTROL, true);
        s.event(VK_SHIFT, true);
        assert_eq!(s.event(VK_SPACE, true), (Some(ChordEdge::Activated), true));
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

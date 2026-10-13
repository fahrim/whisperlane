//! Persisted user settings: the minimum the v1 flows require
//! (docs/04-experience.md — hotkey, microphone, language, model state).
//!
//! One concern, one module. Hotkey and microphone arrive with their own
//! slices; only the fields a slice actually needs live here, so no
//! setting exists without the flow that reads it.
//!
//! Default language is `auto` per maintainer direction
//! (docs/08-decisions.md item 4), overriding the pinned-language default
//! the recommendation states.

use std::path::{Path, PathBuf};
use std::sync::Mutex;

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager};

use crate::hotkey::{apply_binding, Hotkey};

/// The chooser offers common pinned languages plus an explicit
/// auto-detect entry (docs/08-decisions.md item 4). Auto is the default:
/// mixed-language dictation is the common case here, at a known time
/// cost that stays a revisit item.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "snake_case")]
pub enum Language {
    #[default]
    Auto,
    En,
    Tr,
    De,
    Fr,
    Es,
}

impl Language {
    /// Every offered choice, in the order the settings surface shows
    /// them: auto-detect first, then the pinned languages.
    pub const ALL: [Language; 6] = [
        Language::Auto,
        Language::En,
        Language::Tr,
        Language::De,
        Language::Fr,
        Language::Es,
    ];

    /// The value the engine expects. `auto` is honest about detection
    /// rather than guessing a language for the user.
    pub const fn code(self) -> &'static str {
        match self {
            Language::Auto => "auto",
            Language::En => "en",
            Language::Tr => "tr",
            Language::De => "de",
            Language::Fr => "fr",
            Language::Es => "es",
        }
    }

    /// Human-readable name for the settings surface.
    pub const fn label(self) -> &'static str {
        match self {
            Language::Auto => "Detect automatically",
            Language::En => "English",
            Language::Tr => "Türkçe",
            Language::De => "Deutsch",
            Language::Fr => "Français",
            Language::Es => "Español",
        }
    }
}

/// Which microphone takes dictation.
///
/// The system default is a real answer, not a placeholder: the first
/// take works with no setup at all (ADR-001 — microphone selection stays
/// ask-on-first-press). Naming a device is the opt-in once there is
/// something to choose between.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "snake_case", tag = "kind", content = "id")]
pub enum Microphone {
    #[default]
    SystemDefault,
    Device(String),
}

impl Microphone {
    /// The stored device identity, or nothing for the system default.
    pub fn device_id(&self) -> Option<&str> {
        match self {
            Microphone::SystemDefault => None,
            Microphone::Device(id) => Some(id),
        }
    }
}

/// The persisted set. Unknown or missing fields fall back to defaults so
/// a settings file written by another version still loads.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(default, rename_all = "snake_case")]
pub struct Settings {
    pub language: Language,
    pub hotkey: Hotkey,
    pub microphone: Microphone,
}

pub struct SettingsState(pub Mutex<Settings>);

fn settings_path(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("could not resolve data dir: {e:?}"))?;
    std::fs::create_dir_all(&dir).map_err(|e| format!("could not create data dir: {e}"))?;
    Ok(dir.join("settings.json"))
}

/// Reads settings from disk. A missing or unreadable file is not an
/// error: defaults are the honest answer, and a corrupt file must never
/// block dictation.
pub fn read_settings(path: &Path) -> Settings {
    std::fs::read_to_string(path)
        .ok()
        .and_then(|raw| serde_json::from_str(&raw).ok())
        .unwrap_or_default()
}

pub fn write_settings(path: &Path, settings: &Settings) -> Result<(), String> {
    let raw = serde_json::to_string_pretty(settings)
        .map_err(|e| format!("could not encode settings: {e}"))?;
    std::fs::write(path, raw).map_err(|e| format!("could not save settings: {e}"))
}

/// Loads settings at startup, falling back to defaults.
pub fn load(app: &AppHandle) -> Settings {
    match settings_path(app) {
        Ok(path) => read_settings(&path),
        Err(_) => Settings::default(),
    }
}

/// The language the engine should use for the next take.
pub fn language_of(app: &AppHandle) -> Language {
    app.try_state::<SettingsState>()
        .map(|state| state.0.lock().expect("settings state poisoned").language)
        .unwrap_or_default()
}

/// One offered language, as the settings surface needs it.
#[derive(Debug, Clone, Serialize)]
pub struct LanguageChoice {
    pub code: &'static str,
    pub label: &'static str,
}

/// The offered languages come from the core, so the choice list lives
/// in exactly one place and the interface never restates it.
#[tauri::command]
pub fn list_languages() -> Vec<LanguageChoice> {
    Language::ALL
        .iter()
        .map(|language| LanguageChoice {
            code: language.code(),
            label: language.label(),
        })
        .collect()
}

#[tauri::command]
pub fn get_settings(state: tauri::State<'_, SettingsState>) -> Settings {
    state.0.lock().expect("settings state poisoned").clone()
}

/// Changes the language and persists it. The engine picks the new
/// language on the next take: the loaded service is reloaded rather than
/// reused, because it was started with the previous one.
#[tauri::command]
pub fn set_language(app: AppHandle, language: Language) -> Settings {
    let updated = persist(&app, |settings| settings.language = language);
    // A language change reloads the service, which was started with the
    // previous one.
    if let Ok(path) = settings_path(&app) {
        let _ = write_settings(&path, &updated);
        crate::stt::reload(&app);
    }
    updated
}

/// The microphone the next take uses.
pub fn microphone_of(app: &AppHandle) -> Microphone {
    app.try_state::<SettingsState>()
        .map(|state| state.0.lock().expect("settings state poisoned").microphone.clone())
        .unwrap_or_default()
}

/// Changes the dictation chord and applies it immediately: the hook
/// reads the binding per keystroke, so the next press uses the new one.
#[tauri::command]
pub fn set_hotkey(app: AppHandle, hotkey: Hotkey) -> Settings {
    let updated = persist(&app, |settings| settings.hotkey = hotkey);
    apply_binding(hotkey);
    if let Ok(path) = settings_path(&app) {
        let _ = write_settings(&path, &updated);
    }
    updated
}

/// Chooses the dictation microphone. The choice takes effect on the next
/// take; a running take is never disturbed.
#[tauri::command]
pub fn set_microphone(app: AppHandle, microphone: Microphone) -> Settings {
    let updated = persist(&app, |settings| settings.microphone = microphone);
    if let Ok(path) = settings_path(&app) {
        let _ = write_settings(&path, &updated);
    }
    updated
}

/// Applies one change to the in-memory settings, returns the result.
fn persist(app: &AppHandle, change: impl FnOnce(&mut Settings)) -> Settings {
    let state = app
        .try_state::<SettingsState>()
        .expect("settings state managed by the builder");
    let mut guard = state.0.lock().expect("settings state poisoned");
    change(&mut guard);
    guard.clone()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn auto_is_the_default_language() {
        assert_eq!(Settings::default().language, Language::Auto);
        assert_eq!(Language::default(), Language::Auto);
        assert_eq!(Language::Auto.code(), "auto");
    }

    #[test]
    fn every_offered_language_has_a_distinct_engine_code() {
        let mut codes: Vec<&str> = Language::ALL.iter().map(|l| l.code()).collect();
        let count = codes.len();
        codes.sort_unstable();
        codes.dedup();
        assert_eq!(codes.len(), count);
    }

    #[test]
    fn choices_cover_every_language_in_order() {
        let choices = list_languages();
        assert_eq!(choices.len(), Language::ALL.len());
        assert_eq!(choices[0].code, "auto");
        assert_eq!(
            choices.iter().map(|c| c.code).collect::<Vec<_>>(),
            Language::ALL.iter().map(|l| l.code()).collect::<Vec<_>>()
        );
    }

    #[test]
    fn offered_languages_all_have_labels() {
        for language in Language::ALL {
            assert!(!language.label().is_empty());
        }
    }

    #[test]
    fn settings_roundtrip_through_disk() {
        let path = std::env::temp_dir().join("whisperlane-settings-roundtrip.json");
        let settings = Settings {
            language: Language::Tr,
            hotkey: Hotkey::CtrlY,
            microphone: Microphone::Device("Headset".to_string()),
        };
        write_settings(&path, &settings).unwrap();
        assert_eq!(read_settings(&path), settings);
        let _ = std::fs::remove_file(&path);
    }

    #[test]
    fn missing_or_corrupt_file_falls_back_to_defaults() {
        let path = std::env::temp_dir().join("whisperlane-settings-absent.json");
        let _ = std::fs::remove_file(&path);
        assert_eq!(read_settings(&path), Settings::default());
        std::fs::write(&path, "{not json").unwrap();
        assert_eq!(read_settings(&path), Settings::default());
        let _ = std::fs::remove_file(&path);
    }

    #[test]
    fn settings_from_another_version_keep_defaults_for_new_fields() {
        let path = std::env::temp_dir().join("whisperlane-settings-older.json");
        // A file written before the hotkey setting existed still loads,
        // and the missing field falls back to the approved default.
        std::fs::write(&path, r#"{"language":"de"}"#).unwrap();
        let loaded = read_settings(&path);
        assert_eq!(loaded.language, Language::De);
        assert_eq!(loaded.hotkey, Hotkey::CtrlShiftSpace);
        std::fs::write(&path, "{}").unwrap();
        assert_eq!(read_settings(&path), Settings::default());
        let _ = std::fs::remove_file(&path);
    }

    #[test]
    fn default_binding_is_the_approved_one() {
        assert_eq!(Settings::default().hotkey, Hotkey::CtrlShiftSpace);
        assert_eq!(Hotkey::default(), Hotkey::CtrlShiftSpace);
    }
}
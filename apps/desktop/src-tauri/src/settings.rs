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
use tauri_plugin_autostart::ManagerExt;

use crate::hotkey::{apply_binding, Hotkey};
use crate::pipeline::set_phase;

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

/// Which theme the window uses.
///
/// The system is the default and not merely a fallback: a preference
/// nobody asked for should not be one the user has to undo, and the
/// operating system already knows what the room looks like.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "snake_case")]
pub enum Theme {
    #[default]
    System,
    Light,
    Dark,
}

impl Theme {
    pub const ALL: [Theme; 3] = [Theme::System, Theme::Light, Theme::Dark];

    pub fn label(self) -> &'static str {
        match self {
            Theme::System => "Match the system",
            Theme::Light => "Light",
            Theme::Dark => "Dark",
        }
    }

    pub fn code(self) -> &'static str {
        match self {
            Theme::System => "system",
            Theme::Light => "light",
            Theme::Dark => "dark",
        }
    }
}

/// The persisted set. Unknown or missing fields fall back to defaults so
/// a settings file written by another version still loads.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(default, rename_all = "snake_case")]
pub struct Settings {
    pub language: Language,
    pub hotkey: Hotkey,
    pub microphone: Microphone,
    /// Stored as the model id rather than the catalog entry: a settings
    /// file must stay readable after the catalog changes.
    pub model: String,
    /// Whether the one-screen introduction has been seen.
    ///
    /// Persisted rather than held by the window, because the window is
    /// rebuilt far more often than the user is new. A flag that lived in
    /// the interface would put the introduction back in front of them on
    /// every launch and every reload, which is the one thing "first
    /// run" must never do.
    pub onboarded: bool,
    /// Whether whisperlane starts with Windows.
    ///
    /// The chord is the whole product, and a dictation tool that is not
    /// running cannot be dictated to. Asked once on first run and
    /// changeable afterwards, because a preference asked once and then
    /// impossible to find is a preference the user has lost.
    pub start_with_windows: bool,
    /// Whether the window follows the system theme or the user's own.
    pub theme: Theme,
}

impl Default for Settings {
    /// The approved default model (ADR-006). Written explicitly rather
    /// than derived, because an empty id would leave the engine with no
    /// model at all.
    fn default() -> Self {
        Self {
            language: Language::Auto,
            hotkey: Hotkey::CtrlShiftSpace,
            microphone: Microphone::SystemDefault,
            model: crate::models::ModelChoice::DEFAULT.id.to_string(),
            onboarded: false,
            start_with_windows: false,
            theme: Theme::System,
        }
    }
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

/// The model the next take transcribes with.
///
/// A stored id that the catalog no longer offers falls back to the
/// default rather than leaving the engine without a model. The take
/// path reports the real file it looked for, so nothing is hidden.
pub fn model_of(app: &AppHandle) -> crate::models::ModelChoice {
    let id = app
        .try_state::<SettingsState>()
        .map(|state| state.0.lock().expect("settings state poisoned").model.clone())
        .unwrap_or_default();
    crate::models::ModelChoice::from_id(&id).unwrap_or(crate::models::ModelChoice::DEFAULT)
}

/// Chooses the model. An unknown id is refused rather than stored, so a
/// typo cannot leave dictation without a model. The service is reloaded
/// because it was started with the previous file.
#[tauri::command]
pub fn set_model(app: AppHandle, model: String) -> Settings {
    let Some(choice) = crate::models::ModelChoice::from_id(&model) else {
        set_phase(
            &app,
            crate::pipeline::Phase::Failed,
            Some(format!("unknown model '{model}'")),
        );
        return app
            .try_state::<SettingsState>()
            .map(|state| state.0.lock().expect("settings state poisoned").clone())
            .unwrap_or_default();
    };
    let updated = persist(&app, |settings| settings.model = choice.id.to_string());
    if let Ok(path) = settings_path(&app) {
        let _ = write_settings(&path, &updated);
    }
    crate::stt::reload(&app);
    updated
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

/// Starts with Windows, or stops.
///
/// The registration is changed first and the answer recorded second, so a
/// registry that refused leaves the setting saying what is actually
/// true rather than what the user asked for. A preference that lies
/// about its own state is worse than one that failed to save.
#[tauri::command]
pub fn set_start_with_windows(app: AppHandle, start: bool) -> Result<Settings, String> {
    let manager = app.autolaunch();
    let outcome = if start {
        manager.enable()
    } else {
        manager.disable()
    };
    if let Err(e) = outcome {
        return Err(format!("could not change start with Windows: {e}"));
    }
    let updated = persist(&app, |settings| settings.start_with_windows = start);
    if let Ok(path) = settings_path(&app) {
        let _ = write_settings(&path, &updated);
    }
    Ok(updated)
}

/// Whether the application is actually registered to start with Windows.
///
/// Read from the system rather than from the setting, so a registration
/// removed by hand — or refused by the operating system — is seen as
/// what it is.
#[tauri::command]
pub fn is_start_with_windows(app: AppHandle) -> bool {
    app.autolaunch().is_enabled().unwrap_or(false)
}

/// Sets the window theme and applies it to the document.
#[tauri::command]
pub fn set_theme(app: AppHandle, theme: Theme) -> Settings {
    let updated = persist(&app, |settings| settings.theme = theme);
    if let Ok(path) = settings_path(&app) {
        let _ = write_settings(&path, &updated);
    }
    updated
}

/// One offered theme, as the settings surface needs it.
#[derive(Debug, Clone, Serialize)]
pub struct ThemeChoice {
    pub code: &'static str,
    pub label: &'static str,
}

/// The offered themes come from the core, so the choice list lives in
/// exactly one place and the interface never restates it.
#[tauri::command]
pub fn list_themes() -> Vec<ThemeChoice> {
    Theme::ALL
        .iter()
        .map(|theme| ThemeChoice {
            code: theme.code(),
            label: theme.label(),
        })
        .collect()
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

/// Records that the introduction has been seen, so it is shown once
/// rather than on every launch.
///
/// Persisted immediately: closing the window straight after finishing
/// onboarding is the normal way people leave a first-run screen, and a
/// flag written only in memory would bring the whole thing back.
#[tauri::command]
pub fn complete_onboarding(app: AppHandle) -> Settings {
    let updated = persist(&app, |settings| settings.onboarded = true);
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
            model: "base-q5_1".to_string(),
            onboarded: true,
            start_with_windows: true,
            theme: Theme::Dark,
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
    fn the_new_preferences_default_to_asking_rather_than_doing() {
        // Starting with Windows is a decision the user makes, so the
        // default is off until they make it. The theme follows the system
        // by default, because the operating system already knows and a
        // preference nobody asked for should not be one to undo.
        let fresh = Settings::default();
        assert!(!fresh.start_with_windows);
        assert_eq!(fresh.theme, Theme::System);
    }

    #[test]
    fn every_offered_theme_names_itself_and_its_code() {
        let choices = list_themes();
        assert_eq!(choices.len(), Theme::ALL.len());
        assert_eq!(choices[0].code, "system");
        for choice in &choices {
            assert!(!choice.label.is_empty());
        }
    }

    #[test]
    fn onboarding_is_remembered_across_a_restart() {
        // The introduction has to survive a reload, because the window is
        // rebuilt far more often than the user is new. A flag that lived
        // only in the interface would put it back in front of them every
        // time, which is what this pins down.
        let path = std::env::temp_dir().join("whisperlane-settings-onboarded.json");
        let _ = std::fs::remove_file(&path);
        assert!(!read_settings(&path).onboarded, "a first run must show it");

        let seen = Settings {
            onboarded: true,
            ..Settings::default()
        };
        write_settings(&path, &seen).unwrap();
        assert!(read_settings(&path).onboarded, "a second run must not");
        let _ = std::fs::remove_file(&path);
    }

    #[test]
    fn default_binding_is_the_approved_one() {
        assert_eq!(Settings::default().hotkey, Hotkey::CtrlShiftSpace);
        assert_eq!(Hotkey::default(), Hotkey::CtrlShiftSpace);
    }
}
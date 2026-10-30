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
use tauri::{AppHandle, Emitter, Manager};
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
    Af,
    Sq,
    Am,
    Ar,
    Hy,
    As,
    Az,
    Ba,
    Eu,
    Be,
    Bn,
    Bs,
    Br,
    Bg,
    Yue,
    Ca,
    Zh,
    Hr,
    Cs,
    Da,
    Nl,
    Et,
    Fo,
    Fi,
    Gl,
    Ka,
    El,
    Gu,
    Ht,
    Ha,
    Haw,
    He,
    Hi,
    Hu,
    Is,
    Id,
    It,
    Ja,
    Jw,
    Kn,
    Kk,
    Km,
    Ko,
    Lo,
    La,
    Lv,
    Ln,
    Lt,
    Lb,
    Mk,
    Mg,
    Ms,
    Ml,
    Mt,
    Mi,
    Mr,
    Mn,
    My,
    Ne,
    No,
    Nn,
    Oc,
    Ps,
    Fa,
    Pl,
    Pt,
    Pa,
    Ro,
    Ru,
    Sa,
    Sr,
    Sn,
    Sd,
    Si,
    Sk,
    Sl,
    So,
    Su,
    Sw,
    Sv,
    Tl,
    Tg,
    Ta,
    Tt,
    Te,
    Th,
    Bo,
    Tk,
    Uk,
    Ur,
    Uz,
    Vi,
    Cy,
    Yi,
    Yo,
}

impl Language {
    pub const ALL: [Language; 101] = [
        Language::Auto,
        Language::En,
        Language::Tr,
        Language::De,
        Language::Fr,
        Language::Es,
        Language::Af,
        Language::Sq,
        Language::Am,
        Language::Ar,
        Language::Hy,
        Language::As,
        Language::Az,
        Language::Ba,
        Language::Eu,
        Language::Be,
        Language::Bn,
        Language::Bs,
        Language::Br,
        Language::Bg,
        Language::Yue,
        Language::Ca,
        Language::Zh,
        Language::Hr,
        Language::Cs,
        Language::Da,
        Language::Nl,
        Language::Et,
        Language::Fo,
        Language::Fi,
        Language::Gl,
        Language::Ka,
        Language::El,
        Language::Gu,
        Language::Ht,
        Language::Ha,
        Language::Haw,
        Language::He,
        Language::Hi,
        Language::Hu,
        Language::Is,
        Language::Id,
        Language::It,
        Language::Ja,
        Language::Jw,
        Language::Kn,
        Language::Kk,
        Language::Km,
        Language::Ko,
        Language::Lo,
        Language::La,
        Language::Lv,
        Language::Ln,
        Language::Lt,
        Language::Lb,
        Language::Mk,
        Language::Mg,
        Language::Ms,
        Language::Ml,
        Language::Mt,
        Language::Mi,
        Language::Mr,
        Language::Mn,
        Language::My,
        Language::Ne,
        Language::No,
        Language::Nn,
        Language::Oc,
        Language::Ps,
        Language::Fa,
        Language::Pl,
        Language::Pt,
        Language::Pa,
        Language::Ro,
        Language::Ru,
        Language::Sa,
        Language::Sr,
        Language::Sn,
        Language::Sd,
        Language::Si,
        Language::Sk,
        Language::Sl,
        Language::So,
        Language::Su,
        Language::Sw,
        Language::Sv,
        Language::Tl,
        Language::Tg,
        Language::Ta,
        Language::Tt,
        Language::Te,
        Language::Th,
        Language::Bo,
        Language::Tk,
        Language::Uk,
        Language::Ur,
        Language::Uz,
        Language::Vi,
        Language::Cy,
        Language::Yi,
        Language::Yo,
    ];

    pub const fn code(self) -> &'static str {
        match self {
            Language::Auto => "auto",
            Language::En => "en",
            Language::Tr => "tr",
            Language::De => "de",
            Language::Fr => "fr",
            Language::Es => "es",
            Language::Af => "af",
            Language::Sq => "sq",
            Language::Am => "am",
            Language::Ar => "ar",
            Language::Hy => "hy",
            Language::As => "as",
            Language::Az => "az",
            Language::Ba => "ba",
            Language::Eu => "eu",
            Language::Be => "be",
            Language::Bn => "bn",
            Language::Bs => "bs",
            Language::Br => "br",
            Language::Bg => "bg",
            Language::Yue => "yue",
            Language::Ca => "ca",
            Language::Zh => "zh",
            Language::Hr => "hr",
            Language::Cs => "cs",
            Language::Da => "da",
            Language::Nl => "nl",
            Language::Et => "et",
            Language::Fo => "fo",
            Language::Fi => "fi",
            Language::Gl => "gl",
            Language::Ka => "ka",
            Language::El => "el",
            Language::Gu => "gu",
            Language::Ht => "ht",
            Language::Ha => "ha",
            Language::Haw => "haw",
            Language::He => "he",
            Language::Hi => "hi",
            Language::Hu => "hu",
            Language::Is => "is",
            Language::Id => "id",
            Language::It => "it",
            Language::Ja => "ja",
            Language::Jw => "jw",
            Language::Kn => "kn",
            Language::Kk => "kk",
            Language::Km => "km",
            Language::Ko => "ko",
            Language::Lo => "lo",
            Language::La => "la",
            Language::Lv => "lv",
            Language::Ln => "ln",
            Language::Lt => "lt",
            Language::Lb => "lb",
            Language::Mk => "mk",
            Language::Mg => "mg",
            Language::Ms => "ms",
            Language::Ml => "ml",
            Language::Mt => "mt",
            Language::Mi => "mi",
            Language::Mr => "mr",
            Language::Mn => "mn",
            Language::My => "my",
            Language::Ne => "ne",
            Language::No => "no",
            Language::Nn => "nn",
            Language::Oc => "oc",
            Language::Ps => "ps",
            Language::Fa => "fa",
            Language::Pl => "pl",
            Language::Pt => "pt",
            Language::Pa => "pa",
            Language::Ro => "ro",
            Language::Ru => "ru",
            Language::Sa => "sa",
            Language::Sr => "sr",
            Language::Sn => "sn",
            Language::Sd => "sd",
            Language::Si => "si",
            Language::Sk => "sk",
            Language::Sl => "sl",
            Language::So => "so",
            Language::Su => "su",
            Language::Sw => "sw",
            Language::Sv => "sv",
            Language::Tl => "tl",
            Language::Tg => "tg",
            Language::Ta => "ta",
            Language::Tt => "tt",
            Language::Te => "te",
            Language::Th => "th",
            Language::Bo => "bo",
            Language::Tk => "tk",
            Language::Uk => "uk",
            Language::Ur => "ur",
            Language::Uz => "uz",
            Language::Vi => "vi",
            Language::Cy => "cy",
            Language::Yi => "yi",
            Language::Yo => "yo",
        }
    }

    pub const fn label(self) -> &'static str {
        match self {
            Language::Auto => "Detect automatically",
            Language::En => "English",
            Language::Tr => "Türkçe",
            Language::De => "Deutsch",
            Language::Fr => "Français",
            Language::Es => "Español",
            Language::Af => "Afrikaans",
            Language::Sq => "Albanian",
            Language::Am => "Amharic",
            Language::Ar => "Arabic",
            Language::Hy => "Armenian",
            Language::As => "Assamese",
            Language::Az => "Azerbaijani",
            Language::Ba => "Bashkir",
            Language::Eu => "Basque",
            Language::Be => "Belarusian",
            Language::Bn => "Bengali",
            Language::Bs => "Bosnian",
            Language::Br => "Breton",
            Language::Bg => "Bulgarian",
            Language::Yue => "Cantonese",
            Language::Ca => "Catalan",
            Language::Zh => "Chinese",
            Language::Hr => "Croatian",
            Language::Cs => "Czech",
            Language::Da => "Danish",
            Language::Nl => "Dutch",
            Language::Et => "Estonian",
            Language::Fo => "Faroese",
            Language::Fi => "Finnish",
            Language::Gl => "Galician",
            Language::Ka => "Georgian",
            Language::El => "Greek",
            Language::Gu => "Gujarati",
            Language::Ht => "Haitian Creole",
            Language::Ha => "Hausa",
            Language::Haw => "Hawaiian",
            Language::He => "Hebrew",
            Language::Hi => "Hindi",
            Language::Hu => "Hungarian",
            Language::Is => "Icelandic",
            Language::Id => "Indonesian",
            Language::It => "Italian",
            Language::Ja => "Japanese",
            Language::Jw => "Javanese",
            Language::Kn => "Kannada",
            Language::Kk => "Kazakh",
            Language::Km => "Khmer",
            Language::Ko => "Korean",
            Language::Lo => "Lao",
            Language::La => "Latin",
            Language::Lv => "Latvian",
            Language::Ln => "Lingala",
            Language::Lt => "Lithuanian",
            Language::Lb => "Luxembourgish",
            Language::Mk => "Macedonian",
            Language::Mg => "Malagasy",
            Language::Ms => "Malay",
            Language::Ml => "Malayalam",
            Language::Mt => "Maltese",
            Language::Mi => "Maori",
            Language::Mr => "Marathi",
            Language::Mn => "Mongolian",
            Language::My => "Myanmar (Burmese)",
            Language::Ne => "Nepali",
            Language::No => "Norwegian",
            Language::Nn => "Nynorsk",
            Language::Oc => "Occitan",
            Language::Ps => "Pashto",
            Language::Fa => "Persian",
            Language::Pl => "Polish",
            Language::Pt => "Portuguese",
            Language::Pa => "Punjabi",
            Language::Ro => "Romanian",
            Language::Ru => "Russian",
            Language::Sa => "Sanskrit",
            Language::Sr => "Serbian",
            Language::Sn => "Shona",
            Language::Sd => "Sindhi",
            Language::Si => "Sinhala",
            Language::Sk => "Slovak",
            Language::Sl => "Slovenian",
            Language::So => "Somali",
            Language::Su => "Sundanese",
            Language::Sw => "Swahili",
            Language::Sv => "Swedish",
            Language::Tl => "Tagalog",
            Language::Tg => "Tajik",
            Language::Ta => "Tamil",
            Language::Tt => "Tatar",
            Language::Te => "Telugu",
            Language::Th => "Thai",
            Language::Bo => "Tibetan",
            Language::Tk => "Turkmen",
            Language::Uk => "Ukrainian",
            Language::Ur => "Urdu",
            Language::Uz => "Uzbek",
            Language::Vi => "Vietnamese",
            Language::Cy => "Welsh",
            Language::Yi => "Yiddish",
            Language::Yo => "Yoruba",
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

/// How the pill's glass is drawn.
///
/// `Live` samples the desktop under the pill every display frame and
/// refracts it on the GPU — the product's intended look. `Performance`
/// stops the sampling entirely (no screen capture, no IPC, no WebGL
/// uploads) and paints a static frosted material instead, for machines
/// where the live glass costs more than it is worth.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "snake_case")]
pub enum GlassMode {
    #[default]
    Live,
    Performance,
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
    /// Live desktop glass, or the static performance material.
    pub glass: GlassMode,
    /// Whether a finished transcript is published on the local socket.
    ///
    /// Off by default: it is the one thing in the application that hands
    /// a transcript to another process, so it is asked for rather than
    /// assumed. The setting is the switch; the service itself lives in
    /// `transcript_service`.
    pub transcript_service: bool,
    /// Whether the pill opens a separate popup card for status notifications.
    /// Off by default; users can enable it in Settings.
    pub status_popup: bool,
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
            glass: GlassMode::Live,
            transcript_service: false,
            status_popup: false,
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
    let is_onboarded = app
        .try_state::<SettingsState>()
        .map(|state| state.0.lock().expect("settings state poisoned").onboarded)
        .unwrap_or(false);
    if is_onboarded && !crate::models::is_present(&app, choice) {
        return app
            .try_state::<SettingsState>()
            .map(|state| state.0.lock().expect("settings state poisoned").clone())
            .unwrap_or_default();
    }
    let updated = persist(&app, |settings| settings.model = choice.id.to_string());
    if let Ok(path) = settings_path(&app) {
        let _ = write_settings(&path, &updated);
    }
    let _ = app.emit(SETTINGS_CHANGED, &updated);
    crate::stt::reload(&app);
    // The chosen model is what readiness — and so the tray's resting line
    // — is about: a choice can change the answer without a phase moving.
    crate::tray::refresh_now(&app);
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

/// Whether a startup entry may be written from this build at all.
///
/// The plugin records the path of whatever executable is running. For an
/// installed build that is the installed application and the entry is
/// exactly right. For a development build it is a file inside the
/// project — one that a rebuild replaces and a clean deletes — and it
/// loads a page from a server that is not running, so the next logon
/// opens a broken window that nobody asked for and that only disappears
/// when the project folder does.
///
/// The build is the whole difference, so the build is what is checked.
fn may_register_startup() -> bool {
    !cfg!(debug_assertions)
}

/// Starts with Windows, or stops.
///
/// The registration is changed first and the answer recorded second, so a
/// registry that refused leaves the setting saying what is actually
/// true rather than what the user asked for. A preference that lies
/// about its own state is worse than one that failed to save.
#[tauri::command]
pub fn set_start_with_windows(app: AppHandle, start: bool) -> Result<Settings, String> {
    if start && !may_register_startup() {
        return Err(
            "this is a development build, so it will not register itself to start with Windows"
                .to_string(),
        );
    }
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

/// Event every window receives when a setting another window renders
/// has changed. The payload is the whole updated `Settings`.
pub const SETTINGS_CHANGED: &str = "settings-changed";

/// Switches between live desktop glass and performance mode.
///
/// Broadcast as well as returned: the change is made in the settings
/// window, but it is the pill window that has to stop (or resume)
/// sampling the desktop, and it must do so without a restart.
#[tauri::command]
pub fn set_glass_mode(app: AppHandle, glass: GlassMode) -> Settings {
    let updated = persist(&app, |settings| settings.glass = glass);
    if let Ok(path) = settings_path(&app) {
        let _ = write_settings(&path, &updated);
    }
    let _ = app.emit(SETTINGS_CHANGED, &updated);
    updated
}

/// Turns the pill status notification popup card on or off (off by default).
#[tauri::command]
pub fn set_status_popup(app: AppHandle, enabled: bool) -> Settings {
    let updated = persist_public(&app, |settings| settings.status_popup = enabled);
    let _ = app.emit(SETTINGS_CHANGED, &updated);
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
    if let Some(pill) = app.get_webview_window(crate::windows::PILL) {
        let _ = pill.show();
        let _ = pill.unminimize();
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

/// Applies a change and saves it, for modules outside this one.
///
/// `persist` alone only moves memory, and every command here pairs the
/// two by hand. A module that forgets the second half leaves a setting
/// that looks applied until the next launch, which is the worst of both
/// answers.
pub fn persist_public(app: &AppHandle, change: impl FnOnce(&mut Settings)) -> Settings {
    let updated = persist(app, change);
    if let Ok(path) = settings_path(app) {
        let _ = write_settings(&path, &updated);
    }
    updated
}

/// Turns the local transcript service on or off and remembers it.
///
/// The service is started or stopped first, so the saved setting is what
/// is actually true rather than what was asked for.
#[tauri::command]
pub fn set_transcript_service(app: AppHandle, enabled: bool) -> Settings {
    if enabled {
        crate::transcript_service::start();
    } else {
        crate::transcript_service::stop();
    }
    persist_public(&app, |settings| settings.transcript_service = enabled)
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
    fn language_count_matches_whisper_and_roundtrips_serde() {
        // 100 spoken languages supported by Whisper + auto-detect
        assert_eq!(Language::ALL.len(), 101);
        for language in Language::ALL {
            let json = serde_json::to_string(&language).unwrap();
            assert_eq!(json, format!("\"{}\"", language.code()));
            let parsed: Language = serde_json::from_str(&json).unwrap();
            assert_eq!(parsed, language);
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
            glass: GlassMode::Performance,
            transcript_service: true,
            status_popup: false,
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
    fn a_development_build_never_registers_itself_to_start() {
        // The tests run in a debug build, so this asserts the rule as it
        // applies to every test run: a build that would point a startup
        // entry at a file inside the project refuses to write one.
        assert!(!may_register_startup());
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
    fn live_glass_is_the_default_and_older_files_keep_it() {
        // Performance mode is an opt-out for weak machines, never the
        // first impression; a file written before the setting existed
        // loads with the live glass.
        assert_eq!(Settings::default().glass, GlassMode::Live);
        let path = std::env::temp_dir().join("whisperlane-settings-glass.json");
        std::fs::write(&path, r#"{"theme":"dark"}"#).unwrap();
        assert_eq!(read_settings(&path).glass, GlassMode::Live);
        std::fs::write(&path, r#"{"glass":"performance"}"#).unwrap();
        assert_eq!(read_settings(&path).glass, GlassMode::Performance);
        let _ = std::fs::remove_file(&path);
    }

    #[test]
    fn default_binding_is_the_approved_one() {
        assert_eq!(Settings::default().hotkey, Hotkey::CtrlShiftSpace);
        assert_eq!(Hotkey::default(), Hotkey::CtrlShiftSpace);
    }
}
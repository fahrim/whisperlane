// Learn more about Tauri commands at https://tauri.app/develop/calling-rust/
use tauri::{
    menu::{Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    Manager,
};

mod audio;
mod deliver;
mod hotkey;
mod pipeline;
mod settings;
mod stt;
pub mod stt_shared;

use audio::{list_input_devices, needs_microphone_choice, reset_pipeline};
use deliver::copy_last_text;
use hotkey::{get_hotkey_label, get_key_diag, list_hotkeys, DiagState};
use pipeline::{get_pipeline_state, PipelineState, PipelineStatus};
use settings::{
    get_settings, list_languages, load, set_hotkey, set_language, set_microphone, SettingsState,
};
use stt::{get_stt_status, sweep_idle, SttState};

#[tauri::command]
fn greet(name: &str) -> String {
    format!("Hello, {}! You've been greeted from Rust!", name)
}

fn build_tray(app: &tauri::AppHandle) -> tauri::Result<()> {
    let quit = MenuItem::with_id(app, "quit", "Quit whisperlane", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&quit])?;
    let icon = app
        .default_window_icon()
        .cloned()
        .expect("default window icon missing");
    TrayIconBuilder::with_id("main")
        .icon(icon)
        .tooltip("whisperlane")
        .menu(&menu)
        .on_menu_event(|app, event| {
            if event.id.as_ref() == "quit" {
                app.exit(0);
            }
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                let app = tray.app_handle();
                if let Some(window) = app.get_webview_window("main") {
                    let _ = window.show();
                    let _ = window.set_focus();
                }
            }
        })
        .build(app)?;
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        // Without Always, Tauri only accepts device events while a window
        // is focused, which starves our global keyboard hook whenever our
        // own window has focus (wry#1761). Always keeps the hook fed.
        .device_event_filter(tauri::DeviceEventFilter::Always)
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .manage(PipelineState(std::sync::Mutex::new(
            PipelineStatus::default(),
        )))
        .manage(SttState::default())
        .manage(DiagState::default())
        .invoke_handler(tauri::generate_handler![
            greet,
            get_pipeline_state,
            get_hotkey_label,
            reset_pipeline,
            get_stt_status,
            copy_last_text,
            get_key_diag,
            get_settings,
            set_language,
            set_hotkey,
            set_microphone,
            list_languages,
            list_hotkeys,
            list_input_devices,
            needs_microphone_choice
        ])
        .setup(|app| {
            // Settings need the resolved data dir, so they load here
            // rather than in the builder chain. The saved chord becomes
            // the active one before the hook is installed.
            let saved = load(app.handle());
            app.manage(SettingsState(std::sync::Mutex::new(saved.clone())));
            hotkey::apply_binding(saved.hotkey);
            build_tray(app.handle())?;
            let handle = app.handle().clone();
            std::thread::spawn(move || hotkey::run_listener(handle));
            let sweeper = app.handle().clone();
            std::thread::spawn(move || loop {
                std::thread::sleep(std::time::Duration::from_secs(30));
                sweep_idle(&sweeper);
            });
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

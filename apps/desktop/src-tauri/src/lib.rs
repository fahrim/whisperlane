// Learn more about Tauri commands at https://tauri.app/develop/calling-rust/
use tauri::Manager;

mod audio;
mod deliver;
mod hotkey;
mod insert;
mod models;
mod pipeline;
mod settings;
mod stt;
pub mod stt_shared;
mod tray;
mod windows;

use audio::{
    list_input_devices, needs_microphone_choice, reset_pipeline, take_control,
};
use deliver::copy_last_text;
use hotkey::{get_hotkey_label, list_hotkeys};
use models::{download_model, ensure_model_ready, get_download, list_models, ModelState};
use pipeline::{get_pipeline_state, PipelineState, PipelineStatus};
use settings::{
    complete_onboarding, get_settings, list_languages, load, set_hotkey, set_language,
    set_microphone, set_model, SettingsState,
};
use stt::{get_stt_status, sweep_idle, SttState};
use windows::{quit_app, set_pill_panel, toggle_settings};

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
        .manage(ModelState::default())
        .invoke_handler(tauri::generate_handler![
            get_pipeline_state,
            get_hotkey_label,
            reset_pipeline,
            get_stt_status,
            copy_last_text,
            get_settings,
            set_language,
            set_hotkey,
            set_microphone,
            list_languages,
            list_hotkeys,
            list_input_devices,
            needs_microphone_choice,
            list_models,
            get_download,
            download_model,
            set_model,
            ensure_model_ready,
            take_control,
            toggle_settings,
            set_pill_panel,
            quit_app,
            complete_onboarding
        ])
        // The settings window is the app's only settings surface, so it
        // has to survive its own close button. Destroyed here, the window
        // is gone for the rest of the run and every way back to settings
        // — the pill's control, the tray item — silently stops working.
        // Hiding keeps it addressable, and quitting is the tray's job.
        .on_window_event(|window, event| {
            let tauri::WindowEvent::CloseRequested { api, .. } = event else {
                return;
            };
            if window.label() != windows::MAIN {
                return;
            }
            api.prevent_close();
            let _ = window.hide();
        })
        .setup(|app| {
            // Settings need the resolved data dir, so they load here
            // rather than in the builder chain. The saved chord becomes
            // the active one before the hook is installed.
            let saved = load(app.handle());
            app.manage(SettingsState(std::sync::Mutex::new(saved.clone())));
            hotkey::apply_binding(saved.hotkey);
            tray::build(app.handle())?;
            windows::build_pill(app.handle())?;
            app.manage(windows::CursorPassthrough(Default::default()));
            app.manage(windows::PanelExpansion(Default::default()));
            windows::spawn_click_through(app.handle());
            
            // The take worker exists before the hook, so no chord edge
            // can arrive before there is a thread that owns the live
            // capture stream.
            audio::spawn_worker(app.handle().clone());
            let handle = app.handle().clone();
            std::thread::spawn(move || hotkey::run_listener(handle));
            // The backend is verified by launching once, never by
            // trusting the runtime directory's contents.
            stt::verify_backend(&app.handle().clone());
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

// Learn more about Tauri commands at https://tauri.app/develop/calling-rust/
use tauri::Manager;

mod audio;
mod deliver;
mod hotkey;
mod models;
mod pipeline;
mod settings;
mod stt;
pub mod stt_shared;
mod target;
mod tray;
mod windows;

use audio::{
    list_input_devices, needs_microphone_choice, reset_pipeline, set_mic_test, take_control,
};
use deliver::copy_last_text;
use hotkey::{get_hotkey_label, list_hotkeys};
use models::{download_model, ensure_model_ready, get_download, list_models, ModelState};
use pipeline::{get_pipeline_state, PipelineState, PipelineStatus};
use settings::{
    complete_onboarding, get_settings, is_start_with_windows, list_languages, list_themes, load,
    set_glass_mode, set_hotkey, set_language, set_microphone, set_model, set_start_with_windows,
    set_theme, SettingsState,
};
use stt::{get_stt_status, sweep_idle, SttState};
use windows::{
    begin_pill_drag, continue_pill_drag, end_pill_drag, fit_window, is_settings_visible,
    minimize_pill, quit_app, set_pill_blur_region, set_pill_panel, toggle_settings,
};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        // Without Always, Tauri only accepts device events while a window
        // is focused, which starves our global keyboard hook whenever our
        // own window has focus (wry#1761). Always keeps the hook fed.
        .device_event_filter(tauri::DeviceEventFilter::Always)
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        // Starts with Windows when the user has asked it to. The chord is
        // the product: a dictation tool that is not running cannot be
        // dictated to, and the user should not have to find it first.
        .plugin(tauri_plugin_autostart::Builder::new().build())
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
            set_mic_test,
            toggle_settings,
            is_settings_visible,
            set_pill_panel,
            set_pill_blur_region,
            begin_pill_drag,
            continue_pill_drag,
            end_pill_drag,
            quit_app,
            minimize_pill,
            complete_onboarding,
            fit_window,
            set_start_with_windows,
            is_start_with_windows,
            set_theme,
            set_glass_mode,
            list_themes
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
            windows::set_settings_visible(window.app_handle(), false);
        })
        .setup(|app| {
            // Settings need the resolved data dir, so they load here
            // rather than in the builder chain. The saved chord becomes
            // the active one before the hook is installed.
            let saved = load(app.handle());
            app.manage(SettingsState(std::sync::Mutex::new(saved.clone())));
            hotkey::apply_binding(saved.hotkey);

            // When onboarded, the settings window stays hidden at launch,
            // while the pill is built visible so the user immediately sees
            // Whisperlane is running in its idle / ready state.
            if saved.onboarded {
                windows::set_settings_visible(app.handle(), false);
            } else {
                windows::set_settings_visible(app.handle(), true);
            }

            tray::build(app.handle())?;
            windows::build_pill(app.handle())?;
            app.manage(windows::CursorPassthrough(Default::default()));
            app.manage(windows::PanelExpansion(Default::default()));
            app.manage(windows::PillDrag(Default::default()));
            windows::spawn_click_through(app.handle());

            // The engine is installed with the app and run from the data
            // directory, so it has to be put there before anything asks
            // what backend it has. Failure is not fatal here: the status
            // surface reports it, and a machine mid-update should still
            // open its window.
            if let Err(e) = stt::seed_runtime(app.handle()) {
                eprintln!("transcription runtime not installed: {e}");
            }

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

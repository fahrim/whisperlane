// Learn more about Tauri commands at https://tauri.app/develop/calling-rust/
use tauri::{
    menu::{Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    Manager,
};

mod audio;
mod hotkey;
mod pipeline;
mod stt;
pub mod stt_shared;

use audio::reset_pipeline;
use hotkey::get_hotkey_label;
use pipeline::{get_pipeline_state, PipelineState, PipelineStatus};
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
        .plugin(tauri_plugin_opener::init())
        .manage(PipelineState(std::sync::Mutex::new(
            PipelineStatus::default(),
        )))
        .manage(SttState::default())
        .invoke_handler(tauri::generate_handler![
            greet,
            get_pipeline_state,
            get_hotkey_label,
            reset_pipeline,
            get_stt_status
        ])
        .setup(|app| {
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

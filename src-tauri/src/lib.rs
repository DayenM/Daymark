mod commands;
mod db;
mod models;
mod scheduler;
mod startup;

use std::{
    io,
    sync::{mpsc, Arc, Mutex},
};

use commands::DbState;
use tauri::{
    menu::{Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    Emitter, Manager, RunEvent, WindowEvent,
};
use tauri_plugin_global_shortcut::ShortcutState;

pub fn run() {
    let (wake_sender, wake_receiver) = mpsc::channel();
    let setup_receiver = wake_receiver;
    let builder = tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(
            |app, args, _working_directory| {
                if args.iter().any(|argument| argument == "--quick-capture") {
                    scheduler::open_quick_capture(app);
                } else {
                    scheduler::show_today_widget(app);
                }
            },
        ))
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            commands::load_workspace,
            commands::open_main_window,
            commands::open_today_widget,
            commands::reset_today_widget_position,
            commands::create_task,
            commands::update_task,
            commands::set_task_done,
            commands::delete_task,
            commands::rollover_task,
            commands::rollover_tasks,
            commands::save_task_note,
            commands::set_theme,
            commands::set_font_family,
            commands::set_widget_transparency,
            commands::set_app_transparency,
            commands::set_auto_start,
            commands::acknowledge_briefing,
            commands::snooze_briefing,
            commands::create_project,
            commands::delete_project,
            commands::create_quick_note,
            commands::update_quick_note,
            commands::delete_quick_note,
            commands::export_backup,
            commands::import_backup
        ])
        .setup(move |app| {
            let database_path = app
                .path()
                .app_data_dir()
                .map_err(io::Error::other)?
                .join("workspace.sqlite3");
            let connection = db::open(&database_path).map_err(io::Error::other)?;
            let snapshot = db::load_workspace(&connection).map_err(io::Error::other)?;
            let state = DbState(Arc::new(Mutex::new(connection)));
            app.manage(state.clone());

            if let Err(error) = startup::reconcile(snapshot.auto_start) {
                eprintln!("Startup registration could not be reconciled: {error}");
            }
            install_tray(app)?;
            install_window_lifecycle(app);

            if let Err(error) = install_hotkey(app) {
                eprintln!("Quick Capture hotkey is unavailable: {error}");
            }

            if std::env::args().any(|argument| argument == "--quick-capture") {
                scheduler::open_quick_capture(app.handle());
            } else {
                scheduler::show_today_widget(app.handle());
            }
            scheduler::start(app.handle().clone(), state, setup_receiver);
            Ok(())
        });

    let app = builder
        .build(tauri::generate_context!())
        .expect("failed to initialize Daymark");
    app.run(move |_app, event| {
        if matches!(event, RunEvent::Resumed) {
            let _ = wake_sender.send(());
        }
    });
}

fn install_hotkey(app: &mut tauri::App) -> Result<(), String> {
    let shortcut = tauri_plugin_global_shortcut::Builder::new()
        .with_handler(|app, _shortcut, event| {
            if event.state == ShortcutState::Pressed {
                scheduler::open_quick_capture(app);
            }
        })
        .with_shortcuts(["ctrl+shift+y"])
        .map_err(|error| error.to_string())?;
    app.handle()
        .plugin(shortcut.build())
        .map_err(|error| error.to_string())
}

fn install_window_lifecycle(app: &mut tauri::App) {
    if let Some(window) = app.get_webview_window("today-widget") {
        let close_window = window.clone();
        window.on_window_event(move |event| {
            if let WindowEvent::CloseRequested { api, .. } = event {
                api.prevent_close();
                let _ = close_window.emit("window-close-requested", ());
            }
        });
    }
}

fn install_tray(app: &mut tauri::App) -> Result<(), Box<dyn std::error::Error>> {
    let widget = MenuItem::with_id(app, "today-widget", "Panel Hari Ini", true, None::<&str>)?;
    let capture = MenuItem::with_id(app, "capture", "Quick Capture", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", "Keluar", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&widget, &capture, &quit])?;
    let icon = app
        .default_window_icon()
        .cloned()
        .ok_or_else(|| io::Error::other("missing app icon"))?;

    TrayIconBuilder::new()
        .icon(icon)
        .menu(&menu)
        .tooltip("Daymark")
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id().as_ref() {
            "today-widget" => scheduler::show_today_widget(app),
            "capture" => scheduler::open_quick_capture(app),
            "quit" => app.exit(0),
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if matches!(
                event,
                TrayIconEvent::Click {
                    button: MouseButton::Left,
                    button_state: MouseButtonState::Up,
                    ..
                }
            ) {
                scheduler::show_today_widget(tray.app_handle());
            }
        })
        .build(app)?;
    Ok(())
}

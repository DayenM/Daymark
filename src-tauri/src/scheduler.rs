use std::{
    sync::{
        atomic::{AtomicBool, Ordering},
        mpsc::Receiver,
        Arc, Mutex,
    },
    thread,
    time::{Duration, SystemTime},
};

use rusqlite::Connection;
use tauri::{
    AppHandle, Emitter, LogicalSize, Manager, PhysicalPosition, WebviewWindow, WebviewWindowBuilder,
};
use tauri_plugin_notification::NotificationExt;

use crate::{commands::DbState, db};

// shortcut: placement lasts until Daymark exits; persist monitor-aware bounds if it must survive restarts.
static WIDGET_PLACED: AtomicBool = AtomicBool::new(false);
static MAIN_WINDOW_CREATION: Mutex<()> = Mutex::new(());

pub fn start(app: AppHandle, state: DbState, wake_receiver: Receiver<()>) {
    thread::Builder::new()
        .name("daymark-reminder-scheduler".into())
        .spawn(move || {
            let mut next_update_check = SystemTime::now() + Duration::from_secs(6 * 60 * 60);
            loop {
                deliver_due_reminders(&app, &state.0);
                present_daily_briefing(&app, &state.0);

                // shortcut: cap the idle wait at 60s to catch wake and clock changes;
                // use native power broadcasts if a tighter resume guarantee is required.
                match wake_receiver.recv_timeout(Duration::from_secs(60)) {
                    Ok(()) => {
                        let _ = app.emit_to("today-widget", "update-check-requested", ());
                        next_update_check = SystemTime::now() + Duration::from_secs(6 * 60 * 60);
                    }
                    Err(std::sync::mpsc::RecvTimeoutError::Timeout) => {
                        if SystemTime::now() >= next_update_check {
                            let _ = app.emit_to("today-widget", "update-check-requested", ());
                            next_update_check = SystemTime::now() + Duration::from_secs(6 * 60 * 60);
                        }
                    }
                    Err(std::sync::mpsc::RecvTimeoutError::Disconnected) => break,
                }
            }
        })
        .expect("could not start reminder scheduler");
}

fn deliver_due_reminders(app: &AppHandle, connection: &Arc<Mutex<Connection>>) {
    let reminders = {
        let guard = match connection.lock() {
            Ok(value) => value,
            Err(_) => return,
        };
        match db::due_reminders(&guard, &db::now_utc()) {
            Ok(value) => value,
            Err(error) => {
                eprintln!("Reminder query failed: {error}");
                return;
            }
        }
    };

    for (task_id, _, scheduled_for) in reminders {
        let Ok(guard) = connection.lock() else {
            continue;
        };
        let title = match db::current_due_reminder(&guard, &task_id, &scheduled_for) {
            Ok(Some(value)) => value,
            Ok(None) => continue,
            Err(error) => {
                eprintln!("Reminder recheck failed: {error}");
                continue;
            }
        };
        let result = app
            .notification()
            .builder()
            .title("Daymark · pengingat")
            .body(title)
            .show();
        let delivered = result.is_ok();
        let error = result.err().map(|value| value.to_string());
        if let Err(record_error) = db::record_reminder_attempt(
            &guard,
            &task_id,
            &scheduled_for,
            delivered,
            error.as_deref(),
        ) {
            eprintln!("Reminder log failed: {record_error}");
        }
    }
}

fn present_daily_briefing(app: &AppHandle, connection: &Arc<Mutex<Connection>>) {
    let should_present = match connection.lock() {
        Ok(guard) => match db::claim_daily_briefing(&guard) {
            Ok(value) => value,
            Err(error) => {
                eprintln!("Daily briefing check failed: {error}");
                return;
            }
        },
        Err(_) => return,
    };
    if !should_present {
        return;
    }
    show_today_widget(app);
    let _ = app.emit("briefing-needed", ());
}

pub fn show_main(app: &AppHandle) -> Result<(), String> {
    let _creation = MAIN_WINDOW_CREATION
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner);
    let widget = app.get_webview_window("today-widget");
    let result = (|| {
        let window = match app.get_webview_window("main") {
            Some(window) => window,
            None => {
                let config = app
                    .config()
                    .app
                    .windows
                    .iter()
                    .find(|config| config.label == "main")
                    .ok_or_else(|| "Konfigurasi jendela Daymark tidak tersedia.".to_owned())?;
                let window = WebviewWindowBuilder::from_config(app, config)
                    .and_then(|builder| builder.build())
                    .map_err(|error| format!("Jendela Daymark gagal dibuat: {error}"))?;
                let app_handle = app.clone();
                window.on_window_event(move |event| {
                    if matches!(event, tauri::WindowEvent::CloseRequested { .. }) {
                        show_today_widget(&app_handle);
                    }
                });
                window
            }
        };
        window.unminimize().map_err(|error| error.to_string())?;
        window.show().map_err(|error| error.to_string())?;
        if !window.is_visible().map_err(|error| error.to_string())? {
            return Err("Workspace Daymark belum terlihat setelah diminta dibuka.".to_owned());
        }
        let _ = window.set_focus();
        let state = app.state::<DbState>();
        if let Ok(connection) = state.0.lock() {
            if let Ok((theme, transparency)) = db::appearance_settings(&connection) {
                if transparency > 0 && theme != "neumorphic" {
                    crate::commands::sync_main_window_material(app, &theme, transparency);
                }
            }
        }
        Ok(())
    })();
    if result.is_err() {
        if let Some(window) = app.get_webview_window("main") {
            let _ = window.hide();
        }
        if let Some(widget) = widget {
            let _ = widget.show();
        }
    }
    result
}

pub fn show_today_widget(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("today-widget") {
        if !WIDGET_PLACED.swap(true, Ordering::Relaxed) {
            let dock = app
                .state::<DbState>()
                .0
                .lock()
                .ok()
                .and_then(|connection| db::island_dock(&connection).ok())
                .unwrap_or_else(|| ("top".into(), 0.5));
            let _ = place_island(&window, &dock.0, dock.1);
        }
        let _ = window.unminimize();
        let _ = window.show();
        let _ = window.set_focus();
    }
}

/// Sizes the collapsed island for its edge and glues it flush to that edge of the monitor it is on.
pub fn place_island(window: &WebviewWindow, edge: &str, ratio: f64) -> Result<(), String> {
    let monitor = match window.current_monitor().map_err(|error| error.to_string())? {
        Some(monitor) => monitor,
        None => window
            .primary_monitor()
            .map_err(|error| error.to_string())?
            .ok_or_else(|| "Monitor utama tidak tersedia.".to_owned())?,
    };
    // Notch 210×32 + 10px concave ears each side + room for its shadow; rotated on side edges.
    let (width, height) = if edge == "top" { (230.0, 40.0) } else { (40.0, 230.0) };
    window
        .set_min_size(Some(LogicalSize::new(30.0, 30.0)))
        .map_err(|error| error.to_string())?;
    window
        .set_size(LogicalSize::new(width, height))
        .map_err(|error| error.to_string())?;
    let scale = monitor.scale_factor();
    let (outer_w, outer_h) = ((width * scale).round() as i32, (height * scale).round() as i32);
    let origin = monitor.position();
    let size = monitor.size();
    let (screen_w, screen_h) = (size.width as i32, size.height as i32);
    let ratio = ratio.clamp(0.0, 1.0);
    let along_x = ((screen_w as f64 * ratio) as i32 - outer_w / 2).clamp(0, (screen_w - outer_w).max(0));
    let along_y = ((screen_h as f64 * ratio) as i32 - outer_h / 2).clamp(0, (screen_h - outer_h).max(0));
    let (x, y) = match edge {
        "left" => (origin.x, origin.y + along_y),
        "right" => (origin.x + screen_w - outer_w, origin.y + along_y),
        _ => (origin.x + along_x, origin.y),
    };
    window
        .set_position(PhysicalPosition::new(x, y))
        .map_err(|error| error.to_string())
}

pub fn open_quick_capture(app: &AppHandle) {
    // Open capture only where the user is: the workspace when it has focus, otherwise the panel.
    if let Some(main) = app.get_webview_window("main") {
        if main.is_focused().unwrap_or(false) {
            let _ = app.emit_to("main", "quick-capture", ());
            return;
        }
    }
    show_today_widget(app);
    let _ = app.emit_to("today-widget", "quick-capture", ());
}

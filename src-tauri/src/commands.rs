use std::{
    fs,
    io::Write,
    path::PathBuf,
    sync::{Arc, Mutex},
};

use rusqlite::Connection;
use tauri::{AppHandle, Manager, State};

use crate::{
    db,
    models::{BackupArchive, NewQuickNote, NewTask, QuickNote, Task, WorkspaceSnapshot},
};

#[derive(Clone)]
pub struct DbState(pub Arc<Mutex<Connection>>);

#[tauri::command]
pub async fn open_main_window(app: AppHandle) -> Result<(), String> {
    crate::scheduler::show_main(&app)
}

#[tauri::command]
pub fn open_today_widget(app: AppHandle) {
    crate::scheduler::show_today_widget(&app);
}

#[tauri::command]
pub fn reset_today_widget_position(app: AppHandle, state: State<'_, DbState>) -> Result<(), String> {
    let window = app
        .get_webview_window("today-widget")
        .ok_or_else(|| "Panel Daymark tidak tersedia.".to_owned())?;
    let (edge, ratio) = with_connection(&state, |connection| db::island_dock(connection))?;
    crate::scheduler::place_island(&window, &edge, ratio)
}

#[tauri::command]
pub fn get_island_dock(state: State<'_, DbState>) -> Result<(String, f64), String> {
    with_connection(&state, |connection| db::island_dock(connection))
}

#[tauri::command]
pub fn set_island_dock(
    app: AppHandle,
    state: State<'_, DbState>,
    edge: String,
    ratio: f64,
) -> Result<(), String> {
    with_connection(&state, |connection| db::set_island_dock(connection, &edge, ratio))?;
    reset_today_widget_position(app, state)
}

fn with_connection<T>(
    state: &DbState,
    action: impl FnOnce(&mut Connection) -> Result<T, String>,
) -> Result<T, String> {
    let mut connection = state
        .0
        .lock()
        .map_err(|_| "Database sedang tidak tersedia.".to_owned())?;
    action(&mut connection)
}

#[tauri::command]
pub fn load_workspace(state: State<'_, DbState>) -> Result<WorkspaceSnapshot, String> {
    with_connection(&state, |connection| db::load_workspace(connection))
}

#[tauri::command]
pub fn create_task(state: State<'_, DbState>, task: NewTask) -> Result<Task, String> {
    with_connection(&state, |connection| db::create_task(connection, task))
}

#[tauri::command]
pub fn update_task(state: State<'_, DbState>, id: String, task: NewTask) -> Result<(), String> {
    with_connection(&state, |connection| db::update_task(connection, &id, task))
}

#[tauri::command]
pub fn set_task_done(state: State<'_, DbState>, id: String, done: bool) -> Result<(), String> {
    with_connection(&state, |connection| {
        db::set_task_done(connection, &id, done)
    })
}

#[tauri::command]
pub fn delete_task(state: State<'_, DbState>, id: String) -> Result<(), String> {
    with_connection(&state, |connection| db::delete_task(connection, &id))
}

#[tauri::command]
pub fn rollover_task(state: State<'_, DbState>, id: String) -> Result<(), String> {
    with_connection(&state, |connection| db::rollover_task(connection, &id))
}

#[tauri::command]
pub fn rollover_tasks(state: State<'_, DbState>, ids: Vec<String>) -> Result<usize, String> {
    with_connection(&state, |connection| db::rollover_tasks(connection, &ids))
}

#[tauri::command]
pub fn save_task_note(
    state: State<'_, DbState>,
    id: String,
    markdown: String,
) -> Result<(), String> {
    with_connection(&state, |connection| {
        db::save_task_note(connection, &id, &markdown)
    })
}

#[tauri::command]
pub fn set_theme(app: AppHandle, state: State<'_, DbState>, theme: String) -> Result<(), String> {
    let (theme, transparency) = with_connection(&state, |connection| {
        db::set_theme(connection, &theme)?;
        db::appearance_settings(connection)
    })?;
    sync_main_window_material(&app, &theme, transparency);
    Ok(())
}

#[tauri::command]
pub fn set_font_family(state: State<'_, DbState>, font_family: String) -> Result<(), String> {
    with_connection(&state, |connection| db::set_font_family(connection, &font_family))
}

#[tauri::command]
pub fn set_widget_transparency(
    state: State<'_, DbState>,
    percent: u8,
) -> Result<(), String> {
    with_connection(&state, |connection| {
        db::set_widget_transparency(connection, percent)
    })
}

#[tauri::command]
pub fn set_app_transparency(
    app: AppHandle,
    state: State<'_, DbState>,
    percent: u8,
) -> Result<(), String> {
    let (theme, transparency) = with_connection(&state, |connection| {
        db::set_app_transparency(connection, percent)?;
        db::appearance_settings(connection)
    })?;
    sync_main_window_material(&app, &theme, transparency);
    Ok(())
}

pub fn sync_main_window_material(app: &AppHandle, theme: &str, transparency: u8) {
    #[cfg(target_os = "windows")]
    if let Some(window) = app.get_webview_window("main") {
        use tauri::window::{Color, Effect, EffectsBuilder};

        // shortcut: Acrylic can lag while dragging/resizing; keep it opt-in and use the CSS glass fallback at 0%.
        let effects = (transparency > 0 && theme != "neumorphic").then(|| {
            EffectsBuilder::new()
                .effect(Effect::Acrylic)
                // Tint = the theme's base colour, so Acrylic matches the CSS surface.
                .color(match theme {
                    "glass_light" => Color(245, 245, 247, 150),
                    "sakura_milk" => Color(255, 246, 248, 150),
                    "peach_matcha" => Color(255, 247, 239, 150),
                    "cherry_cola" => Color(28, 7, 13, 150),
                    "midnight_ocean" => Color(6, 16, 30, 150),
                    _ => Color(10, 10, 11, 150),
                })
                .build()
        });
        if let Err(error) = window.set_effects(effects) {
            eprintln!("Windows glass backdrop could not be updated: {error}");
        }
    }

    #[cfg(not(target_os = "windows"))]
    let _ = (app, theme, transparency);
}

#[tauri::command]
pub fn set_auto_start(state: State<'_, DbState>, enabled: bool) -> Result<(), String> {
    let previous = with_connection(&state, |connection| {
        Ok(db::load_workspace(connection)?.auto_start)
    })?;
    crate::startup::set_enabled(enabled)?;
    if let Err(error) = with_connection(&state, |connection| {
        db::set_auto_start_preference(connection, enabled)
    }) {
        let _ = crate::startup::set_enabled(previous);
        return Err(error);
    }
    Ok(())
}

#[tauri::command]
pub fn acknowledge_briefing(state: State<'_, DbState>) -> Result<(), String> {
    with_connection(&state, |connection| db::acknowledge_briefing(connection))
}

#[tauri::command]
pub fn snooze_briefing(state: State<'_, DbState>) -> Result<(), String> {
    with_connection(&state, |connection| db::snooze_briefing(connection))
}

#[tauri::command]
pub fn create_project(
    state: State<'_, DbState>,
    name: String,
) -> Result<crate::models::Project, String> {
    with_connection(&state, |connection| db::create_project(connection, &name))
}

#[tauri::command]
pub fn delete_project(state: State<'_, DbState>, id: String) -> Result<(), String> {
    with_connection(&state, |connection| db::delete_project(connection, &id))
}

#[tauri::command]
pub fn create_quick_note(state: State<'_, DbState>, note: NewQuickNote) -> Result<(), String> {
    with_connection(&state, |connection| db::create_quick_note(connection, note))
}

#[tauri::command]
pub fn update_quick_note(state: State<'_, DbState>, note: QuickNote) -> Result<(), String> {
    with_connection(&state, |connection| db::update_quick_note(connection, note))
}

#[tauri::command]
pub fn delete_quick_note(state: State<'_, DbState>, id: String) -> Result<(), String> {
    with_connection(&state, |connection| db::delete_quick_note(connection, &id))
}

#[tauri::command]
pub fn export_backup(state: State<'_, DbState>, path: String) -> Result<(), String> {
    let destination = json_path(path)?;
    let archive = with_connection(&state, |connection| db::export_archive(connection))?;
    let bytes = serde_json::to_vec_pretty(&archive).map_err(|error| error.to_string())?;
    if bytes.len() > 50 * 1024 * 1024 {
        return Err("Backup melebihi batas ekspor 50 MB.".into());
    }
    let parent = destination
        .parent()
        .ok_or_else(|| "Folder tujuan backup tidak valid.".to_owned())?;
    let temporary = parent.join(format!(".daymark-{}.tmp", uuid::Uuid::new_v4()));
    let write_result = (|| {
        let mut file = fs::File::create(&temporary).map_err(|error| error.to_string())?;
        file.write_all(&bytes).map_err(|error| error.to_string())?;
        file.sync_all().map_err(|error| error.to_string())?;
        fs::rename(&temporary, &destination).map_err(|error| error.to_string())
    })();
    if write_result.is_err() {
        let _ = fs::remove_file(&temporary);
    }
    write_result
}

#[tauri::command]
pub fn import_backup(state: State<'_, DbState>, path: String) -> Result<usize, String> {
    let source = json_path(path)?;
    let metadata = fs::metadata(&source).map_err(|error| error.to_string())?;
    if metadata.len() > 50 * 1024 * 1024 {
        return Err("File backup melebihi batas impor 50 MB.".into());
    }
    let bytes = fs::read(source).map_err(|error| error.to_string())?;
    let archive: BackupArchive =
        serde_json::from_slice(&bytes).map_err(|error| error.to_string())?;
    with_connection(&state, |connection| db::import_archive(connection, archive))
}

fn json_path(path: String) -> Result<PathBuf, String> {
    let path = PathBuf::from(path);
    if path
        .extension()
        .and_then(|value| value.to_str())
        .is_none_or(|value| !value.eq_ignore_ascii_case("json"))
    {
        return Err("Pilih file dengan ekstensi .json.".into());
    }
    Ok(path)
}

use std::{collections::HashMap, fs, path::Path, time::Duration as StdDuration};

use chrono::{DateTime, Datelike, Duration, Local, LocalResult, Months, NaiveDate, TimeZone, Utc};
use rusqlite::{params, Connection, OptionalExtension, Transaction};
use uuid::Uuid;

use crate::models::{
    BackupArchive, NewQuickNote, NewTask, Project, QuickNote, RecurrenceRule, Task,
    WorkspaceSnapshot,
};

const INITIAL_MIGRATION: &str = include_str!("../migrations/0001_initial.sql");

pub fn open(path: &Path) -> Result<Connection, String> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    }

    let connection = Connection::open(path).map_err(|error| error.to_string())?;
    connection
        .busy_timeout(StdDuration::from_secs(5))
        .map_err(|error| error.to_string())?;
    connection
        .execute_batch(
            "PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL;",
        )
        .map_err(|error| error.to_string())?;
    connection
        .execute_batch("CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL);")
        .map_err(|error| error.to_string())?;

    let applied: bool = connection
        .query_row(
            "SELECT EXISTS(SELECT 1 FROM schema_migrations WHERE version = 1)",
            [],
            |row| row.get(0),
        )
        .map_err(|error| error.to_string())?;
    if !applied {
        let transaction = connection
            .unchecked_transaction()
            .map_err(|error| error.to_string())?;
        transaction
            .execute_batch(INITIAL_MIGRATION)
            .map_err(|error| error.to_string())?;
        transaction
            .execute(
                "INSERT INTO schema_migrations(version, applied_at) VALUES (1, ?1)",
                [now_utc()],
            )
            .map_err(|error| error.to_string())?;
        transaction.commit().map_err(|error| error.to_string())?;
    }

    ensure_setting(&connection, "theme", "glass_dark")?;
    ensure_setting(&connection, "font_family", "segoe-ui")?;
    ensure_setting(&connection, "widget_transparency", "0")?;
    ensure_setting(&connection, "app_transparency", "0")?;
    ensure_setting(
        &connection,
        "auto_start_enabled",
        if cfg!(debug_assertions) {
            "false"
        } else {
            "true"
        },
    )?;
    Ok(connection)
}

pub fn load_workspace(connection: &Connection) -> Result<WorkspaceSnapshot, String> {
    let local_date = Local::now().date_naive().to_string();
    let theme = setting(connection, "theme")?.unwrap_or_else(|| "glass_dark".into());
    let font_family = setting(connection, "font_family")?
        .filter(|font| valid_font_family(font))
        .unwrap_or_else(|| "segoe-ui".into());
    let widget_transparency = setting(connection, "widget_transparency")?
        .and_then(|value| value.parse::<u8>().ok())
        .filter(|percent| *percent <= 40)
        .unwrap_or(0);
    let app_transparency = setting(connection, "app_transparency")?
        .and_then(|value| value.parse::<u8>().ok())
        .filter(|percent| *percent <= 40)
        .unwrap_or(0);
    let auto_start = setting(connection, "auto_start_enabled")?
        .as_deref()
        .map(|value| value == "true")
        .unwrap_or(true);
    let briefing_acknowledged = connection
        .query_row(
            "SELECT acknowledged_at IS NOT NULL FROM daily_briefing_state WHERE local_date = ?1",
            [&local_date],
            |row| row.get(0),
        )
        .optional()
        .map_err(|error| error.to_string())?
        .unwrap_or(false);

    Ok(WorkspaceSnapshot {
        tasks: list_tasks(connection)?,
        projects: list_projects(connection)?,
        quick_notes: list_quick_notes(connection)?,
        theme,
        font_family,
        widget_transparency,
        app_transparency,
        auto_start,
        briefing_acknowledged,
        local_date,
    })
}

pub fn list_tasks(connection: &Connection) -> Result<Vec<Task>, String> {
    let mut statement = connection
        .prepare(
            "SELECT t.id, t.series_id, t.title, t.status, t.priority, t.due_at, t.remind_at,
                    t.reminder_offset_minutes, t.recurrence_rule, t.rollover_count,
                    t.parent_id, t.project_id, t.sort_order, COALESCE(n.markdown, ''),
                    t.created_at, t.updated_at, t.completed_at
             FROM tasks t LEFT JOIN task_notes n ON n.task_id = t.id
             ORDER BY CASE t.status WHEN 'open' THEN 0 ELSE 1 END,
                      CASE t.priority WHEN 'urgent' THEN 0 WHEN 'high' THEN 1
                           WHEN 'normal' THEN 2 ELSE 3 END,
                      t.due_at IS NULL, t.due_at, t.sort_order, t.created_at",
        )
        .map_err(|error| error.to_string())?;
    let rows = statement
        .query_map([], |row| {
            Ok(Task {
                id: row.get(0)?,
                series_id: row.get(1)?,
                title: row.get(2)?,
                status: row.get(3)?,
                priority: row.get(4)?,
                due_at: row.get(5)?,
                remind_at: row.get(6)?,
                reminder_offset_minutes: row.get(7)?,
                recurrence_rule: row.get(8)?,
                rollover_count: row.get(9)?,
                parent_id: row.get(10)?,
                project_id: row.get(11)?,
                sort_order: row.get(12)?,
                notes: row.get(13)?,
                tags: Vec::new(),
                created_at: row.get(14)?,
                updated_at: row.get(15)?,
                completed_at: row.get(16)?,
            })
        })
        .map_err(|error| error.to_string())?;
    let mut tasks = rows
        .collect::<Result<Vec<_>, _>>()
        .map_err(|error| error.to_string())?;

    let mut tags_by_task: HashMap<String, Vec<String>> = HashMap::new();
    let mut tag_statement = connection
        .prepare(
            "SELECT tt.task_id, tag.name FROM task_tags tt
             JOIN tags tag ON tag.id = tt.tag_id ORDER BY tag.name COLLATE NOCASE",
        )
        .map_err(|error| error.to_string())?;
    let tag_rows = tag_statement
        .query_map([], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
        })
        .map_err(|error| error.to_string())?;
    for tag_row in tag_rows {
        let (task_id, tag) = tag_row.map_err(|error| error.to_string())?;
        tags_by_task.entry(task_id).or_default().push(tag);
    }
    for task in &mut tasks {
        task.tags = tags_by_task.remove(&task.id).unwrap_or_default();
    }
    Ok(tasks)
}

pub fn create_task(connection: &mut Connection, mut input: NewTask) -> Result<Task, String> {
    input.title = input.title.trim().to_owned();
    if input.title.is_empty() || input.title.chars().count() > 240 {
        return Err("Judul tugas harus berisi 1–240 karakter.".into());
    }
    if input
        .notes
        .as_deref()
        .is_some_and(|notes| notes.chars().count() > 100_000)
    {
        return Err("Catatan tugas maksimal 100.000 karakter.".into());
    }
    if !matches!(
        input.priority.as_str(),
        "low" | "normal" | "high" | "urgent"
    ) {
        return Err("Prioritas tugas tidak valid.".into());
    }
    if input.parent_id.is_some() && input.recurrence_rule.is_some() {
        return Err("Subtugas berulang belum didukung.".into());
    }
    normalize_tags(&mut input.tags)?;
    if let Some(parent_id) = input.parent_id.as_deref() {
        let parent = connection
            .query_row(
                "SELECT parent_id, recurrence_rule FROM tasks WHERE id = ?1",
                [parent_id],
                |row| {
                    Ok((
                        row.get::<_, Option<String>>(0)?,
                        row.get::<_, Option<String>>(1)?,
                    ))
                },
            )
            .optional()
            .map_err(|error| error.to_string())?;
        let Some((parent_parent_id, parent_recurrence)) = parent else {
            return Err("Tugas induk tidak ditemukan.".into());
        };
        if parent_parent_id.is_some() || parent_recurrence.is_some() {
            return Err(
                "Subtugas hanya didukung satu tingkat dan tidak pada tugas berulang.".into(),
            );
        }
    }

    let due_at = input.due_at.as_deref().map(normalize_time).transpose()?;
    let reminder_offset = input.reminder_offset_minutes;
    if let Some(offset) = reminder_offset {
        if !(0..=10_080).contains(&offset) {
            return Err("Pengingat harus berada antara 0 dan 10.080 menit.".into());
        }
        if due_at.is_none() {
            return Err("Atur tanggal tugas sebelum mengaktifkan pengingat.".into());
        }
    }
    if let Some(rule) = input.recurrence_rule.as_mut() {
        validate_recurrence(rule, due_at.as_deref())?;
    }
    let recurrence_json = input
        .recurrence_rule
        .as_ref()
        .map(serde_json::to_string)
        .transpose()
        .map_err(|error| error.to_string())?;
    let remind_at = reminder_time(due_at.as_deref(), reminder_offset)?;
    let id = Uuid::new_v4().to_string();
    let series_id = input.recurrence_rule.as_ref().map(|_| id.clone());
    let now = now_utc();

    let transaction = connection
        .transaction()
        .map_err(|error| error.to_string())?;
    transaction
        .execute(
            "INSERT INTO tasks (id, series_id, title, priority, due_at, remind_at,
                 reminder_offset_minutes, recurrence_rule, parent_id, project_id,
                 created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?11)",
            params![
                id,
                series_id,
                input.title,
                input.priority,
                due_at,
                remind_at,
                reminder_offset,
                recurrence_json,
                input.parent_id,
                input.project_id,
                now
            ],
        )
        .map_err(|error| error.to_string())?;
    if let Some(notes) = input.notes.as_deref().filter(|notes| !notes.is_empty()) {
        transaction
            .execute(
                "INSERT INTO task_notes(task_id, markdown, updated_at) VALUES (?1, ?2, ?3)",
                params![id, notes, now],
            )
            .map_err(|error| error.to_string())?;
    }
    replace_tags(&transaction, &id, &input.tags)?;
    transaction.commit().map_err(|error| error.to_string())?;
    find_task(connection, &id)
}

pub fn update_task(connection: &Connection, id: &str, mut input: NewTask) -> Result<(), String> {
    input.title = input.title.trim().to_owned();
    if input.title.is_empty() || input.title.chars().count() > 240 {
        return Err("Judul tugas harus berisi 1–240 karakter.".into());
    }
    if !matches!(
        input.priority.as_str(),
        "low" | "normal" | "high" | "urgent"
    ) {
        return Err("Prioritas tugas tidak valid.".into());
    }
    if input.parent_id.as_deref() == Some(id) {
        return Err("Tugas tidak dapat menjadi subtugasnya sendiri.".into());
    }
    normalize_tags(&mut input.tags)?;
    if input.parent_id.is_some() {
        let has_children: bool = connection
            .query_row(
                "SELECT EXISTS(SELECT 1 FROM tasks WHERE parent_id = ?1)",
                [id],
                |row| row.get(0),
            )
            .map_err(|error| error.to_string())?;
        if has_children {
            return Err(
                "Tugas yang memiliki subtugas tidak dapat dipindahkan sebagai subtugas.".into(),
            );
        }
    }
    if let Some(parent_id) = input.parent_id.as_deref() {
        let parent = connection
            .query_row(
                "SELECT parent_id, recurrence_rule FROM tasks WHERE id = ?1",
                [parent_id],
                |row| {
                    Ok((
                        row.get::<_, Option<String>>(0)?,
                        row.get::<_, Option<String>>(1)?,
                    ))
                },
            )
            .optional()
            .map_err(|error| error.to_string())?;
        let Some((parent_parent_id, parent_recurrence)) = parent else {
            return Err("Tugas induk tidak ditemukan.".into());
        };
        if parent_parent_id.is_some() || parent_recurrence.is_some() {
            return Err(
                "Subtugas hanya didukung satu tingkat dan tidak pada tugas berulang.".into(),
            );
        }
    }
    let due_at = input.due_at.as_deref().map(normalize_time).transpose()?;
    let reminder_offset = input.reminder_offset_minutes;
    if let Some(offset) = reminder_offset {
        if !(0..=10_080).contains(&offset) || due_at.is_none() {
            return Err("Pengingat memerlukan tanggal dan offset maksimal 10.080 menit.".into());
        }
    }
    if let Some(rule) = input.recurrence_rule.as_mut() {
        validate_recurrence(rule, due_at.as_deref())?;
        let has_children: bool = connection
            .query_row(
                "SELECT EXISTS(SELECT 1 FROM tasks WHERE parent_id = ?1)",
                [id],
                |row| row.get(0),
            )
            .map_err(|error| error.to_string())?;
        if has_children || input.parent_id.is_some() {
            return Err("Tugas dengan subtugas tidak dapat diulang.".into());
        }
    }
    let recurrence_json = input
        .recurrence_rule
        .as_ref()
        .map(serde_json::to_string)
        .transpose()
        .map_err(|error| error.to_string())?;
    let remind_at = reminder_time(due_at.as_deref(), reminder_offset)?;
    let now = now_utc();
    let transaction = connection
        .unchecked_transaction()
        .map_err(|error| error.to_string())?;
    let changed = transaction
        .execute(
            "UPDATE tasks SET title = ?1, priority = ?2, due_at = ?3, remind_at = ?4,
                 reminder_offset_minutes = ?5, recurrence_rule = ?6, parent_id = ?7,
                 project_id = ?8, updated_at = ?9, notified_at = NULL,
                 series_id = CASE WHEN ?6 IS NOT NULL AND series_id IS NULL THEN id ELSE series_id END
             WHERE id = ?10",
            params![
                input.title,
                input.priority,
                due_at,
                remind_at,
                reminder_offset,
                recurrence_json,
                input.parent_id,
                input.project_id,
                now,
                id
            ],
        )
        .map_err(|error| error.to_string())?;
    if changed == 0 {
        return Err("Tugas tidak ditemukan.".into());
    }
    transaction
        .execute("DELETE FROM task_tags WHERE task_id = ?1", [id])
        .map_err(|error| error.to_string())?;
    replace_tags(&transaction, id, &input.tags)?;
    transaction.commit().map_err(|error| error.to_string())
}

pub fn delete_task(connection: &Connection, id: &str) -> Result<(), String> {
    let deleted = connection
        .execute("DELETE FROM tasks WHERE id = ?1", [id])
        .map_err(|error| error.to_string())?;
    if deleted == 0 {
        return Err("Tugas tidak ditemukan.".into());
    }
    Ok(())
}

pub fn set_task_done(connection: &mut Connection, id: &str, done: bool) -> Result<(), String> {
    let transaction = connection
        .transaction()
        .map_err(|error| error.to_string())?;
    let row = transaction
        .query_row(
            "SELECT title, priority, due_at, reminder_offset_minutes, recurrence_rule,
                    project_id, series_id, parent_id, status
             FROM tasks WHERE id = ?1",
            [id],
            |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, Option<String>>(2)?,
                    row.get::<_, Option<i64>>(3)?,
                    row.get::<_, Option<String>>(4)?,
                    row.get::<_, Option<String>>(5)?,
                    row.get::<_, Option<String>>(6)?,
                    row.get::<_, Option<String>>(7)?,
                    row.get::<_, String>(8)?,
                ))
            },
        )
        .optional()
        .map_err(|error| error.to_string())?
        .ok_or_else(|| "Tugas tidak ditemukan.".to_owned())?;

    if done && row.8 == "open" {
        let now = now_utc();
        transaction
            .execute(
                "UPDATE tasks SET status = 'done', completed_at = ?1, updated_at = ?1
                 WHERE id = ?2",
                params![now, id],
            )
            .map_err(|error| error.to_string())?;

        if let (Some(due_at), Some(rule_json)) = (row.2.as_deref(), row.4.as_deref()) {
            let rule: RecurrenceRule =
                serde_json::from_str(rule_json).map_err(|error| error.to_string())?;
            let next_due = next_due_after(due_at, &rule)?;
            let next_id = Uuid::new_v4().to_string();
            let series_id = row.6.clone().or_else(|| Some(id.to_owned()));
            let next_reminder = reminder_time(Some(&next_due), row.3)?;
            transaction
                .execute(
                    "INSERT INTO tasks (id, series_id, title, status, priority, due_at,
                         remind_at, reminder_offset_minutes, recurrence_rule, project_id,
                         sort_order, created_at, updated_at)
                     SELECT ?1, ?2, ?3, 'open', ?4, ?5, ?6, ?7, ?8, ?9, sort_order, ?10, ?10
                     FROM tasks WHERE id = ?11",
                    params![
                        next_id,
                        series_id,
                        row.0,
                        row.1,
                        next_due,
                        next_reminder,
                        row.3,
                        rule_json,
                        row.5,
                        now,
                        id
                    ],
                )
                .map_err(|error| error.to_string())?;
            transaction
                .execute(
                    "INSERT INTO task_notes(task_id, markdown, updated_at)
                     SELECT ?1, markdown, ?2 FROM task_notes WHERE task_id = ?3",
                    params![next_id, now, id],
                )
                .map_err(|error| error.to_string())?;
            transaction
                .execute(
                    "INSERT INTO task_tags(task_id, tag_id)
                     SELECT ?1, tag_id FROM task_tags WHERE task_id = ?2",
                    params![next_id, id],
                )
                .map_err(|error| error.to_string())?;
        }
    } else if !done && row.8 == "done" {
        transaction
            .execute(
                "UPDATE tasks SET status = 'open', completed_at = NULL, updated_at = ?1,
                     notified_at = NULL WHERE id = ?2",
                params![now_utc(), id],
            )
            .map_err(|error| error.to_string())?;
    }

    transaction.commit().map_err(|error| error.to_string())
}

pub fn rollover_task(connection: &Connection, id: &str) -> Result<(), String> {
    let task = connection
        .query_row(
            "SELECT due_at, reminder_offset_minutes FROM tasks WHERE id = ?1 AND status = 'open'",
            [id],
            |row| {
                Ok((
                    row.get::<_, Option<String>>(0)?,
                    row.get::<_, Option<i64>>(1)?,
                ))
            },
        )
        .optional()
        .map_err(|error| error.to_string())?
        .ok_or_else(|| "Tugas aktif tidak ditemukan.".to_owned())?;
    let due_at = task
        .0
        .ok_or_else(|| "Tugas ini tidak memiliki jadwal.".to_owned())?;
    let local_due = DateTime::parse_from_rfc3339(&due_at)
        .map_err(|error| error.to_string())?
        .with_timezone(&Local);
    let today = Local::now().date_naive();
    if local_due.date_naive() >= today {
        return Err("Hanya tugas dari hari sebelumnya yang dapat dipindahkan.".into());
    }
    let local_target = resolve_local(today.and_time(local_due.time()))?;
    let next_due = local_target
        .with_timezone(&Utc)
        .to_rfc3339_opts(chrono::SecondsFormat::Millis, true);
    let next_reminder = reminder_time(Some(&next_due), task.1)?;
    connection
        .execute(
            "UPDATE tasks SET due_at = ?1, remind_at = ?2, notified_at = NULL,
                 rollover_count = rollover_count + 1, updated_at = ?3
             WHERE id = ?4 AND status = 'open'",
            params![next_due, next_reminder, now_utc(), id],
        )
        .map_err(|error| error.to_string())?;
    Ok(())
}

pub fn rollover_tasks(connection: &Connection, ids: &[String]) -> Result<usize, String> {
    let transaction = connection
        .unchecked_transaction()
        .map_err(|error| error.to_string())?;
    let mut seen = std::collections::HashSet::new();
    for id in ids.iter().filter(|id| seen.insert(id.as_str())) {
        rollover_task(&transaction, id)?;
    }
    transaction.commit().map_err(|error| error.to_string())?;
    Ok(seen.len())
}

pub fn save_task_note(connection: &Connection, id: &str, markdown: &str) -> Result<(), String> {
    if markdown.chars().count() > 100_000 {
        return Err("Catatan tugas maksimal 100.000 karakter.".into());
    }
    let now = now_utc();
    connection
        .execute(
            "INSERT INTO task_notes(task_id, markdown, updated_at) VALUES (?1, ?2, ?3)
             ON CONFLICT(task_id) DO UPDATE SET markdown = excluded.markdown,
                 updated_at = excluded.updated_at",
            params![id, markdown, now],
        )
        .map_err(|error| error.to_string())?;
    connection
        .execute(
            "UPDATE tasks SET updated_at = ?1 WHERE id = ?2",
            params![now, id],
        )
        .map_err(|error| error.to_string())?;
    Ok(())
}

pub fn set_theme(connection: &Connection, theme: &str) -> Result<(), String> {
    if !matches!(
        theme,
        "glass_light"
            | "glass_dark"
            | "neumorphic"
            | "sakura_milk"
            | "peach_matcha"
            | "cherry_cola"
            | "midnight_ocean"
    ) {
        return Err("Tema tidak dikenal.".into());
    }
    upsert_setting(connection, "theme", theme)
}

pub fn set_font_family(connection: &Connection, font: &str) -> Result<(), String> {
    if !valid_font_family(font) {
        return Err("Font Daymark tidak dikenal.".into());
    }
    upsert_setting(connection, "font_family", font)
}

pub fn appearance_settings(connection: &Connection) -> Result<(String, u8), String> {
    let theme = setting(connection, "theme")?.unwrap_or_else(|| "glass_dark".into());
    let transparency = setting(connection, "app_transparency")?
        .and_then(|value| value.parse::<u8>().ok())
        .filter(|percent| *percent <= 40)
        .unwrap_or(0);
    Ok((theme, transparency))
}

fn valid_font_family(font: &str) -> bool {
    matches!(font, "plus-jakarta-sans" | "geist" | "inter" | "atkinson-hyperlegible-next" | "segoe-ui" | "aptos" | "arial")
}

/// Where the collapsed island sits: an edge (top/left/right) and the island centre along it (0..=1).
pub fn island_dock(connection: &Connection) -> Result<(String, f64), String> {
    let saved = setting(connection, "island_dock")?.unwrap_or_default();
    Ok(parse_island_dock(&saved).unwrap_or_else(|| ("top".into(), 0.5)))
}

pub fn set_island_dock(connection: &Connection, edge: &str, ratio: f64) -> Result<(), String> {
    let value = format!("{edge}:{ratio:.4}");
    if parse_island_dock(&value).is_none() {
        return Err("Posisi Dynamic Island tidak valid.".into());
    }
    upsert_setting(connection, "island_dock", &value)
}

fn parse_island_dock(value: &str) -> Option<(String, f64)> {
    let (edge, ratio) = value.split_once(':')?;
    let ratio: f64 = ratio.parse().ok()?;
    (matches!(edge, "top" | "left" | "right") && (0.0..=1.0).contains(&ratio))
        .then(|| (edge.to_owned(), ratio))
}

pub fn set_widget_transparency(connection: &Connection, percent: u8) -> Result<(), String> {
    if percent > 40 {
        return Err("Transparansi panel harus berada di antara 0 dan 40 persen.".into());
    }
    upsert_setting(connection, "widget_transparency", &percent.to_string())
}

pub fn set_app_transparency(connection: &Connection, percent: u8) -> Result<(), String> {
    if percent > 40 {
        return Err("Transparansi Daymark harus berada di antara 0 dan 40 persen.".into());
    }
    upsert_setting(connection, "app_transparency", &percent.to_string())
}

pub fn set_auto_start_preference(connection: &Connection, enabled: bool) -> Result<(), String> {
    upsert_setting(
        connection,
        "auto_start_enabled",
        if enabled { "true" } else { "false" },
    )
}

pub fn acknowledge_briefing(connection: &Connection) -> Result<(), String> {
    let date = Local::now().date_naive().to_string();
    connection
        .execute(
            "INSERT INTO daily_briefing_state(local_date, acknowledged_at)
             VALUES (?1, ?2)
             ON CONFLICT(local_date) DO UPDATE SET acknowledged_at = excluded.acknowledged_at",
            params![date, now_utc()],
        )
        .map_err(|error| error.to_string())?;
    Ok(())
}

pub fn snooze_briefing(connection: &Connection) -> Result<(), String> {
    let local_now = Local::now();
    let date = local_now.date_naive().to_string();
    let snoozed_until = (local_now + Duration::minutes(15))
        .with_timezone(&Utc)
        .to_rfc3339_opts(chrono::SecondsFormat::Millis, true);
    connection
        .execute(
            "INSERT INTO daily_briefing_state(local_date, presented_at, snoozed_until)
             VALUES (?1, ?2, ?3)
             ON CONFLICT(local_date) DO UPDATE SET snoozed_until = excluded.snoozed_until",
            params![date, now_utc(), snoozed_until],
        )
        .map_err(|error| error.to_string())?;
    Ok(())
}

pub fn claim_daily_briefing(connection: &Connection) -> Result<bool, String> {
    let date = Local::now().date_naive().to_string();
    let now = now_utc();
    let transaction = connection
        .unchecked_transaction()
        .map_err(|error| error.to_string())?;
    transaction
        .execute(
            "INSERT OR IGNORE INTO daily_briefing_state(local_date) VALUES (?1)",
            [&date],
        )
        .map_err(|error| error.to_string())?;
    let should_present: bool = transaction
        .query_row(
            "SELECT acknowledged_at IS NULL AND
                    (presented_at IS NULL OR (snoozed_until IS NOT NULL AND snoozed_until <= ?2))
             FROM daily_briefing_state WHERE local_date = ?1",
            params![date, now],
            |row| row.get(0),
        )
        .map_err(|error| error.to_string())?;
    if should_present {
        transaction
            .execute(
                "UPDATE daily_briefing_state SET presented_at = ?1, snoozed_until = NULL
                 WHERE local_date = ?2",
                params![now, date],
            )
            .map_err(|error| error.to_string())?;
    }
    transaction.commit().map_err(|error| error.to_string())?;
    Ok(should_present)
}

pub fn create_project(connection: &Connection, name: &str) -> Result<Project, String> {
    let name = name.trim();
    if name.is_empty() || name.chars().count() > 60 {
        return Err("Nama project harus berisi 1–60 karakter.".into());
    }
    let project = Project {
        id: Uuid::new_v4().to_string(),
        name: name.to_owned(),
        color: "#F9688D".into(),
    };
    connection
        .execute(
            "INSERT INTO projects(id, name, color, created_at) VALUES (?1, ?2, ?3, ?4)",
            params![project.id, project.name, project.color, now_utc()],
        )
        .map_err(|error| error.to_string())?;
    Ok(project)
}

pub fn delete_project(connection: &Connection, id: &str) -> Result<(), String> {
    let deleted = connection
        .execute("DELETE FROM projects WHERE id = ?1", [id])
        .map_err(|error| error.to_string())?;
    if deleted == 0 {
        return Err("Project tidak ditemukan.".into());
    }
    Ok(())
}

pub fn create_quick_note(connection: &Connection, input: NewQuickNote) -> Result<(), String> {
    let title = input.title.trim();
    if title.is_empty() || title.chars().count() > 120 {
        return Err("Judul catatan harus berisi 1–120 karakter.".into());
    }
    if input.content.chars().count() > 50_000 {
        return Err("Isi catatan maksimal 50.000 karakter.".into());
    }
    let now = now_utc();
    connection
        .execute(
            "INSERT INTO quick_notes(id, title, content, is_pinned, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?5)",
            params![
                Uuid::new_v4().to_string(),
                title,
                input.content,
                input.is_pinned,
                now
            ],
        )
        .map_err(|error| error.to_string())?;
    Ok(())
}

pub fn update_quick_note(connection: &Connection, note: QuickNote) -> Result<(), String> {
    if note.title.trim().is_empty() || note.title.chars().count() > 120 {
        return Err("Judul catatan harus berisi 1–120 karakter.".into());
    }
    if note.content.chars().count() > 50_000 {
        return Err("Isi catatan maksimal 50.000 karakter.".into());
    }
    let changed = connection
        .execute(
            "UPDATE quick_notes SET title = ?1, content = ?2, is_pinned = ?3, updated_at = ?4
             WHERE id = ?5",
            params![
                note.title.trim(),
                note.content,
                note.is_pinned,
                now_utc(),
                note.id
            ],
        )
        .map_err(|error| error.to_string())?;
    if changed == 0 {
        return Err("Catatan tidak ditemukan.".into());
    }
    Ok(())
}

pub fn delete_quick_note(connection: &Connection, id: &str) -> Result<(), String> {
    let deleted = connection
        .execute("DELETE FROM quick_notes WHERE id = ?1", [id])
        .map_err(|error| error.to_string())?;
    if deleted == 0 {
        return Err("Catatan tidak ditemukan.".into());
    }
    Ok(())
}

pub fn export_archive(connection: &Connection) -> Result<BackupArchive, String> {
    Ok(BackupArchive {
        schema_version: 1,
        exported_at: now_utc(),
        projects: list_projects(connection)?,
        tasks: list_tasks(connection)?,
        quick_notes: list_quick_notes(connection)?,
    })
}

pub fn import_archive(
    connection: &Connection,
    mut archive: BackupArchive,
) -> Result<usize, String> {
    if archive.schema_version != 1 {
        return Err("Versi file backup ini belum didukung.".into());
    }
    if archive.tasks.len() > 50_000
        || archive.projects.len() > 2_000
        || archive.quick_notes.len() > 10_000
    {
        return Err("File backup melewati batas jumlah data.".into());
    }

    let transaction = connection
        .unchecked_transaction()
        .map_err(|error| error.to_string())?;
    let mut project_ids = HashMap::new();
    for project in &archive.projects {
        let name = project.name.trim();
        if name.is_empty() || name.chars().count() > 60 {
            return Err("Nama project pada backup tidak valid.".into());
        }
        let existing: Option<String> = transaction
            .query_row(
                "SELECT id FROM projects WHERE name = ?1 COLLATE NOCASE",
                [name],
                |row| row.get(0),
            )
            .optional()
            .map_err(|error| error.to_string())?;
        let new_id = if let Some(id) = existing {
            id
        } else {
            let id = Uuid::new_v4().to_string();
            transaction
                .execute(
                    "INSERT INTO projects(id, name, color, created_at) VALUES (?1, ?2, '#F9688D', ?3)",
                    params![id, name, now_utc()],
                )
                .map_err(|error| error.to_string())?;
            id
        };
        project_ids.insert(project.id.clone(), new_id);
    }

    let mut new_task_ids = HashMap::new();
    let mut new_series_ids = HashMap::new();
    for task in &archive.tasks {
        if new_task_ids
            .insert(task.id.clone(), Uuid::new_v4().to_string())
            .is_some()
        {
            return Err("File backup berisi ID tugas ganda.".into());
        }
        if let Some(series_id) = &task.series_id {
            new_series_ids
                .entry(series_id.clone())
                .or_insert_with(|| Uuid::new_v4().to_string());
        }
    }
    let mut tasks_with_children = std::collections::HashSet::new();
    let mut task_has_parent = HashMap::new();
    for task in &archive.tasks {
        task_has_parent.insert(task.id.clone(), task.parent_id.as_ref().is_some());
        if let Some(parent_id) = &task.parent_id {
            tasks_with_children.insert(parent_id.clone());
        }
    }
    archive
        .tasks
        .sort_by_key(|task| task.parent_id.as_ref().is_some());

    for task in &archive.tasks {
        let title = task.title.trim();
        if title.is_empty() || title.chars().count() > 240 || task.notes.chars().count() > 100_000 {
            return Err("Tugas atau catatan pada backup melewati batas yang diizinkan.".into());
        }
        if !matches!(task.status.as_str(), "open" | "done")
            || !matches!(task.priority.as_str(), "low" | "normal" | "high" | "urgent")
        {
            return Err("Status atau prioritas tugas pada backup tidak valid.".into());
        }
        let due_at = task.due_at.as_deref().map(normalize_time).transpose()?;
        let offset = task.reminder_offset_minutes;
        if let Some(value) = offset {
            if !(0..=10_080).contains(&value) || due_at.is_none() {
                return Err("Pengingat pada backup tidak valid.".into());
            }
        }
        let mut recurrence = task
            .recurrence_rule
            .as_deref()
            .map(serde_json::from_str::<RecurrenceRule>)
            .transpose()
            .map_err(|error| error.to_string())?;
        if let Some(rule) = recurrence.as_mut() {
            validate_recurrence(rule, due_at.as_deref())?;
        }
        let recurrence_json = recurrence
            .as_ref()
            .map(serde_json::to_string)
            .transpose()
            .map_err(|error| error.to_string())?;
        let remind_at = reminder_time(due_at.as_deref(), offset)?;
        let id = new_task_ids
            .get(&task.id)
            .ok_or_else(|| "Referensi tugas pada backup tidak valid.".to_owned())?;
        let parent_id =
            task.parent_id
                .as_ref()
                .map(|value| {
                    new_task_ids.get(value).cloned().ok_or_else(|| {
                        "Subtugas pada backup tidak memiliki tugas induk.".to_owned()
                    })
                })
                .transpose()?;
        if task
            .parent_id
            .as_deref()
            .and_then(|parent| task_has_parent.get(parent))
            .copied()
            .unwrap_or(false)
        {
            return Err("Subtugas lebih dari satu tingkat belum didukung.".into());
        }
        if task.recurrence_rule.as_ref().is_some()
            && (task.parent_id.as_ref().is_some() || tasks_with_children.contains(&task.id))
        {
            return Err("Tugas berulang dengan subtugas belum didukung.".into());
        }
        if task.tags.len() > 12
            || task
                .tags
                .iter()
                .any(|tag| tag.trim().is_empty() || tag.chars().count() > 30)
        {
            return Err("Tag pada backup tidak valid.".into());
        }
        let project_id = task
            .project_id
            .as_ref()
            .map(|value| {
                project_ids
                    .get(value)
                    .cloned()
                    .ok_or_else(|| "Project pada backup tidak ditemukan.".to_owned())
            })
            .transpose()?;
        let series_id = task
            .series_id
            .as_ref()
            .and_then(|value| new_series_ids.get(value).cloned());
        let now = now_utc();
        let notified_at = if task.status == "open"
            && remind_at
                .as_deref()
                .is_some_and(|value| value <= now.as_str())
        {
            Some(now.clone())
        } else {
            None
        };
        transaction
            .execute(
                "INSERT INTO tasks(id, series_id, title, status, priority, due_at, remind_at,
                     reminder_offset_minutes, notified_at, recurrence_rule, rollover_count,
                     parent_id, project_id, sort_order, created_at, updated_at, completed_at)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?15, ?16)",
                params![
                    id,
                    series_id,
                    title,
                    task.status,
                    task.priority,
                    due_at,
                    remind_at,
                    offset,
                    notified_at,
                    recurrence_json,
                    task.rollover_count.max(0),
                    parent_id,
                    project_id,
                    task.sort_order,
                    now,
                    if task.status == "done" { Some(task.completed_at.clone().unwrap_or_else(now_utc)) } else { None }
                ],
            )
            .map_err(|error| error.to_string())?;
        transaction
            .execute(
                "INSERT INTO task_notes(task_id, markdown, updated_at) VALUES (?1, ?2, ?3)",
                params![id, task.notes, now_utc()],
            )
            .map_err(|error| error.to_string())?;
        replace_tags(&transaction, id, &task.tags)?;
    }

    for note in &archive.quick_notes {
        if note.title.trim().is_empty()
            || note.title.chars().count() > 120
            || note.content.chars().count() > 50_000
        {
            return Err("Catatan pada backup melewati batas yang diizinkan.".into());
        }
        transaction
            .execute(
                "INSERT INTO quick_notes(id, title, content, is_pinned, created_at, updated_at)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?5)",
                params![
                    Uuid::new_v4().to_string(),
                    note.title.trim(),
                    note.content,
                    note.is_pinned,
                    now_utc()
                ],
            )
            .map_err(|error| error.to_string())?;
    }
    transaction.commit().map_err(|error| error.to_string())?;
    Ok(archive.tasks.len() + archive.quick_notes.len())
}

pub fn due_reminders(
    connection: &Connection,
    now: &str,
) -> Result<Vec<(String, String, String)>, String> {
    let mut statement = connection
        .prepare(
            "SELECT id, title, remind_at FROM tasks
             WHERE status = 'open' AND remind_at IS NOT NULL AND remind_at <= ?1
               AND notified_at IS NULL ORDER BY remind_at LIMIT 32",
        )
        .map_err(|error| error.to_string())?;
    let rows = statement
        .query_map([now], |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)))
        .map_err(|error| error.to_string())?;
    rows.collect::<Result<Vec<_>, _>>()
        .map_err(|error| error.to_string())
}

pub fn current_due_reminder(
    connection: &Connection,
    task_id: &str,
    scheduled_for: &str,
) -> Result<Option<String>, String> {
    connection
        .query_row(
            "SELECT title FROM tasks
             WHERE id = ?1 AND status = 'open' AND remind_at = ?2 AND notified_at IS NULL",
            params![task_id, scheduled_for],
            |row| row.get(0),
        )
        .optional()
        .map_err(|error| error.to_string())
}

pub fn record_reminder_attempt(
    connection: &Connection,
    task_id: &str,
    scheduled_for: &str,
    delivered: bool,
    error: Option<&str>,
) -> Result<(), String> {
    let now = now_utc();
    let status = if delivered { "delivered" } else { "failed" };
    let transaction = connection
        .unchecked_transaction()
        .map_err(|error| error.to_string())?;
    transaction
        .execute(
            "INSERT INTO notification_logs(id, task_id, scheduled_for, attempted_at, status, error)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
            params![
                Uuid::new_v4().to_string(),
                task_id,
                scheduled_for,
                now,
                status,
                error
            ],
        )
        .map_err(|error| error.to_string())?;
    if delivered {
        transaction
            .execute(
                "UPDATE tasks SET notified_at = ?1
                     WHERE id = ?2 AND remind_at = ?3 AND status = 'open'",
                params![now, task_id, scheduled_for],
            )
            .map_err(|error| error.to_string())?;
    }
    transaction.commit().map_err(|error| error.to_string())
}

pub fn list_projects(connection: &Connection) -> Result<Vec<Project>, String> {
    let mut statement = connection
        .prepare("SELECT id, name, color FROM projects ORDER BY name COLLATE NOCASE")
        .map_err(|error| error.to_string())?;
    let rows = statement
        .query_map([], |row| {
            Ok(Project {
                id: row.get(0)?,
                name: row.get(1)?,
                color: row.get(2)?,
            })
        })
        .map_err(|error| error.to_string())?;
    rows.collect::<Result<Vec<_>, _>>()
        .map_err(|error| error.to_string())
}

fn list_quick_notes(connection: &Connection) -> Result<Vec<QuickNote>, String> {
    let mut statement = connection
        .prepare(
            "SELECT id, title, content, is_pinned, updated_at FROM quick_notes
             ORDER BY is_pinned DESC, updated_at DESC",
        )
        .map_err(|error| error.to_string())?;
    let rows = statement
        .query_map([], |row| {
            Ok(QuickNote {
                id: row.get(0)?,
                title: row.get(1)?,
                content: row.get(2)?,
                is_pinned: row.get(3)?,
                updated_at: row.get(4)?,
            })
        })
        .map_err(|error| error.to_string())?;
    rows.collect::<Result<Vec<_>, _>>()
        .map_err(|error| error.to_string())
}

fn find_task(connection: &Connection, id: &str) -> Result<Task, String> {
    list_tasks(connection)?
        .into_iter()
        .find(|task| task.id == id)
        .ok_or_else(|| "Tugas tidak ditemukan setelah disimpan.".to_owned())
}

fn replace_tags(
    transaction: &Transaction<'_>,
    task_id: &str,
    tags: &[String],
) -> Result<(), String> {
    for name in tags {
        let id = Uuid::new_v4().to_string();
        transaction
            .execute(
                "INSERT INTO tags(id, name) VALUES (?1, ?2) ON CONFLICT(name) DO NOTHING",
                params![id, name],
            )
            .map_err(|error| error.to_string())?;
        transaction
            .execute(
                "INSERT OR IGNORE INTO task_tags(task_id, tag_id)
                 SELECT ?1, id FROM tags WHERE name = ?2 COLLATE NOCASE",
                params![task_id, name],
            )
            .map_err(|error| error.to_string())?;
    }
    Ok(())
}

fn normalize_tags(tags: &mut Vec<String>) -> Result<(), String> {
    let mut normalized = Vec::new();
    let mut seen = std::collections::HashSet::new();
    for tag in tags
        .iter()
        .map(|value| value.trim())
        .filter(|value| !value.is_empty())
    {
        if tag.chars().count() > 30 {
            return Err("Setiap tag maksimal 30 karakter.".into());
        }
        if seen.insert(tag.to_lowercase()) {
            normalized.push(tag.to_owned());
        }
    }
    if normalized.len() > 12 {
        return Err("Setiap tugas maksimal memiliki 12 tag.".into());
    }
    *tags = normalized;
    Ok(())
}

fn validate_recurrence(rule: &mut RecurrenceRule, due_at: Option<&str>) -> Result<(), String> {
    if due_at.is_none() {
        return Err("Tugas berulang harus memiliki tanggal.".into());
    }
    if !matches!(rule.frequency.as_str(), "daily" | "weekly" | "monthly")
        || !(1..=365).contains(&rule.interval)
    {
        return Err("Aturan pengulangan tidak valid.".into());
    }
    if rule.frequency == "monthly" {
        let due =
            DateTime::parse_from_rfc3339(due_at.unwrap()).map_err(|error| error.to_string())?;
        let anchor = rule.month_day.unwrap_or(due.with_timezone(&Local).day());
        if !(1..=31).contains(&anchor) {
            return Err("Tanggal bulanan harus berada antara 1 dan 31.".into());
        }
        rule.month_day = Some(anchor);
    }
    Ok(())
}

fn next_due_after(due_at: &str, rule: &RecurrenceRule) -> Result<String, String> {
    let mut candidate = DateTime::parse_from_rfc3339(due_at)
        .map_err(|error| error.to_string())?
        .with_timezone(&Local);
    let now = Local::now();
    let mut count = 0;
    loop {
        candidate = advance_local(&candidate, rule)?;
        count += 1;
        if candidate > now {
            return Ok(candidate
                .with_timezone(&Utc)
                .to_rfc3339_opts(chrono::SecondsFormat::Millis, true));
        }
        if count >= 10_000 {
            return Err("Tanggal pengulangan terlalu jauh di masa lalu.".into());
        }
    }
}

fn advance_local(
    current: &DateTime<Local>,
    rule: &RecurrenceRule,
) -> Result<DateTime<Local>, String> {
    let date = current.date_naive();
    let interval = rule.interval;
    let next_date = match rule.frequency.as_str() {
        "daily" => date
            .checked_add_signed(Duration::days(i64::from(interval)))
            .ok_or_else(|| "Tanggal tugas di luar jangkauan.".to_owned())?,
        "weekly" => date
            .checked_add_signed(Duration::weeks(i64::from(interval)))
            .ok_or_else(|| "Tanggal tugas di luar jangkauan.".to_owned())?,
        "monthly" => {
            let month = date
                .with_day(1)
                .and_then(|first| first.checked_add_months(Months::new(interval)))
                .ok_or_else(|| "Tanggal bulanan di luar jangkauan.".to_owned())?;
            let first_next_month = month
                .checked_add_months(Months::new(1))
                .ok_or_else(|| "Tanggal bulanan di luar jangkauan.".to_owned())?;
            let last_day = first_next_month
                .pred_opt()
                .ok_or_else(|| "Tanggal bulanan di luar jangkauan.".to_owned())?
                .day();
            NaiveDate::from_ymd_opt(
                month.year(),
                month.month(),
                rule.month_day.unwrap_or(date.day()).min(last_day),
            )
            .ok_or_else(|| "Tanggal bulanan tidak valid.".to_owned())?
        }
        _ => return Err("Frekuensi pengulangan tidak dikenal.".into()),
    };
    resolve_local(next_date.and_time(current.time()))
}

fn resolve_local(naive: chrono::NaiveDateTime) -> Result<DateTime<Local>, String> {
    for shift in 0..=180 {
        let candidate = naive + Duration::minutes(shift);
        match Local.from_local_datetime(&candidate) {
            LocalResult::Single(value) => return Ok(value),
            LocalResult::Ambiguous(first, second) => return Ok(first.min(second)),
            LocalResult::None => {}
        }
    }
    Err("Waktu lokal ini tidak tersedia pada perubahan zona waktu.".into())
}

fn reminder_time(due_at: Option<&str>, offset: Option<i64>) -> Result<Option<String>, String> {
    let (Some(due_at), Some(offset)) = (due_at, offset) else {
        return Ok(None);
    };
    let due = DateTime::parse_from_rfc3339(due_at).map_err(|error| error.to_string())?;
    let remind = due - Duration::minutes(offset);
    Ok(Some(
        remind.to_rfc3339_opts(chrono::SecondsFormat::Millis, true),
    ))
}

fn normalize_time(value: &str) -> Result<String, String> {
    let parsed = DateTime::parse_from_rfc3339(value)
        .map_err(|_| "Tanggal harus dikirim sebagai waktu ISO 8601.".to_owned())?;
    Ok(parsed
        .with_timezone(&Utc)
        .to_rfc3339_opts(chrono::SecondsFormat::Millis, true))
}

fn ensure_setting(connection: &Connection, key: &str, value: &str) -> Result<(), String> {
    connection
        .execute(
            "INSERT OR IGNORE INTO app_settings(key, value, updated_at) VALUES (?1, ?2, ?3)",
            params![key, value, now_utc()],
        )
        .map_err(|error| error.to_string())?;
    Ok(())
}

fn setting(connection: &Connection, key: &str) -> Result<Option<String>, String> {
    connection
        .query_row(
            "SELECT value FROM app_settings WHERE key = ?1",
            [key],
            |row| row.get(0),
        )
        .optional()
        .map_err(|error| error.to_string())
}

fn upsert_setting(connection: &Connection, key: &str, value: &str) -> Result<(), String> {
    connection
        .execute(
            "INSERT INTO app_settings(key, value, updated_at) VALUES (?1, ?2, ?3)
             ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at",
            params![key, value, now_utc()],
        )
        .map_err(|error| error.to_string())?;
    Ok(())
}

pub fn now_utc() -> String {
    Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true)
}

#[cfg(test)]
mod tests;

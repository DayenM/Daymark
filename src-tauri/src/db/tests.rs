use std::{fs, path::PathBuf};

use chrono::{Duration, Local, NaiveDate, Utc};
use rusqlite::Connection;
use uuid::Uuid;

use crate::models::{NewQuickNote, NewTask, RecurrenceRule};

use super::*;

struct TestDb {
    connection: Option<Connection>,
    path: PathBuf,
}

impl TestDb {
    fn new() -> Self {
        let path = std::env::temp_dir().join(format!("daymark-test-{}.sqlite3", Uuid::new_v4()));
        let connection = open(&path).expect("database should initialize");
        Self {
            connection: Some(connection),
            path,
        }
    }

    fn connection(&self) -> &Connection {
        self.connection.as_ref().expect("connection is open")
    }

    fn connection_mut(&mut self) -> &mut Connection {
        self.connection.as_mut().expect("connection is open")
    }
}

impl Drop for TestDb {
    fn drop(&mut self) {
        drop(self.connection.take());
        for suffix in ["", "-wal", "-shm"] {
            let mut path = self.path.as_os_str().to_os_string();
            path.push(suffix);
            let _ = fs::remove_file(PathBuf::from(path));
        }
    }
}

fn task(title: &str) -> NewTask {
    NewTask {
        title: title.into(),
        priority: "normal".into(),
        notes: None,
        due_at: None,
        reminder_offset_minutes: None,
        recurrence_rule: None,
        parent_id: None,
        project_id: None,
        tags: Vec::new(),
    }
}

fn due_at(days_from_now: i64) -> String {
    (Utc::now() + Duration::days(days_from_now)).to_rfc3339()
}

#[test]
fn initializes_schema_and_validates_task_crud() {
    let mut db = TestDb::new();
    assert_eq!(
        setting(db.connection(), "theme").unwrap().as_deref(),
        Some("glass_dark")
    );
    assert_eq!(
        setting(db.connection(), "auto_start_enabled")
            .unwrap()
            .as_deref(),
        Some("false")
    );
    assert_eq!(
        setting(db.connection(), "app_transparency")
            .unwrap()
            .as_deref(),
        Some("0")
    );
    assert_eq!(
        setting(db.connection(), "widget_transparency")
            .unwrap()
            .as_deref(),
        Some("0")
    );

    let mut draft = task("  Rilis versi pertama  ");
    draft.tags = vec![" kerja ".into(), "KERJA".into(), "pribadi".into()];
    let created = create_task(db.connection_mut(), draft).unwrap();
    assert_eq!(created.title, "Rilis versi pertama");
    assert_eq!(created.tags, vec!["kerja", "pribadi"]);
    assert!(create_task(db.connection_mut(), task("  ")).is_err());

    let mut updated = task("Tinjau rilis");
    updated.priority = "high".into();
    updated.due_at = Some(due_at(1));
    updated.reminder_offset_minutes = Some(15);
    updated.tags = vec!["review".into()];
    update_task(db.connection(), &created.id, updated).unwrap();
    let saved = find_task(db.connection(), &created.id).unwrap();
    assert_eq!(saved.priority, "high");
    assert_eq!(saved.reminder_offset_minutes, Some(15));
    assert_eq!(saved.tags, vec!["review"]);

    set_task_done(db.connection_mut(), &created.id, true).unwrap();
    assert_eq!(
        find_task(db.connection(), &created.id).unwrap().status,
        "done"
    );
    set_task_done(db.connection_mut(), &created.id, false).unwrap();
    assert_eq!(
        find_task(db.connection(), &created.id).unwrap().status,
        "open"
    );
    delete_task(db.connection(), &created.id).unwrap();
    assert!(list_tasks(db.connection()).unwrap().is_empty());
}

#[test]
fn app_transparency_persists_and_stays_in_safe_range() {
    let db = TestDb::new();

    set_app_transparency(db.connection(), 32).unwrap();
    assert_eq!(load_workspace(db.connection()).unwrap().app_transparency, 32);
    assert!(set_app_transparency(db.connection(), 41).is_err());
}

#[test]
fn deleting_project_keeps_its_tasks_in_inbox() {
    let mut db = TestDb::new();
    let project = create_project(db.connection(), "Demo Project").unwrap();
    let mut draft = task("Task survives project deletion");
    draft.project_id = Some(project.id.clone());
    let created = create_task(db.connection_mut(), draft).unwrap();

    delete_project(db.connection(), &project.id).unwrap();

    let saved = find_task(db.connection(), &created.id).unwrap();
    assert_eq!(saved.project_id, None);
    assert!(list_projects(db.connection()).unwrap().is_empty());
    assert!(delete_project(db.connection(), &project.id).is_err());
}

#[test]
fn demo_backup_imports_projects_tasks_notes_and_feature_examples() {
    let path = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../demo/Daymark-Demo.json");
    let source = fs::read_to_string(path).unwrap();
    let archive: BackupArchive = serde_json::from_str(&source).unwrap();
    let db = TestDb::new();

    assert_eq!(import_archive(db.connection(), archive).unwrap(), 34);
    let tasks = list_tasks(db.connection()).unwrap();
    assert_eq!(tasks.len(), 30);
    assert_eq!(list_projects(db.connection()).unwrap().len(), 3);
    assert_eq!(list_quick_notes(db.connection()).unwrap().len(), 4);
    assert!(tasks.iter().any(|task| task.parent_id.is_some()));
    assert!(tasks.iter().any(|task| task.recurrence_rule.is_some()));
    assert!(tasks
        .iter()
        .any(|task| task.reminder_offset_minutes.is_some()));
}

#[test]
fn recurrence_completion_creates_next_task_with_notes_and_tags() {
    let mut db = TestDb::new();
    let mut draft = task("Laporan mingguan");
    draft.due_at = Some(due_at(1));
    draft.reminder_offset_minutes = Some(30);
    draft.recurrence_rule = Some(RecurrenceRule {
        frequency: "daily".into(),
        interval: 1,
        month_day: None,
    });
    draft.tags = vec!["rutin".into()];
    let original = create_task(db.connection_mut(), draft).unwrap();
    save_task_note(db.connection(), &original.id, "Checklist berulang").unwrap();

    set_task_done(db.connection_mut(), &original.id, true).unwrap();
    let tasks = list_tasks(db.connection()).unwrap();
    let next = tasks.iter().find(|item| item.status == "open").unwrap();
    assert_eq!(tasks.len(), 2);
    assert_eq!(next.series_id, original.series_id);
    assert_eq!(next.tags, vec!["rutin"]);
    assert_eq!(next.notes, "Checklist berulang");
    assert!(next.due_at > original.due_at);
    assert_eq!(next.reminder_offset_minutes, Some(30));
}

#[test]
fn rollover_is_local_time_preserving_and_atomic() {
    let mut db = TestDb::new();
    let today = Local::now().date_naive();
    let yesterday = today.pred_opt().unwrap();
    let old_due = resolve_local(yesterday.and_hms_opt(9, 30, 0).unwrap()).unwrap();
    let mut overdue_draft = task("Kemarin");
    overdue_draft.due_at = Some(old_due.to_rfc3339());
    overdue_draft.reminder_offset_minutes = Some(15);
    let overdue = create_task(db.connection_mut(), overdue_draft).unwrap();

    let mut today_draft = task("Hari ini");
    today_draft.due_at = Some(
        resolve_local(today.and_hms_opt(10, 0, 0).unwrap())
            .unwrap()
            .to_rfc3339(),
    );
    let today_task = create_task(db.connection_mut(), today_draft).unwrap();

    assert!(rollover_tasks(
        db.connection(),
        &[overdue.id.clone(), today_task.id.clone()]
    )
    .is_err());
    assert_eq!(
        find_task(db.connection(), &overdue.id).unwrap().due_at,
        overdue.due_at
    );
    assert_eq!(
        find_task(db.connection(), &overdue.id)
            .unwrap()
            .rollover_count,
        0
    );

    assert_eq!(
        rollover_tasks(db.connection(), std::slice::from_ref(&overdue.id)).unwrap(),
        1
    );
    let rolled = find_task(db.connection(), &overdue.id).unwrap();
    let rolled_due = DateTime::parse_from_rfc3339(rolled.due_at.as_deref().unwrap())
        .unwrap()
        .with_timezone(&Local);
    assert_eq!(rolled_due.date_naive(), today);
    assert_eq!(rolled_due.time(), old_due.time());
    assert_eq!(rolled.rollover_count, 1);
    assert!(rolled.remind_at.is_some());
}

#[test]
fn reminder_delivery_deduplicates_and_discards_stale_schedules() {
    let mut db = TestDb::new();
    let mut draft = task("Kirim laporan");
    draft.due_at = Some((Utc::now() - Duration::minutes(2)).to_rfc3339());
    draft.reminder_offset_minutes = Some(0);
    let created = create_task(db.connection_mut(), draft).unwrap();
    let scheduled_for = created.remind_at.unwrap();

    assert_eq!(due_reminders(db.connection(), &now_utc()).unwrap().len(), 1);
    assert_eq!(
        current_due_reminder(db.connection(), &created.id, &scheduled_for).unwrap(),
        Some("Kirim laporan".into())
    );
    record_reminder_attempt(db.connection(), &created.id, &scheduled_for, true, None).unwrap();
    assert!(
        current_due_reminder(db.connection(), &created.id, &scheduled_for)
            .unwrap()
            .is_none()
    );

    let mut changed = task("Jadwal diubah");
    changed.due_at = Some(due_at(1));
    changed.reminder_offset_minutes = Some(15);
    update_task(db.connection(), &created.id, changed).unwrap();
    assert!(
        current_due_reminder(db.connection(), &created.id, &scheduled_for)
            .unwrap()
            .is_none()
    );
    let log_count: i64 = db
        .connection()
        .query_row("SELECT COUNT(*) FROM notification_logs", [], |row| {
            row.get(0)
        })
        .unwrap();
    assert_eq!(log_count, 1);
}

#[test]
fn briefing_snooze_and_acknowledgement_state_transitions() {
    let db = TestDb::new();
    assert!(claim_daily_briefing(db.connection()).unwrap());
    assert!(!claim_daily_briefing(db.connection()).unwrap());
    snooze_briefing(db.connection()).unwrap();
    assert!(!claim_daily_briefing(db.connection()).unwrap());
    db.connection()
        .execute(
            "UPDATE daily_briefing_state SET snoozed_until = '2000-01-01T00:00:00.000Z'",
            [],
        )
        .unwrap();
    assert!(claim_daily_briefing(db.connection()).unwrap());
    acknowledge_briefing(db.connection()).unwrap();
    assert!(!claim_daily_briefing(db.connection()).unwrap());
}

#[test]
fn backup_import_remaps_ids_and_rolls_back_invalid_archive() {
    let mut db = TestDb::new();
    let project = create_project(db.connection(), "Project A").unwrap();
    let mut draft = task("Template task");
    draft.project_id = Some(project.id);
    draft.tags = vec!["template".into()];
    let original = create_task(db.connection_mut(), draft).unwrap();
    save_task_note(db.connection(), &original.id, "Template context").unwrap();
    create_quick_note(
        db.connection(),
        NewQuickNote {
            title: "Pinned note".into(),
            content: "Keep this".into(),
            is_pinned: true,
        },
    )
    .unwrap();

    let archive = export_archive(db.connection()).unwrap();
    assert_eq!(import_archive(db.connection(), archive.clone()).unwrap(), 2);
    let tasks = list_tasks(db.connection()).unwrap();
    assert_eq!(tasks.len(), 2);
    assert_ne!(tasks[0].id, tasks[1].id);
    assert_eq!(list_projects(db.connection()).unwrap().len(), 1);
    assert_eq!(list_quick_notes(db.connection()).unwrap().len(), 2);

    let mut invalid = archive;
    invalid.projects[0].id = "new-project".into();
    invalid.projects[0].name = "Must roll back".into();
    invalid.tasks[0].project_id = Some("new-project".into());
    invalid.tasks[0].title.clear();
    assert!(import_archive(db.connection(), invalid).is_err());
    assert_eq!(list_projects(db.connection()).unwrap().len(), 1);
    assert_eq!(list_tasks(db.connection()).unwrap().len(), 2);
    assert_eq!(list_quick_notes(db.connection()).unwrap().len(), 2);
}

#[test]
fn recurrence_validation_rejects_unsupported_parent_and_invalid_rule() {
    let mut db = TestDb::new();
    let parent = create_task(db.connection_mut(), task("Parent")).unwrap();
    let mut child = task("Child");
    child.parent_id = Some(parent.id);
    let mut recurrence = RecurrenceRule {
        frequency: "daily".into(),
        interval: 1,
        month_day: None,
    };
    child.recurrence_rule = Some(recurrence.clone());
    child.due_at = Some(due_at(1));
    assert!(create_task(db.connection_mut(), child).is_err());

    recurrence.frequency = "unknown".into();
    assert!(validate_recurrence(&mut recurrence, Some(&due_at(1))).is_err());
}

#[test]
fn local_date_helper_resolves_a_valid_local_time() {
    let date = NaiveDate::from_ymd_opt(2026, 1, 15).unwrap();
    let resolved = resolve_local(date.and_hms_opt(9, 0, 0).unwrap()).unwrap();
    assert_eq!(resolved.date_naive(), date);
}

#[test]
fn island_dock_defaults_to_top_centre_and_rejects_bad_values() {
    let db = TestDb::new();
    assert_eq!(island_dock(db.connection()).unwrap(), ("top".into(), 0.5));
    set_island_dock(db.connection(), "left", 0.25).unwrap();
    assert_eq!(island_dock(db.connection()).unwrap(), ("left".into(), 0.25));
    assert!(set_island_dock(db.connection(), "bottom", 0.5).is_err());
    assert!(set_island_dock(db.connection(), "right", 1.5).is_err());
    assert!(parse_island_dock("top:abc").is_none());
}

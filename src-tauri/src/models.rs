use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Task {
    pub id: String,
    pub series_id: Option<String>,
    pub title: String,
    pub status: String,
    pub priority: String,
    pub due_at: Option<String>,
    pub remind_at: Option<String>,
    pub reminder_offset_minutes: Option<i64>,
    pub recurrence_rule: Option<String>,
    pub rollover_count: i64,
    pub parent_id: Option<String>,
    pub project_id: Option<String>,
    pub sort_order: f64,
    pub notes: String,
    pub tags: Vec<String>,
    pub created_at: String,
    pub updated_at: String,
    pub completed_at: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Project {
    pub id: String,
    pub name: String,
    pub color: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct QuickNote {
    pub id: String,
    pub title: String,
    pub content: String,
    pub is_pinned: bool,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceSnapshot {
    pub tasks: Vec<Task>,
    pub projects: Vec<Project>,
    pub quick_notes: Vec<QuickNote>,
    pub theme: String,
    pub font_family: String,
    pub widget_transparency: u8,
    pub app_transparency: u8,
    pub auto_start: bool,
    pub briefing_acknowledged: bool,
    pub local_date: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NewTask {
    pub title: String,
    pub priority: String,
    #[serde(default)]
    pub notes: Option<String>,
    pub due_at: Option<String>,
    pub reminder_offset_minutes: Option<i64>,
    pub recurrence_rule: Option<RecurrenceRule>,
    pub parent_id: Option<String>,
    pub project_id: Option<String>,
    pub tags: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RecurrenceRule {
    pub frequency: String,
    #[serde(default = "default_interval")]
    pub interval: u32,
    pub month_day: Option<u32>,
}

fn default_interval() -> u32 {
    1
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NewQuickNote {
    pub title: String,
    pub content: String,
    pub is_pinned: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BackupArchive {
    pub schema_version: u32,
    pub exported_at: String,
    pub projects: Vec<Project>,
    pub tasks: Vec<Task>,
    pub quick_notes: Vec<QuickNote>,
}

CREATE TABLE IF NOT EXISTS projects (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL UNIQUE COLLATE NOCASE,
    color TEXT NOT NULL DEFAULT '#F9688D',
    created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS tags (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL UNIQUE COLLATE NOCASE
);

CREATE TABLE IF NOT EXISTS tasks (
    id TEXT PRIMARY KEY,
    series_id TEXT,
    title TEXT NOT NULL CHECK(length(title) <= 240),
    status TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open', 'done')),
    priority TEXT NOT NULL DEFAULT 'normal' CHECK(priority IN ('low', 'normal', 'high', 'urgent')),
    due_at TEXT,
    remind_at TEXT,
    reminder_offset_minutes INTEGER,
    notified_at TEXT,
    recurrence_rule TEXT,
    rollover_count INTEGER NOT NULL DEFAULT 0,
    parent_id TEXT REFERENCES tasks(id) ON DELETE CASCADE,
    project_id TEXT REFERENCES projects(id) ON DELETE SET NULL,
    sort_order REAL NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    completed_at TEXT,
    CHECK(parent_id IS NULL OR parent_id <> id)
);

CREATE TABLE IF NOT EXISTS task_notes (
    task_id TEXT PRIMARY KEY REFERENCES tasks(id) ON DELETE CASCADE,
    markdown TEXT NOT NULL DEFAULT '',
    updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS task_tags (
    task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
    tag_id TEXT NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
    PRIMARY KEY(task_id, tag_id)
);

CREATE TABLE IF NOT EXISTS quick_notes (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL CHECK(length(title) <= 120),
    content TEXT NOT NULL DEFAULT '',
    is_pinned INTEGER NOT NULL DEFAULT 0 CHECK(is_pinned IN (0, 1)),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS app_settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS daily_briefing_state (
    local_date TEXT PRIMARY KEY,
    presented_at TEXT,
    acknowledged_at TEXT,
    snoozed_until TEXT,
    timezone_id TEXT
);

CREATE TABLE IF NOT EXISTS notification_logs (
    id TEXT PRIMARY KEY,
    task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
    scheduled_for TEXT NOT NULL,
    attempted_at TEXT NOT NULL,
    status TEXT NOT NULL CHECK(status IN ('pending', 'delivered', 'failed')),
    error TEXT
);

CREATE INDEX IF NOT EXISTS idx_tasks_due_status ON tasks(status, due_at);
CREATE INDEX IF NOT EXISTS idx_tasks_reminder ON tasks(status, remind_at) WHERE notified_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_tasks_parent_order ON tasks(parent_id, sort_order);
CREATE INDEX IF NOT EXISTS idx_tasks_project_order ON tasks(project_id, sort_order);
CREATE INDEX IF NOT EXISTS idx_tasks_series ON tasks(series_id, due_at);
CREATE INDEX IF NOT EXISTS idx_task_tags_tag ON task_tags(tag_id, task_id);
CREATE INDEX IF NOT EXISTS idx_quick_notes_pinned ON quick_notes(is_pinned, updated_at);
CREATE INDEX IF NOT EXISTS idx_notification_logs_task ON notification_logs(task_id, scheduled_for);

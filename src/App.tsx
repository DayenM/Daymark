import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { invoke } from "@tauri-apps/api/core";
import { emit, listen, type UnlistenFn } from "@tauri-apps/api/event";
import { confirm, open, save } from "@tauri-apps/plugin-dialog";
import { getVersion } from "@tauri-apps/api/app";
import { check, type Update } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";
import type { FontFamily, Priority, Project, QuickNote, Task, TaskDraft, Theme, ViewKey, WorkspaceSnapshot } from "./types";
import { Icon, type IconName } from "./components/Icon";
import { AppearancePicker } from "./components/AppearancePicker";
import { QuickCapture } from "./components/QuickCapture";
import { TaskEditor } from "./components/TaskEditor";
import { DateTimePicker } from "./components/DateTimePicker";
import { TaskRow } from "./components/TaskRow";
import { NotesPage } from "./components/NotesPage";
import { CalendarPage } from "./components/CalendarPage";
import { applyGlassAlpha, applyTheme } from "./themes";

const navigation: { key: ViewKey; label: string; icon: IconName }[] = [
  { key: "calendar", label: "Kalender", icon: "calendar" },
  { key: "briefing", label: "Briefing", icon: "spark" },
  { key: "today", label: "Hari ini", icon: "sun" },
  { key: "upcoming", label: "Mendatang", icon: "clock" },
  { key: "inbox", label: "Inbox", icon: "inbox" },
  { key: "projects", label: "Projects", icon: "folder" },
  { key: "notes", label: "Catatan", icon: "note" },
];

const priorityOrder: Record<Priority, number> = { urgent: 0, high: 1, normal: 2, low: 3 };

function localDay(value: string) {
  const date = new Date(value);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function todayKey() {
  return localDay(new Date().toISOString());
}

function readableDate(value = new Date()) {
  return value.toLocaleDateString("id-ID", { weekday: "long", day: "numeric", month: "long", year: "numeric" });
}

function dayLabel(value: string) {
  return new Date(`${value}T12:00:00`).toLocaleDateString("id-ID", { weekday: "long", day: "numeric", month: "long" });
}

function groupByDay(tasks: Task[]) {
  const groups = new Map<string, Task[]>();
  for (const task of tasks) {
    if (!task.dueAt) continue;
    const day = localDay(task.dueAt);
    groups.set(day, [...(groups.get(day) ?? []), task]);
  }
  return [...groups.entries()].sort(([left], [right]) => left.localeCompare(right));
}

function dueTime(value: string | null) {
  if (!value) return "";
  return new Date(value).toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit" });
}

function greeting() {
  const hour = new Date().getHours();
  return hour < 11 ? "Selamat pagi" : hour < 15 ? "Selamat siang" : hour < 19 ? "Selamat sore" : "Selamat malam";
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function orderTasks(tasks: Task[]) {
  return [...tasks].sort((left, right) => {
    const byPriority = priorityOrder[left.priority] - priorityOrder[right.priority];
    if (byPriority !== 0) return byPriority;
    if (left.dueAt && right.dueAt) {
      return left.dueAt.localeCompare(right.dueAt);
    } else if (left.dueAt) return -1;
    else if (right.dueAt) return 1;
    return left.createdAt.localeCompare(right.createdAt);
  });
}

export default function App() {
  return <WorkspaceApp />;
}

function WorkspaceApp() {
  const [snapshot, setSnapshot] = useState<WorkspaceSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [view, setView] = useState<ViewKey>("calendar");
  const [sidebarCollapsed, setSidebarCollapsed] = useState(true);
  const [projectFilter, setProjectFilter] = useState<string | null>(null);
  const [editingTask, setEditingTask] = useState<Task | null>(null);
  const [quickCaptureOpen, setQuickCaptureOpen] = useState(false);
  const [taskTitle, setTaskTitle] = useState("");
  const [taskDue, setTaskDue] = useState("");
  const [taskPriority, setTaskPriority] = useState<Priority>("normal");
  const [taskProject, setTaskProject] = useState("");
  const [projectName, setProjectName] = useState("");
  const [projectEditorOpen, setProjectEditorOpen] = useState(false);
  const [widgetTransparency, setWidgetTransparency] = useState(0);
  const [appTransparency, setAppTransparency] = useState(0);
  const transparencySaveTimer = useRef<number | null>(null);
  const appTransparencySaveTimer = useRef<number | null>(null);

  const refresh = useCallback(async (notifyWidget = true) => {
    let data: WorkspaceSnapshot;
    try {
      data = await invoke<WorkspaceSnapshot>("load_workspace");
    } catch (value) {
      if (!errorMessage(value).includes("state not managed")) throw value;
      await new Promise(resolve => window.setTimeout(resolve, 250));
      data = await invoke<WorkspaceSnapshot>("load_workspace");
    }
    setSnapshot(data);
    if (notifyWidget) void emit("workspace-updated").catch(() => undefined);
    setError("");
    setLoading(false);
  }, []);

  useEffect(() => {
    if (snapshot && transparencySaveTimer.current === null) setWidgetTransparency(snapshot.widgetTransparency);
    if (snapshot && appTransparencySaveTimer.current === null) setAppTransparency(snapshot.appTransparency);
  }, [snapshot?.widgetTransparency, snapshot?.appTransparency]);

  useEffect(() => {
    const level = applyGlassAlpha(appTransparency, snapshot?.theme);
    document.documentElement.style.setProperty("--app-window-opacity", String(1 - level * .85));
  }, [appTransparency, snapshot?.theme]);

  useEffect(() => () => {
    if (transparencySaveTimer.current !== null) window.clearTimeout(transparencySaveTimer.current);
    if (appTransparencySaveTimer.current !== null) window.clearTimeout(appTransparencySaveTimer.current);
  }, []);

  useEffect(() => {
    let disposed = false;
    const unlisten: UnlistenFn[] = [];
    void refresh().catch(value => {
      if (!disposed) {
        setError(errorMessage(value));
        setLoading(false);
      }
    });
    void Promise.all([
      // Window-scoped: the hotkey targets only the window the user is looking at.
      getCurrentWindow().listen("quick-capture", () => setQuickCaptureOpen(true)),
      listen("briefing-needed", () => {
        openView("briefing");
        void refresh().catch(value => setError(errorMessage(value)));
      }),
      listen("workspace-mutated", () => {
        void refresh(false).catch(value => setError(errorMessage(value)));
      }),
    ]).then(listeners => {
      if (disposed) listeners.forEach(stop => stop());
      else unlisten.push(...listeners);
    });
    return () => {
      disposed = true;
      unlisten.forEach(stop => stop());
    };
  }, [refresh]);

  useEffect(() => {
    if (!snapshot) return;
    const root = document.documentElement;
    root.dataset.window = "main";
    root.dataset.font = snapshot.fontFamily;
    applyTheme(snapshot.theme);
  }, [snapshot?.fontFamily, snapshot?.theme]);

  const tasks = snapshot?.tasks ?? [];
  const openTasks = useMemo(() => tasks.filter(task => task.status === "open"), [tasks]);
  const overdueTasks = useMemo(() => orderTasks(openTasks.filter(task => task.dueAt && localDay(task.dueAt) < todayKey())), [openTasks]);
  const todayTasks = useMemo(() => orderTasks(openTasks.filter(task => task.dueAt && localDay(task.dueAt) === todayKey())), [openTasks]);
  const unscheduledTasks = useMemo(() => orderTasks(openTasks.filter(task => !task.dueAt)), [openTasks]);
  const upcomingTasks = useMemo(() => orderTasks(openTasks.filter(task => task.dueAt && localDay(task.dueAt) > todayKey())), [openTasks]);
  const completedToday = useMemo(() => orderTasks(tasks.filter(task => task.status === "done" && task.completedAt && localDay(task.completedAt) === todayKey())), [tasks]);
  const topLevel = (list: Task[]) => {
    const visibleIds = new Set(list.map(task => task.id));
    return list.filter(task => !task.parentId || !visibleIds.has(task.parentId));
  };
  const pinnedNotes = (snapshot?.quickNotes ?? []).filter(note => note.isPinned);

  async function perform(action: () => Promise<unknown>) {
    try {
      await action();
      await refresh();
    } catch (value) {
      setError(errorMessage(value));
    }
  }

  async function createTask(title: string, due = "", priority: Priority = "normal", projectId: string | null = null, parentId: string | null = null) {
    await invoke("create_task", {
      task: {
        title,
        priority,
        dueAt: due ? new Date(due).toISOString() : null,
        reminderOffsetMinutes: null,
        recurrenceRule: null,
        parentId,
        projectId,
        tags: [],
      },
    });
    setTaskTitle("");
    setTaskDue("");
    await refresh();
  }

  async function submitTask(event: FormEvent) {
    event.preventDefault();
    if (!taskTitle.trim()) return;
    await perform(() => createTask(taskTitle.trim(), taskDue, taskPriority, taskProject || null));
  }

  async function toggleTask(task: Task) {
    await perform(() => invoke("set_task_done", { id: task.id, done: task.status !== "done" }));
  }

  async function saveTask(task: Task, draft: TaskDraft, notes: string) {
    await invoke("update_task", { id: task.id, task: draft });
    await invoke("save_task_note", { id: task.id, markdown: notes });
    await refresh();
  }

  async function addSubtask(parent: Task, title: string) {
    await createTask(title, "", parent.priority, parent.projectId, parent.id);
  }

  async function createQuickCapture(title: string) {
    await createTask(title);
    openView("inbox");
  }

  async function createProject(event: FormEvent) {
    event.preventDefault();
    if (!projectName.trim()) return;
    await perform(async () => {
      const project = await invoke<Project>("create_project", { name: projectName.trim() });
      setProjectFilter(project.id);
      setProjectName("");
      setProjectEditorOpen(false);
    });
  }

  async function deleteProject(project: Project) {
    if (!await confirm(`Hapus project “${project.name}”? Tugasnya tetap disimpan dan akan menjadi tanpa project.`)) return;
    await perform(async () => {
      await invoke("delete_project", { id: project.id });
      setProjectFilter(null);
      setTaskProject(current => current === project.id ? "" : current);
      openView("today");
      setNotice("Project dihapus. Tugasnya tetap tersimpan tanpa project.");
    });
  }

  async function saveTheme(theme: Theme) {
    await perform(() => invoke("set_theme", { theme }));
  }

  async function saveFontFamily(fontFamily: FontFamily) {
    await perform(() => invoke("set_font_family", { fontFamily }));
  }

  function changeWidgetTransparency(percent: number) {
    const value = Math.max(0, Math.min(40, Math.round(percent)));
    setWidgetTransparency(value);
    if (transparencySaveTimer.current !== null) window.clearTimeout(transparencySaveTimer.current);
    transparencySaveTimer.current = window.setTimeout(() => {
      transparencySaveTimer.current = null;
      void (async () => {
        try {
          await invoke("set_widget_transparency", { percent: value });
          await refresh();
        } catch (failure) {
          setWidgetTransparency(snapshot?.widgetTransparency ?? 0);
          setError(errorMessage(failure));
        }
      })();
    }, 250);
  }

  function changeAppTransparency(percent: number) {
    const value = Math.max(0, Math.min(40, Math.round(percent)));
    setAppTransparency(value);
    if (appTransparencySaveTimer.current !== null) window.clearTimeout(appTransparencySaveTimer.current);
    const timer = window.setTimeout(() => {
      void (async () => {
        try {
          await invoke("set_app_transparency", { percent: value });
          await refresh(false);
        } catch (failure) {
          if (appTransparencySaveTimer.current === timer) {
            setAppTransparency(snapshot?.appTransparency ?? 0);
            setError(errorMessage(failure));
          }
        } finally {
          if (appTransparencySaveTimer.current === timer) appTransparencySaveTimer.current = null;
        }
      })();
    }, 250);
    appTransparencySaveTimer.current = timer;
  }

  async function toggleAutoStart() {
    if (!snapshot) return;
    await perform(() => invoke("set_auto_start", { enabled: !snapshot.autoStart }));
  }

  async function acknowledgeBriefing() {
    try {
      await invoke("acknowledge_briefing");
      await refresh();
      openView("today");
    } catch (value) {
      setError(errorMessage(value));
    }
  }

  async function snoozeBriefing() {
    try {
      await invoke("snooze_briefing");
      await getCurrentWindow().hide();
    } catch (value) {
      setError(errorMessage(value));
    }
  }

  async function exportBackup() {
    const path = await save({
      defaultPath: `daymark-backup-${todayKey()}.json`,
      filters: [{ name: "Daymark backup", extensions: ["json"] }],
    });
    if (!path) return;
    await perform(async () => {
      await invoke("export_backup", { path });
      setNotice("Backup berhasil disimpan.");
    });
  }

  async function importBackup() {
    const path = await open({
      multiple: false,
      directory: false,
      filters: [{ name: "Daymark backup", extensions: ["json"] }],
    });
    if (!path || Array.isArray(path)) return;
    if (!await confirm("Data dari backup akan ditambahkan ke workspace ini. Mengimpor file yang sama lagi dapat membuat tugas duplikat. Lanjutkan?")) return;
    await perform(async () => {
      const count = await invoke<number>("import_backup", { path });
      setNotice(`${count} tugas dan catatan berhasil ditambahkan.`);
    });
  }

  async function rolloverAll() {
    await perform(() => invoke("rollover_tasks", { ids: overdueTasks.map(task => task.id) }));
  }

  async function createQuickNote(title: string) {
    await perform(() => invoke("create_quick_note", { note: { title, content: "", isPinned: false } }));
  }

  async function updateQuickNote(note: QuickNote) {
    await perform(() => invoke("update_quick_note", { note }));
  }

  async function deleteQuickNote(note: QuickNote) {
    if (!await confirm(`Hapus catatan “${note.title}”?`)) return;
    await perform(() => invoke("delete_quick_note", { id: note.id }));
  }

  if (loading) return <div className="startup-state"><span className="brand-mark"><Icon name="sun" /></span><p>Menyiapkan ruang harian…</p></div>;
  if (!snapshot) return <div className="startup-state"><span className="brand-mark"><Icon name="sun" /></span><h1>Daymark belum dapat dibuka</h1><p>{error || "Database lokal tidak merespons."}</p><button className="primary-button" onClick={() => { setLoading(true); void refresh().catch(value => { setError(errorMessage(value)); setLoading(false); }); }}>Coba lagi</button></div>;

  const currentProject = snapshot.projects.find(project => project.id === projectFilter);
  const pageTitle = view === "projects" && currentProject ? currentProject.name : ({ calendar: "Kalender", briefing: "Morning Briefing", today: "Hari ini", upcoming: "Mendatang", inbox: "Inbox", projects: "Projects", notes: "Catatan", settings: "Pengaturan" } satisfies Record<ViewKey, string>)[view];
  const pageIcon = view === "settings" ? "settings" : navigation.find(item => item.key === view)?.icon ?? "folder";
  const rootTasks = view === "today" ? topLevel([...overdueTasks, ...todayTasks, ...unscheduledTasks])
    : view === "upcoming" ? topLevel(upcomingTasks)
      : view === "inbox" ? topLevel(unscheduledTasks)
        : view === "projects" ? topLevel(openTasks.filter(task => task.projectId === projectFilter))
          : [];

  function openView(next: ViewKey) {
    setView(next);
    // The calendar gets the full width; other pages bring the sidebar back.
    setSidebarCollapsed(next === "calendar");
  }

  return (
    <div className="window-frame">
      <header className="titlebar" data-tauri-drag-region>
        <div className="brand-lockup" data-tauri-drag-region>
          <button className="sidebar-toggle" onClick={() => setSidebarCollapsed(value => !value)} aria-expanded={!sidebarCollapsed} aria-controls="app-sidebar" aria-label={sidebarCollapsed ? "Buka sidebar" : "Tutup sidebar"} title={sidebarCollapsed ? "Buka sidebar" : "Tutup sidebar"}><Icon name="menu" size={17} /></button>
          <span className="brand-mark"><Icon name="sun" size={17} /></span>
          <span className="brand-name">daymark</span>
          <span className="brand-divider" />
          <span className="brand-caption">ruang kerja harian</span>
        </div>
        <div className="titlebar-actions">
          <button className="titlebar-shortcut" onClick={() => void invoke("open_today_widget")} aria-label="Buka Panel Hari Ini"><Icon name="calendar" size={14} /><span>Panel Hari Ini</span></button>
          <button className="titlebar-shortcut" onClick={() => setQuickCaptureOpen(true)} title="Quick capture · Ctrl+Shift+Y"><kbd>Ctrl</kbd><kbd>Shift</kbd><kbd>Y</kbd><span>Quick capture</span></button>
          <button className="window-control" aria-label="Minimalkan" onClick={() => void getCurrentWindow().minimize()}>−</button>
          <button className="window-control" aria-label="Maksimalkan" onClick={() => void getCurrentWindow().toggleMaximize()}>□</button>
          <button className="window-control close-control" aria-label="Sembunyikan ke tray" onClick={() => void getCurrentWindow().close()}><Icon name="close" size={15} /></button>
        </div>
      </header>

      <div className={`app-layout${sidebarCollapsed ? " sidebar-collapsed" : ""}`}>
        <aside className="sidebar" id="app-sidebar">
          <div className="sidebar-section">
            <p className="sidebar-label">Ruang pribadi</p>
            <nav className="main-nav" aria-label="Navigasi utama">
              {navigation.map(item => (
                <button key={item.key} className={`nav-item ${view === item.key ? "active" : ""}`} title={item.label} onClick={() => { openView(item.key); setProjectFilter(null); }}>
                  <Icon name={item.icon} size={17} /><span>{item.label}</span>
                  {item.key === "briefing" && !snapshot.briefingAcknowledged && <span className="nav-count urgent-count">●</span>}
                  {item.key === "today" && overdueTasks.length > 0 && <span className="nav-count urgent-count">{overdueTasks.length}</span>}
                  {item.key === "inbox" && unscheduledTasks.length > 0 && <span className="nav-count">{unscheduledTasks.length}</span>}
                </button>
              ))}
            </nav>
          </div>

          <div className="sidebar-section project-nav-section">
            <div className="sidebar-label-row"><p className="sidebar-label">Projects</p><button className="small-icon-button" onClick={() => setProjectEditorOpen(true)} aria-label="Buat project"><Icon name="plus" size={15} /></button></div>
            {snapshot.projects.length === 0 ? <p className="sidebar-empty">Project membantu tugas tetap terarah.</p> : <nav className="project-nav" aria-label="Projects">
              {snapshot.projects.map(project => <button className={`nav-item project-nav-item ${view === "projects" && projectFilter === project.id ? "active" : ""}`} key={project.id} title={project.name} onClick={() => { openView("projects"); setProjectFilter(project.id); }}><span className="project-dot" style={{ background: project.color }} /><span>{project.name}</span></button>)}
            </nav>}
          </div>

          <div className="sidebar-bottom">
            <button className={`nav-item ${view === "settings" ? "active" : ""}`} title="Pengaturan" onClick={() => openView("settings")}><Icon name="settings" size={17} /><span>Pengaturan</span></button>
            <div className="local-badge"><span className="local-dot" /> Disimpan di perangkat ini</div>
          </div>
        </aside>

        <main className={`main-content${view === "calendar" ? " is-calendar" : ""}`}>
          <div className="page-topline">
            <div><p className="date-line">{readableDate()}</p><h1><span className="page-title-icon"><Icon name={pageIcon} size={18} /></span>{view === "today" ? `${greeting()}, Dayen` : pageTitle}</h1></div>
            <div className="page-top-actions">{currentProject && view === "projects" && <button className="text-button delete-project-button" onClick={() => void deleteProject(currentProject)}><Icon name="trash" size={15} /> Hapus project</button>}<span className="task-total">{openTasks.length} tugas aktif</span></div>
          </div>

          {error && <div className="inline-error" role="alert"><span>{error}</span><button className="icon-button" onClick={() => setError("")} aria-label="Tutup pesan"><Icon name="close" size={14} /></button></div>}
          {notice && <div className="inline-notice" role="status"><span>{notice}</span><button className="icon-button" onClick={() => setNotice("")} aria-label="Tutup pesan"><Icon name="close" size={14} /></button></div>}

          {(view === "briefing" || (view === "today" && !snapshot.briefingAcknowledged)) && (
            <section className="briefing-panel glass-panel" aria-labelledby="briefing-heading">
              <div className="briefing-intro">
                <div className="briefing-spark"><Icon name="spark" size={19} /></div>
                <div><p className="eyebrow">Morning briefing</p><h2 id="briefing-heading">{snapshot.briefingAcknowledged ? "Ringkasan harianmu." : "Mulai dengan yang paling berarti."}</h2><p>Ringkasan hari ini tersimpan di perangkatmu dan siap kapan saja.</p></div>
              </div>
              <div className="briefing-summary">
                <div><strong>{overdueTasks.length.toString().padStart(2, "0")}</strong><span>belum selesai</span></div>
                <div><strong>{todayTasks.length.toString().padStart(2, "0")}</strong><span>terjadwal hari ini</span></div>
                <div><strong>{pinnedNotes.length.toString().padStart(2, "0")}</strong><span>catatan tersemat</span></div>
                <div className="briefing-buttons">
                  {overdueTasks.length > 0 && <button className="soft-button" onClick={() => void rolloverAll()}>Pindahkan ke hari ini</button>}
                  {snapshot.briefingAcknowledged ? <button className="primary-button" onClick={() => openView("today")}>Buka Hari ini <Icon name="arrow" size={15} /></button> : <><button className="text-button" onClick={() => void snoozeBriefing()}>Ingatkan 15 menit lagi</button><button className="primary-button" onClick={() => void acknowledgeBriefing()}>Mulai fokus <Icon name="arrow" size={15} /></button></>}
                </div>
              </div>
              {pinnedNotes.length > 0 && <div className="briefing-notes"><span className="briefing-notes-label"><Icon name="pin" size={14} /> Catatan penting</span>{pinnedNotes.slice(0, 2).map(note => <button key={note.id} className="briefing-note" onClick={() => openView("notes")}><strong>{note.title}</strong><span>{note.content || "Belum ada isi"}</span></button>)}</div>}
            </section>
          )}

          {(view === "today" || view === "upcoming" || view === "inbox" || view === "projects") && (
            <>
              <form className="task-composer glass-panel" onSubmit={submitTask}>
                <div className="composer-main">
                  <span className="composer-plus"><Icon name="plus" size={17} /></span>
                  <label className="composer-title-field" htmlFor="new-task-title"><span>Langkah berikutnya</span><input id="new-task-title" value={taskTitle} onChange={event => setTaskTitle(event.target.value)} placeholder={view === "inbox" ? "Catat hal yang perlu diingat…" : "Apa yang ingin kamu selesaikan?"} maxLength={240} /></label>
                  <button className="composer-submit" type="submit" disabled={!taskTitle.trim()}><Icon name="plus" size={15} /> Tambah tugas</button>
                </div>
                <div className="composer-options">
                  <span className="composer-options-label"><Icon name="calendar" size={13} /> Detail opsional</span>
                  <DateTimePicker value={taskDue} onChange={setTaskDue} compact />
                  <select className="composer-priority" value={taskPriority} onChange={event => setTaskPriority(event.target.value as Priority)} aria-label="Prioritas tugas"><option value="normal">Prioritas normal</option><option value="high">Prioritas tinggi</option><option value="urgent">Mendesak</option><option value="low">Prioritas rendah</option></select>
                  {snapshot.projects.length > 0 && <select className="composer-project" value={taskProject} onChange={event => setTaskProject(event.target.value)} aria-label="Project tugas"><option value="">Tanpa project</option>{snapshot.projects.map(project => <option key={project.id} value={project.id}>{project.name}</option>)}</select>}
                </div>
              </form>

              {view === "today" && overdueTasks.length > 0 && <TaskSection title="Perlu ditinjau" count={overdueTasks.length} accent="coral" tasks={topLevel(overdueTasks)} allTasks={tasks} onToggle={toggleTask} onEdit={setEditingTask} onRollover={task => void perform(() => invoke("rollover_task", { id: task.id }))} />}
              {view === "today" && <TaskSection title="Hari ini" count={todayTasks.length} tasks={topLevel(todayTasks)} allTasks={tasks} onToggle={toggleTask} onEdit={setEditingTask} empty="Belum ada jadwal. Tambahkan satu langkah kecil untuk hari ini." />}
              {view === "today" && unscheduledTasks.length > 0 && <TaskSection title="Tanpa jadwal" count={unscheduledTasks.length} tasks={topLevel(unscheduledTasks)} allTasks={tasks} onToggle={toggleTask} onEdit={setEditingTask} />}
              {view === "today" && completedToday.length > 0 && <TaskSection title="Selesai hari ini" count={completedToday.length} icon="check" tasks={topLevel(completedToday)} allTasks={tasks} onToggle={toggleTask} onEdit={setEditingTask} />}
              {view === "upcoming" && (upcomingTasks.length === 0 ? <TaskSection title="Agenda mendatang" count={0} tasks={[]} allTasks={tasks} onToggle={toggleTask} onEdit={setEditingTask} empty="Belum ada agenda berikutnya. Jadwalkan tugas dari daftar hari ini." /> : groupByDay(upcomingTasks).map(([day, dayTasks]) => <TaskSection key={day} title={dayLabel(day)} count={dayTasks.length} tasks={topLevel(dayTasks)} allTasks={tasks} onToggle={toggleTask} onEdit={setEditingTask} />))}
              {view === "inbox" && <TaskSection title="Belum dijadwalkan" count={unscheduledTasks.length} tasks={topLevel(unscheduledTasks)} allTasks={tasks} onToggle={toggleTask} onEdit={setEditingTask} empty="Inbox kosong. Tugas tanpa tanggal akan muncul di sini." />}
              {view === "projects" && <TaskSection title={currentProject ? `Tugas · ${currentProject.name}` : "Pilih project"} count={rootTasks.length} icon="folder" tasks={rootTasks} allTasks={tasks} onToggle={toggleTask} onEdit={setEditingTask} empty="Project ini belum memiliki tugas aktif." />}
            </>
          )}

          {view === "briefing" && (
            <>
              {overdueTasks.length > 0 && <TaskSection title="Belum selesai dari hari sebelumnya" count={overdueTasks.length} tasks={topLevel(overdueTasks)} allTasks={tasks} onToggle={toggleTask} onEdit={setEditingTask} onRollover={task => void perform(() => invoke("rollover_task", { id: task.id }))} accent="coral" />}
              <TaskSection title="Jadwal hari ini" count={todayTasks.length} tasks={topLevel(todayTasks)} allTasks={tasks} onToggle={toggleTask} onEdit={setEditingTask} empty="Belum ada tugas terjadwal. Kamu bisa mulai dari satu hal kecil." />
            </>
          )}

          {view === "projects" && snapshot.projects.length === 0 && <section className="empty-project glass-panel"><span className="empty-icon"><Icon name="folder" size={24} /></span><h2>Mulai dari satu project.</h2><p>Kelompokkan tugas yang berjalan bersama.</p><button className="primary-button" onClick={() => setProjectEditorOpen(true)}><Icon name="plus" size={15} /> Buat project</button></section>}

          {view === "calendar" && <CalendarPage tasks={tasks} onEdit={setEditingTask} />}

          {view === "notes" && <NotesPage notes={snapshot.quickNotes} onCreate={createQuickNote} onUpdate={updateQuickNote} onDelete={deleteQuickNote} />}

          {view === "settings" && <SettingsPage snapshot={snapshot} widgetTransparency={widgetTransparency} appTransparency={appTransparency} onTheme={saveTheme} onFontFamily={saveFontFamily} onTransparency={changeWidgetTransparency} onAppTransparency={changeAppTransparency} onToggleAutoStart={toggleAutoStart} onQuickCapture={() => setQuickCaptureOpen(true)} onExport={() => void exportBackup()} onImport={() => void importBackup()} />}

          <footer className="app-footer"><span>Daymark menjaga data tetap lokal.</span><span>Ctrl + Shift + Y <span className="footer-separator">·</span> quick capture</span></footer>
        </main>
      </div>

      {editingTask && <TaskEditor key={editingTask.id} task={editingTask} projects={snapshot.projects} onClose={() => setEditingTask(null)} onSave={saveTask} onDelete={async task => { await invoke("delete_task", { id: task.id }); await refresh(); }} onCreateSubtask={addSubtask} />}
      {quickCaptureOpen && <QuickCapture onClose={() => setQuickCaptureOpen(false)} onCreate={createQuickCapture} />}
      {projectEditorOpen && <div className="modal-scrim" role="presentation" onMouseDown={event => event.target === event.currentTarget && setProjectEditorOpen(false)}><form className="project-modal glass-panel" role="dialog" aria-modal="true" onSubmit={createProject}><div className="modal-header"><div><p className="eyebrow">Ruang terarah</p><h2>Project baru</h2></div><button type="button" className="icon-button" onClick={() => setProjectEditorOpen(false)} aria-label="Tutup"><Icon name="close" /></button></div><label className="field-label" htmlFor="project-name">Nama project</label><input id="project-name" autoFocus className="field-input" value={projectName} onChange={event => setProjectName(event.target.value)} maxLength={60} placeholder="Contoh: Peluncuran produk" /><footer className="modal-footer"><button type="button" className="text-button" onClick={() => setProjectEditorOpen(false)}>Batal</button><button className="primary-button" disabled={!projectName.trim()}>Buat project</button></footer></form></div>}
    </div>
  );
}

function TaskSection({
  title, count, tasks, allTasks, onToggle, onEdit, onRollover, empty, accent, icon = "calendar",
}: {
  title: string;
  count: number;
  tasks: Task[];
  allTasks: Task[];
  onToggle: (task: Task) => void;
  onEdit: (task: Task) => void;
  onRollover?: (task: Task) => void;
  empty?: string;
  accent?: "coral";
  icon?: IconName;
}) {
  return (
    <section className={`task-section ${accent === "coral" ? "section-overdue" : ""}`}>
      <div className="section-heading"><div><h2><Icon name={accent === "coral" ? "clock" : icon} size={15} />{title}</h2><span className="section-count">{count}</span></div><span className="section-rule" /></div>
      {tasks.length === 0 ? <p className="empty-section">{empty}</p> : <div className="task-list">{tasks.map(task => <TaskRow key={task.id} task={task} children={allTasks.filter(child => child.parentId === task.id)} overdue={accent === "coral"} onToggle={onToggle} onEdit={onEdit} onRollover={onRollover} />)}</div>}
    </section>
  );
}

function SettingsPage({ snapshot, widgetTransparency, appTransparency, onTheme, onFontFamily, onTransparency, onAppTransparency, onToggleAutoStart, onQuickCapture, onExport, onImport }: {
  snapshot: WorkspaceSnapshot;
  widgetTransparency: number;
  appTransparency: number;
  onTheme: (theme: Theme) => void;
  onFontFamily: (fontFamily: FontFamily) => void;
  onTransparency: (percent: number) => void;
  onAppTransparency: (percent: number) => void;
  onToggleAutoStart: () => void;
  onQuickCapture: () => void;
  onExport: () => void;
  onImport: () => void;
}) {
  return (
    <div className="settings-page">
      <section className="settings-section">
        <div className="settings-heading"><p className="eyebrow"><Icon name="palette" size={13} />Tampilan</p><h2>Pilih suasana kerjamu.</h2><p>Perubahan langsung tersimpan di perangkat ini.</p></div>
        <AppearancePicker theme={snapshot.theme} fontFamily={snapshot.fontFamily} transparency={widgetTransparency} onTheme={onTheme} onFontFamily={onFontFamily} onTransparency={onTransparency} />
        <label className={`appearance-opacity app-transparency-control${snapshot.theme === "neumorphic" ? " is-disabled" : ""}`}>
          <span className="appearance-opacity-copy">
            <span className="appearance-opacity-icon"><Icon name="layers" size={16} /></span>
            <span><strong>Transparansi Daymark</strong><small>{snapshot.theme === "neumorphic" ? "Pilih tema Glass untuk membuka efek kaca Windows." : "Kaca buram Windows · teks tetap tajam saat latar makin tembus."}</small></span>
            <output>{snapshot.theme === "neumorphic" ? "—" : `${appTransparency}%`}</output>
          </span>
          <input type="range" min="0" max="40" step="1" value={appTransparency} aria-label="Transparansi Daymark" disabled={snapshot.theme === "neumorphic"} onChange={event => onAppTransparency(Number(event.target.value))} />
        </label>
      </section>
      <section className="settings-section settings-card">
        <div className="settings-card-copy"><span className="settings-icon"><Icon name="sun" /></span><div><h3>Mulai bersama Windows</h3><p>Daymark membuka briefing harian setelah kamu masuk ke Windows.</p></div></div>
        <button role="switch" aria-checked={snapshot.autoStart} className={`switch ${snapshot.autoStart ? "on" : ""}`} onClick={onToggleAutoStart}><span /></button>
      </section>
      <section className="settings-section settings-card">
        <div className="settings-card-copy"><span className="settings-icon"><Icon name="spark" /></span><div><h3>Quick Capture</h3><p>Simpan tugas dari aplikasi mana saja dengan Ctrl + Shift + Y.</p></div></div>
        <button className="soft-button" onClick={onQuickCapture}>Coba sekarang <Icon name="arrow" size={14} /></button>
      </section>
      <section className="settings-section settings-card">
        <div className="settings-card-copy"><span className="settings-icon"><Icon name="note" /></span><div><h3>Backup workspace</h3><p>Ekspor salinan JSON atau gabungkan backup dari perangkat lain.</p></div></div>
        <div className="button-pair"><button className="text-button" onClick={onImport}>Impor JSON</button><button className="soft-button" onClick={onExport}>Ekspor backup</button></div>
      </section>
      <UpdateCard />
      <div className="data-location"><span className="local-dot" /><div><strong>Data lokal aktif</strong><p>Database dan catatanmu disimpan di folder AppData pengguna Windows.</p></div></div>
    </div>
  );
}

type UpdateStatus =
  | { kind: "idle" }
  | { kind: "checking" }
  | { kind: "latest" }
  | { kind: "available"; version: string }
  | { kind: "installing" }
  | { kind: "error"; message: string };

function UpdateCard() {
  const [version, setVersion] = useState("");
  const [status, setStatus] = useState<UpdateStatus>({ kind: "idle" });
  const handle = useRef<Update | null>(null);

  useEffect(() => {
    void getVersion().then(setVersion).catch(() => undefined);
    return () => { void handle.current?.close().catch(() => undefined); };
  }, []);

  async function checkNow() {
    setStatus({ kind: "checking" });
    try {
      void handle.current?.close().catch(() => undefined);
      handle.current = null;
      const update = await check({ timeout: 15_000 });
      if (!update) {
        setStatus({ kind: "latest" });
        return;
      }
      handle.current = update;
      setStatus({ kind: "available", version: update.version });
    } catch (value) {
      setStatus({ kind: "error", message: value instanceof Error ? value.message : String(value) });
    }
  }

  async function install() {
    if (!handle.current) return;
    setStatus({ kind: "installing" });
    try {
      await handle.current.downloadAndInstall();
      await relaunch();
    } catch (value) {
      setStatus({ kind: "error", message: value instanceof Error ? value.message : String(value) });
    }
  }

  const detail = {
    idle: "Daymark juga memeriksa otomatis di latar belakang.",
    checking: "Memeriksa rilis terbaru…",
    latest: "Kamu sudah memakai versi terbaru.",
    available: status.kind === "available" ? `Versi ${status.version} siap dipasang. Daymark akan dimulai ulang.` : "",
    installing: "Mengunduh dan memasang pembaruan…",
    error: status.kind === "error" ? `Gagal memeriksa pembaruan: ${status.message}` : "",
  }[status.kind];
  const busy = status.kind === "checking" || status.kind === "installing";

  return (
    <section className="settings-section settings-card">
      <div className="settings-card-copy"><span className="settings-icon"><Icon name="repeat" /></span><div><h3>Pembaruan aplikasi{version && ` · v${version}`}</h3><p role="status" aria-live="polite">{detail}</p></div></div>
      {status.kind === "available"
        ? <button className="soft-button" onClick={() => void install()}>Pasang &amp; mulai ulang <Icon name="arrow" size={14} /></button>
        : <button className="soft-button" onClick={() => void checkNow()} disabled={busy}>{status.kind === "installing" ? "Memasang…" : busy ? "Memeriksa…" : "Periksa pembaruan"}</button>}
    </section>
  );
}

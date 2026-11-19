import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent } from "react";
import { invoke } from "@tauri-apps/api/core";
import { emit, listen } from "@tauri-apps/api/event";
import { PhysicalPosition } from "@tauri-apps/api/dpi";
import { currentMonitor, getCurrentWindow, LogicalPosition, LogicalSize } from "@tauri-apps/api/window";
import { isPermissionGranted, requestPermission, sendNotification } from "@tauri-apps/plugin-notification";
import { relaunch } from "@tauri-apps/plugin-process";
import { check, type Update } from "@tauri-apps/plugin-updater";
import { dayKey } from "../calendar";
import type { Project, Task, TaskDraft, Theme, WorkspaceSnapshot } from "../types";
import { Icon, type IconName } from "./Icon";
import { AppearancePicker } from "./AppearancePicker";
import { PanelCalendar } from "./PanelCalendar";
import { QuickCapture } from "./QuickCapture";
import { TaskEditor } from "./TaskEditor";
import { applyGlassAlpha, applyTheme } from "../themes";

const priorityOrder: Record<Task["priority"], number> = { urgent: 0, high: 1, normal: 2, low: 3 };
const priorityLabel: Record<Task["priority"], string> = { urgent: "Mendesak", high: "Tinggi", normal: "Normal", low: "Rendah" };
type PanelMode = "todo" | "focus" | "calendar";
type PanelChoice = { mode: PanelMode | "rest"; label: string; icon: IconName };
const panelChoices: PanelChoice[] = [
  { mode: "todo", label: "To-do", icon: "check" },
  { mode: "focus", label: "Fokus", icon: "target" },
  { mode: "calendar", label: "Kalender", icon: "calendar" },
  { mode: "rest", label: "Istirahat", icon: "moon" },
];
type DockEdge = "top" | "left" | "right";
const DEFAULT_WIDGET_SIZE = { width: 400, height: 620 };
const FOCUS_WIDGET_SIZE = { width: 390, height: 184 };

function localDay(value: string) {
  return dayKey(new Date(value));
}

function timeLabel(value: string | null) {
  return value ? new Date(value).toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit" }) : "Tanpa jam";
}

function errorMessage(value: unknown) {
  return value instanceof Error ? value.message : String(value);
}

export function TodayWidget() {
  const previewMode = import.meta.env.DEV && new URLSearchParams(window.location.search).get("preview") === "1";
  const panelWindow = useMemo(() => previewMode ? null : getCurrentWindow(), [previewMode]);
  const [snapshot, setSnapshot] = useState<WorkspaceSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [availableUpdate, setAvailableUpdate] = useState<{ version: string; body: string | null } | null>(null);
  const [updateBusy, setUpdateBusy] = useState(false);
  const [updateError, setUpdateError] = useState("");
  const [pinned, setPinned] = useState(true);
  const [positionFrozen, setPositionFrozen] = useState(false);
  const [panelMode, setPanelMode] = useState<PanelMode>("calendar");
  const [islandOpen, setIslandOpenState] = useState(false);
  const [islandClosing, setIslandClosing] = useState(false);
  const [dockEdge, setDockEdge] = useState<DockEdge>("top");
  const dockEdgeRef = useRef<DockEdge>("top");
  const islandDrag = useRef<{ pointerId: number; startX: number; startY: number; position: PhysicalPosition | null; scale: number; moved: boolean } | null>(null);
  const suppressIslandClick = useRef(false);
  const islandClickTimer = useRef<number | null>(null);
  const [appearanceOpen, setAppearanceOpen] = useState(false);
  const [modeMenuOpen, setModeMenuOpen] = useState(false);
  const [widgetTransparency, setWidgetTransparency] = useState(0);
  const [clock, setClock] = useState(() => new Date());
  const [calendarDate, setCalendarDate] = useState(() => new Date());
  const [editorOpen, setEditorOpen] = useState(false);
  const [quickCaptureOpen, setQuickCaptureOpen] = useState(false);
  const [editingTask, setEditingTask] = useState<Task | null>(null);
  const expandedSize = useRef<{ width: number; height: number } | null>(null);
  const focusSize = useRef<{ width: number; height: number } | null>(null);
  const currentMode = useRef<PanelMode>("calendar");
  const islandOpenRef = useRef(false);
  const islandClosingRef = useRef(false);
  const closeSequence = useRef(0);
  const openingIsland = useRef(false);
  const closeFinishing = useRef(false);
  const appearanceControlRef = useRef<HTMLDivElement>(null);
  const modePickerRef = useRef<HTMLDivElement>(null);
  const modePickerTriggerRef = useRef<HTMLButtonElement>(null);
  const transparencySaveTimer = useRef<number | null>(null);
  const updateHandle = useRef<Update | null>(null);
  const updateCheckRunning = useRef(false);
  const pendingUpdateCheck = useRef(false);
  const announcedUpdateVersion = useRef<string | null>(null);
  const hidePanelAfterIslandClose = useRef(false);
  const dragOrigin = useRef<{ pointerId: number; startX: number; startY: number; lastX: number; lastY: number; position: { x: number; y: number } | null; scale: number; ended: boolean } | null>(null);
  const resizeOrigin = useRef<{ pointerId: number; startX: number; startY: number; lastX: number; lastY: number; width: number; height: number; minWidth: number; minHeight: number; scale: number; centerX: number; top: number; ready: boolean; ended: boolean; applying: boolean; dirty: boolean } | null>(null);

  const refresh = useCallback(async () => {
    try {
      setSnapshot(await invoke<WorkspaceSnapshot>("load_workspace"));
      setError("");
    } catch (value) {
      setError(errorMessage(value));
    } finally {
      setLoading(false);
    }
  }, []);

  const checkForUpdates = useCallback(async (force = false) => {
    if (previewMode) return;
    if (updateCheckRunning.current) {
      if (force) pendingUpdateCheck.current = true;
      return;
    }
    updateCheckRunning.current = true;
    try {
      const update = await check({ timeout: 15_000 });
      if (!update) return;
      if (announcedUpdateVersion.current === update.version) {
        await update.close();
        return;
      }
      void updateHandle.current?.close().catch(() => undefined);
      updateHandle.current = update;
      announcedUpdateVersion.current = update.version;
      setAvailableUpdate({ version: update.version, body: update.body ?? null });
      setUpdateError("");
      try {
        let granted = await isPermissionGranted();
        if (!granted) granted = (await requestPermission()) === "granted";
        if (granted) sendNotification({ title: "Pembaruan Daymark tersedia", body: `Daymark versi ${update.version} siap dipasang.` });
      } catch (value) {
        console.debug("Daymark update toast was unavailable:", value);
      }
    } catch (value) {
      console.debug("Daymark update check failed:", value);
    } finally {
      updateCheckRunning.current = false;
      if (pendingUpdateCheck.current) {
        pendingUpdateCheck.current = false;
        void checkForUpdates(true);
      }
    }
  }, [previewMode]);

  useEffect(() => {
    const root = document.documentElement;
    root.dataset.window = "today-widget";
    if (previewMode) {
      let active = true;
      void import("../../demo/Daymark-Demo.json").then(({ default: archive }) => {
        if (!active) return;
        const demo = archive as unknown as Pick<WorkspaceSnapshot, "tasks" | "projects" | "quickNotes">;
        setSnapshot({
          ...demo,
          theme: "glass_dark",
          fontFamily: "segoe-ui",
          widgetTransparency: 0,
          appTransparency: 0,
          autoStart: true,
          briefingAcknowledged: false,
          localDate: dayKey(new Date()),
        });
        setLoading(false);
      }).catch(value => {
        setError(errorMessage(value));
        setLoading(false);
      });
      return () => {
        active = false;
        delete root.dataset.window;
      };
    }
    void refresh();
    // After Windows sign-in, greet the user with the calendar already open.
    void invoke<[DockEdge, number]>("get_island_dock").then(([edge]) => applyDockEdge(edge)).catch(() => undefined)
      .then(() => invoke<boolean>("launched_at_startup")).then(atStartup => { if (atStartup) void setIslandOpen(true); }).catch(() => undefined);
    void panelWindow?.isAlwaysOnTop().then(setPinned).catch(() => setPinned(true));
    let unlisten: (() => void)[] = [];
    let active = true;
    void Promise.all([
      listen("workspace-updated", () => void refresh()),
      getCurrentWindow().listen("quick-capture", () => {
        void (async () => {
          await changePanelMode("todo");
          await setIslandOpen(true);
          setQuickCaptureOpen(true);
        })();
      }),
      listen("window-close-requested", () => {
        if (islandOpenRef.current) void setIslandOpen(false);
        else void panelWindow?.hide();
      }),
      listen("briefing-needed", () => void changePanelMode("calendar")),
      listen("update-check-requested", () => void checkForUpdates(true)),
    ]).then(stops => {
      if (active) unlisten = stops;
      else stops.forEach(stop => stop());
    });
    void checkForUpdates();
    return () => {
      active = false;
      unlisten.forEach(stop => stop());
      void updateHandle.current?.close().catch(() => undefined);
      updateHandle.current = null;
      delete root.dataset.window;
    };
  }, [checkForUpdates, panelWindow, previewMode, refresh]);

  useEffect(() => {
    if (!snapshot) return;
    // Don't overwrite a slider value that is still waiting to be saved.
    if (transparencySaveTimer.current === null) setWidgetTransparency(snapshot.widgetTransparency);
    const root = document.documentElement;
    root.dataset.font = snapshot.fontFamily;
    applyTheme(snapshot.theme);
  }, [snapshot?.fontFamily, snapshot?.theme, snapshot?.widgetTransparency]);

  useEffect(() => {
    document.documentElement.style.setProperty("--widget-surface-alpha", String((100 - widgetTransparency) / 100));
    applyGlassAlpha(widgetTransparency, snapshot?.theme);
  }, [widgetTransparency, snapshot?.theme]);

  useEffect(() => {
    if (!appearanceOpen) return;
    const closeWhenOutside = (event: PointerEvent) => {
      if (!appearanceControlRef.current?.contains(event.target as Node)) setAppearanceOpen(false);
    };
    document.addEventListener("pointerdown", closeWhenOutside);
    return () => document.removeEventListener("pointerdown", closeWhenOutside);
  }, [appearanceOpen]);

  useEffect(() => {
    if (!modeMenuOpen) return;
    const closeWhenOutside = (event: PointerEvent) => {
      if (!modePickerRef.current?.contains(event.target as Node)) setModeMenuOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setModeMenuOpen(false);
      modePickerTriggerRef.current?.focus();
    };
    document.addEventListener("pointerdown", closeWhenOutside);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeWhenOutside);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [modeMenuOpen]);

  useEffect(() => () => {
    if (transparencySaveTimer.current !== null) window.clearTimeout(transparencySaveTimer.current);
    if (islandClickTimer.current !== null) window.clearTimeout(islandClickTimer.current);
  }, []);

  useEffect(() => {
    if (!islandClosing) return;
    const timer = window.setTimeout(() => void finishIslandClose(), 620);
    return () => window.clearTimeout(timer);
  }, [islandClosing]);

  const today = dayKey(new Date());
  const openTasks = snapshot?.tasks.filter(task => task.status === "open") ?? [];
  const overdue = openTasks.filter(task => task.dueAt && localDay(task.dueAt) < today)
    .sort((left, right) => priorityOrder[left.priority] - priorityOrder[right.priority] || (left.dueAt ?? "").localeCompare(right.dueAt ?? ""));
  const todayTasks = openTasks.filter(task => task.dueAt && localDay(task.dueAt) === today)
    .sort((left, right) => priorityOrder[left.priority] - priorityOrder[right.priority] || (left.dueAt ?? "").localeCompare(right.dueAt ?? ""));
  const unscheduledTasks = openTasks.filter(task => !task.dueAt)
    .sort((left, right) => priorityOrder[left.priority] - priorityOrder[right.priority] || left.createdAt.localeCompare(right.createdAt));
  const projects = snapshot?.projects ?? [];
  const completedToday = snapshot?.tasks.filter(task => task.status === "done" && task.completedAt && localDay(task.completedAt) === today).length ?? 0;
  const totalToday = todayTasks.length + completedToday;
  const progress = totalToday ? Math.round(completedToday / totalToday * 100) : 0;
  const pinnedNote = snapshot?.quickNotes.find(note => note.isPinned);
  const focusTask = overdue[0] ?? todayTasks[0] ?? unscheduledTasks[0] ?? null;
  const focusDue = focusTask?.dueAt
    ? overdue.includes(focusTask) ? `Lewat · ${new Date(focusTask.dueAt).toLocaleDateString("id-ID", { day: "numeric", month: "short" })} · ${timeLabel(focusTask.dueAt)}` : timeLabel(focusTask.dueAt)
    : "Belum dijadwalkan";
  const focusIsOverdue = focusTask ? overdue.includes(focusTask) : false;

  async function resizeWidget(size: { width: number; height: number }, minimum: LogicalSize) {
    if (!panelWindow) return true;
    const [scale, position, currentSize, monitor] = await Promise.all([panelWindow.scaleFactor(), panelWindow.outerPosition(), panelWindow.outerSize(), currentMonitor()]);
    const edge = dockEdgeRef.current;
    const left = position.x / scale, top = position.y / scale;
    const width = currentSize.width / scale, height = currentSize.height / scale;
    // Grow away from the edge the island is docked to, then keep the panel on screen.
    let x = edge === "left" ? left : edge === "right" ? left + width - size.width : left + width / 2 - size.width / 2;
    let y = edge === "top" ? top : top + height / 2 - size.height / 2;
    if (monitor) {
      const mx = monitor.position.x / scale, my = monitor.position.y / scale;
      x = Math.min(Math.max(x, mx), mx + monitor.size.width / scale - size.width);
      y = Math.min(Math.max(y, my), my + monitor.size.height / scale - size.height);
    }
    await panelWindow.setMinSize(minimum);
    await panelWindow.setSize(new LogicalSize(size.width, size.height));
    await panelWindow.setPosition(new LogicalPosition(x, y));
    return true;
  }

  function applyDockEdge(edge: DockEdge) {
    dockEdgeRef.current = edge;
    setDockEdge(edge);
  }

  async function dockIsland(edge: DockEdge, ratio: number) {
    try {
      await invoke("set_island_dock", { edge, ratio });
      applyDockEdge(edge);
    } catch (value) {
      setError(errorMessage(value));
    }
  }

  async function startIslandDrag(event: ReactPointerEvent<HTMLElement>) {
    if (!panelWindow || positionFrozen || event.button !== 0 || islandOpenRef.current) return;
    const origin = { pointerId: event.pointerId, startX: event.screenX, startY: event.screenY, position: null as PhysicalPosition | null, scale: 1, moved: false };
    islandDrag.current = origin;
    event.currentTarget.setPointerCapture(event.pointerId);
    const [position, scale] = await Promise.all([panelWindow.outerPosition(), panelWindow.scaleFactor()]);
    if (islandDrag.current === origin) {
      origin.position = position;
      origin.scale = scale;
    }
  }

  function moveIslandDrag(event: ReactPointerEvent<HTMLElement>) {
    const origin = islandDrag.current;
    if (!panelWindow || !origin?.position || origin.pointerId !== event.pointerId) return;
    const dx = event.screenX - origin.startX, dy = event.screenY - origin.startY;
    if (!origin.moved && Math.hypot(dx, dy) < 5) return;
    origin.moved = true;
    void panelWindow.setPosition(new PhysicalPosition(origin.position.x + Math.round(dx * origin.scale), origin.position.y + Math.round(dy * origin.scale))).catch(value => setError(errorMessage(value)));
  }

  async function endIslandDrag(event: ReactPointerEvent<HTMLElement>) {
    const origin = islandDrag.current;
    if (!origin || origin.pointerId !== event.pointerId) return;
    islandDrag.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    if (!origin.moved || !panelWindow) return;
    suppressIslandClick.current = true;
    try {
      const [position, size, monitor] = await Promise.all([panelWindow.outerPosition(), panelWindow.outerSize(), currentMonitor()]);
      if (!monitor) return;
      const cx = position.x + size.width / 2 - monitor.position.x;
      const cy = position.y + size.height / 2 - monitor.position.y;
      // Snap to the closest of top / left / right; the bottom edge belongs to the taskbar.
      const distance: Record<DockEdge, number> = { top: cy, left: cx, right: monitor.size.width - cx };
      const edge = (Object.keys(distance) as DockEdge[]).reduce((best, next) => distance[next] < distance[best] ? next : best);
      const ratio = Math.min(1, Math.max(0, edge === "top" ? cx / monitor.size.width : cy / monitor.size.height));
      await dockIsland(edge, ratio);
    } catch (value) {
      setError(errorMessage(value));
    }
  }

  function clickIsland(event: ReactMouseEvent<HTMLButtonElement>) {
    if (suppressIslandClick.current) {
      suppressIslandClick.current = false;
      return;
    }
    if (islandClickTimer.current !== null) window.clearTimeout(islandClickTimer.current);
    islandClickTimer.current = null;
    if (event.detail === 0) {
      void setIslandOpen(true);
      return;
    }
    if (event.detail >= 3) {
      void dockIsland("top", .5);
      return;
    }
    // Wait a beat so a triple click recenters without opening the panel first.
    islandClickTimer.current = window.setTimeout(() => {
      islandClickTimer.current = null;
      void setIslandOpen(true);
    }, 280);
  }

  async function setIslandOpen(next: boolean) {
    if (!next) {
      if (!islandOpenRef.current || islandClosingRef.current) return;
      setModeMenuOpen(false);
      islandClosingRef.current = true;
      closeSequence.current += 1;
      setIslandClosing(true);
      if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) void finishIslandClose();
      return;
    }
    if (islandOpenRef.current) {
      if (islandClosingRef.current) {
        closeSequence.current += 1;
        islandClosingRef.current = false;
        hidePanelAfterIslandClose.current = false;
        setIslandClosing(false);
      }
      return;
    }
    if (openingIsland.current) return;

    const mode = currentMode.current;
    const size = mode === "focus" ? focusSize.current ?? FOCUS_WIDGET_SIZE : expandedSize.current ?? DEFAULT_WIDGET_SIZE;
    const minimum = mode === "focus" ? new LogicalSize(340, 150) : new LogicalSize(360, 500);
    const previousSize = { width: window.innerWidth, height: window.innerHeight };
    openingIsland.current = true;
    if (!panelWindow) {
      islandOpenRef.current = true;
      setIslandOpenState(true);
      islandClosingRef.current = false;
      setClock(new Date());
      openingIsland.current = false;
      return;
    }
    try {
      await resizeWidget(size, minimum);
      islandOpenRef.current = true;
      islandClosingRef.current = false;
      setIslandOpenState(true);
      setIslandClosing(false);
      setClock(new Date());
      if (mode !== "focus" && size === DEFAULT_WIDGET_SIZE) expandedSize.current = null;
    } catch (value) {
      await panelWindow.setMinSize(new LogicalSize(30, 30)).catch(() => undefined);
      await panelWindow.setSize(new LogicalSize(previousSize.width, previousSize.height)).catch(() => undefined);
      setError(errorMessage(value));
    } finally {
      openingIsland.current = false;
    }
  }

  async function finishIslandClose() {
    if (!islandOpenRef.current || !islandClosingRef.current || closeFinishing.current) return;
    closeFinishing.current = true;
    const sequence = closeSequence.current;
    const mode = currentMode.current;
    const previousSize = { width: window.innerWidth, height: window.innerHeight };
    const previousMinimum = mode === "focus" ? new LogicalSize(340, 150) : new LogicalSize(360, 500);
    const wasCancelled = () => sequence !== closeSequence.current || !islandClosingRef.current;
    const restoreCancelledClose = async () => {
      await resizeWidget(previousSize, previousMinimum).catch(value => setError(errorMessage(value)));
      closeFinishing.current = false;
      if (islandClosingRef.current) window.setTimeout(() => void finishIslandClose(), 0);
    };
    if (mode === "focus") focusSize.current = previousSize;
    else expandedSize.current = previousSize;
    try {
      // Rust sizes the collapsed island for its docked edge and glues it there.
      await invoke("reset_today_widget_position");
      if (wasCancelled()) {
        await restoreCancelledClose();
        return;
      }
      let positionError = "";
      try {
        await invoke("reset_today_widget_position");
      } catch (value) {
        positionError = errorMessage(value);
      }
      if (wasCancelled()) {
        await restoreCancelledClose();
        return;
      }
      islandOpenRef.current = false;
      islandClosingRef.current = false;
      setIslandOpenState(false);
      setIslandClosing(false);
      closeFinishing.current = false;
      setClock(new Date());
      setError(positionError ? `Panel mengecil, tetapi gagal kembali ke atas: ${positionError}` : "");
      if (hidePanelAfterIslandClose.current) {
        hidePanelAfterIslandClose.current = false;
        try {
          await panelWindow?.hide();
        } catch (value) {
          await panelWindow?.show().catch(() => undefined);
          setError(`Workspace terbuka, tetapi panel belum bisa disembunyikan: ${errorMessage(value)}`);
          await setIslandOpen(true);
        }
      }
    } catch (value) {
      await panelWindow?.setMinSize(previousMinimum).catch(() => undefined);
      await panelWindow?.setSize(new LogicalSize(previousSize.width, previousSize.height)).catch(() => undefined);
      islandClosingRef.current = false;
      setIslandClosing(false);
      closeFinishing.current = false;
      hidePanelAfterIslandClose.current = false;
      setError(errorMessage(value) || "Panel tidak dapat diperkecil. Coba tutup kembali.");
    }
  }

  async function openMainWindow() {
    try {
      await invoke("open_main_window");
      return true;
    } catch (value) {
      setError(errorMessage(value));
      if (!islandOpenRef.current) await setIslandOpen(true);
      return false;
    }
  }

  async function changePanelMode(next: PanelMode) {
    setModeMenuOpen(false);
    if (next === currentMode.current) return;
    const previous = currentMode.current;
    if (next === "focus" && islandOpenRef.current && expandedSize.current === null) {
      expandedSize.current = { width: window.innerWidth, height: window.innerHeight };
    }
    if (previous === "focus" && islandOpenRef.current) focusSize.current = { width: window.innerWidth, height: window.innerHeight };
    if (!panelWindow || !islandOpenRef.current || (previous !== "focus" && next !== "focus")) {
      currentMode.current = next;
      setPanelMode(next);
      return;
    }
    const size = next === "focus" ? focusSize.current ?? FOCUS_WIDGET_SIZE : expandedSize.current ?? DEFAULT_WIDGET_SIZE;
    const previousSize = previous === "focus" ? focusSize.current ?? FOCUS_WIDGET_SIZE : expandedSize.current ?? DEFAULT_WIDGET_SIZE;
    const previousMinimum = previous === "focus" ? new LogicalSize(340, 150) : new LogicalSize(360, 500);
    try {
      await resizeWidget(size, next === "focus" ? new LogicalSize(340, 150) : new LogicalSize(360, 500));
      currentMode.current = next;
      setPanelMode(next);
      if (next === "focus") focusSize.current = null;
      else expandedSize.current = null;
    } catch (value) {
      await panelWindow.setMinSize(previousMinimum).catch(() => undefined);
      await panelWindow.setSize(new LogicalSize(previousSize.width, previousSize.height)).catch(() => undefined);
      setError(errorMessage(value));
    }
  }

  async function showMain() {
    if (previewMode) return;
    if (!await openMainWindow()) return;
    if (islandOpenRef.current) {
      hidePanelAfterIslandClose.current = true;
      await setIslandOpen(false);
      return;
    }
    try {
      await panelWindow?.hide();
    } catch (value) {
      await panelWindow?.show().catch(() => undefined);
      setError(`Workspace terbuka, tetapi panel belum bisa disembunyikan: ${errorMessage(value)}`);
      await setIslandOpen(true);
    }
  }

  function notifyWorkspaceMutation() {
    if (!previewMode) void emit("workspace-mutated").catch(() => undefined);
  }

  async function changeTheme(theme: Theme) {
    if (!snapshot || snapshot.theme === theme) return;
    if (previewMode) {
      setSnapshot(value => value ? { ...value, theme } : value);
      return;
    }
    try {
      await invoke("set_theme", { theme });
      await refresh();
      notifyWorkspaceMutation();
    } catch (value) {
      setError(errorMessage(value));
    }
  }

  function changeWidgetTransparency(percent: number) {
    const value = Math.max(0, Math.min(40, Math.round(percent)));
    setWidgetTransparency(value);
    if (previewMode) {
      setSnapshot(current => current ? { ...current, widgetTransparency: value } : current);
      return;
    }
    if (transparencySaveTimer.current !== null) window.clearTimeout(transparencySaveTimer.current);
    transparencySaveTimer.current = window.setTimeout(() => {
      transparencySaveTimer.current = null;
      void invoke("set_widget_transparency", { percent: value }).then(() => notifyWorkspaceMutation()).catch(failure => {
        setError(errorMessage(failure));
        void refresh();
      });
    }, 250);
  }

  function renderAppearanceControl() {
    return <div className="widget-appearance-control" ref={appearanceControlRef}>
      <button className="widget-appearance-trigger" onClick={() => setAppearanceOpen(open => !open)} aria-label="Ubah tampilan panel" aria-haspopup="dialog" aria-expanded={appearanceOpen} title="Tema dan transparansi">
        <Icon name="palette" size={15} />
      </button>
      {appearanceOpen && <div className="widget-appearance-popover" role="dialog" aria-label="Tampilan Daymark">
        <AppearancePicker compact theme={snapshot?.theme ?? "glass_dark"} transparency={widgetTransparency} onTheme={theme => { void changeTheme(theme); setAppearanceOpen(false); }} onTransparency={changeWidgetTransparency} />
      </div>}
    </div>;
  }

  function renderModePicker(compact = false) {
    const selected = panelChoices.find(choice => choice.mode === panelMode)!;
    return <div className={`widget-mode-picker${compact ? " compact" : ""}`} ref={modePickerRef} onBlur={event => {
      if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setModeMenuOpen(false);
    }}>
      <button ref={modePickerTriggerRef} className="widget-mode-picker-trigger" onClick={() => setModeMenuOpen(open => !open)} aria-label={`Tampilan ${selected.label}. Buka pilihan tampilan.`} aria-expanded={modeMenuOpen} aria-controls={modeMenuOpen ? "widget-mode-options" : undefined} title="Pilih tampilan panel">
        <Icon name={selected.icon} size={compact ? 12 : 15} />
        <span>{selected.label}</span>
        <Icon className="widget-mode-picker-chevron" name="chevron" size={12} />
      </button>
      {modeMenuOpen && <div id="widget-mode-options" className="widget-mode-menu" role="group" aria-label="Pilih tampilan panel">
        {panelChoices.map(choice => <button key={choice.mode} className={`widget-mode-option${panelMode === choice.mode ? " active" : ""}${choice.mode === "rest" ? " rest-choice" : ""}`} onClick={() => {
          setModeMenuOpen(false);
          if (choice.mode === "rest") void setIslandOpen(false);
          else void changePanelMode(choice.mode);
        }} aria-pressed={choice.mode === "rest" ? undefined : panelMode === choice.mode} title={choice.mode === "rest" ? "Kecilkan panel kembali ke Dynamic Island" : undefined}>
          <span className="widget-mode-option-icon"><Icon name={choice.icon} size={compact ? 12 : 14} /></span>
          <span>{choice.label}</span>
          {panelMode === choice.mode && <Icon className="widget-mode-option-check" name="check" size={13} />}
        </button>)}
      </div>}
    </div>;
  }

  async function completeTask(task: Task) {
    if (previewMode) {
      setSnapshot(value => value ? {
        ...value,
        tasks: value.tasks.map(item => item.id === task.id ? { ...item, status: "done", completedAt: new Date().toISOString() } : item),
      } : value);
      return;
    }
    try {
      await invoke("set_task_done", { id: task.id, done: true });
      await refresh();
      notifyWorkspaceMutation();
    } catch (value) {
      setError(errorMessage(value));
    }
  }

  async function saveTask(task: Task, draft: TaskDraft, notes: string) {
    if (previewMode) {
      setSnapshot(value => value ? {
        ...value,
        tasks: value.tasks.map(item => item.id === task.id ? {
          ...item,
          ...draft,
          recurrenceRule: draft.recurrenceRule ? JSON.stringify(draft.recurrenceRule) : null,
          notes,
        } : item),
      } : value);
      return;
    }
    await invoke("update_task", { id: task.id, task: draft });
    await invoke("save_task_note", { id: task.id, markdown: notes });
    await refresh();
    notifyWorkspaceMutation();
  }

  async function createTask(draft: TaskDraft, notes: string) {
    if (previewMode) {
      const now = new Date().toISOString();
      const id = `preview-${Date.now()}`;
      const task: Task = {
        id,
        seriesId: draft.recurrenceRule ? id : null,
        title: draft.title,
        status: "open",
        priority: draft.priority,
        dueAt: draft.dueAt,
        remindAt: null,
        reminderOffsetMinutes: draft.reminderOffsetMinutes,
        recurrenceRule: draft.recurrenceRule ? JSON.stringify(draft.recurrenceRule) : null,
        rolloverCount: 0,
        parentId: draft.parentId,
        projectId: draft.projectId,
        sortOrder: 0,
        notes,
        tags: draft.tags,
        createdAt: now,
        updatedAt: now,
        completedAt: null,
      };
      setSnapshot(value => value ? { ...value, tasks: [task, ...value.tasks] } : value);
      return;
    }
    await invoke("create_task", { task: { ...draft, notes: notes || null } });
    await refresh();
    notifyWorkspaceMutation();
  }

  async function createSubtask(parent: Task, title: string) {
    if (previewMode) return;
    await invoke("create_task", { task: {
      title,
      priority: parent.priority,
      dueAt: null,
      reminderOffsetMinutes: null,
      recurrenceRule: null,
      parentId: parent.id,
      projectId: parent.projectId,
      tags: [],
    } });
    await refresh();
    notifyWorkspaceMutation();
  }

  async function togglePin() {
    if (!panelWindow) {
      setPinned(value => !value);
      return;
    }
    try {
      await panelWindow.setAlwaysOnTop(!pinned);
      setPinned(value => !value);
    } catch (value) {
      setError(errorMessage(value));
    }
  }

  function applyResize(origin: NonNullable<typeof resizeOrigin.current>) {
    if (!panelWindow || !origin.ready) return;
    origin.dirty = true;
    if (origin.applying) return;
    origin.applying = true;
    void (async () => {
      while (origin.dirty) {
        origin.dirty = false;
        const width = Math.max(origin.minWidth, Math.round(origin.width + origin.lastX - origin.startX));
        const height = Math.max(origin.minHeight, Math.round(origin.height + origin.lastY - origin.startY));
        const left = Math.round(origin.centerX - width * origin.scale / 2);
        try {
          await Promise.all([
            panelWindow.setSize(new LogicalSize(width, height)),
            panelWindow.setPosition(new PhysicalPosition(left, origin.top)),
          ]);
        } catch (value) {
          setError(errorMessage(value));
          break;
        }
      }
      origin.applying = false;
    })();
  }

  async function startResize(event: ReactPointerEvent<HTMLButtonElement>) {
    if (!panelWindow || event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    const minimum = currentMode.current === "focus" ? { minWidth: 340, minHeight: 150 } : { minWidth: 360, minHeight: 500 };
    const origin = {
      pointerId: event.pointerId,
      startX: event.screenX,
      startY: event.screenY,
      lastX: event.screenX,
      lastY: event.screenY,
      width: window.innerWidth,
      height: window.innerHeight,
      ...minimum,
      scale: 1,
      centerX: 0,
      top: 0,
      ready: false,
      ended: false,
      applying: false,
      dirty: false,
    };
    resizeOrigin.current = origin;
    event.currentTarget.setPointerCapture(event.pointerId);
    try {
      const [scale, position, size] = await Promise.all([panelWindow.scaleFactor(), panelWindow.outerPosition(), panelWindow.outerSize()]);
      origin.scale = scale;
      origin.centerX = position.x + size.width / 2;
      origin.top = position.y;
      origin.ready = true;
      if (resizeOrigin.current === origin) {
        if (origin.ended) resizeOrigin.current = null;
        applyResize(origin);
      }
    } catch (value) {
      setError(errorMessage(value));
    }
  }

  function moveResizedWindow(event: ReactPointerEvent<HTMLButtonElement>) {
    const origin = resizeOrigin.current;
    if (!panelWindow || !origin || origin.pointerId !== event.pointerId) return;
    origin.lastX = event.screenX;
    origin.lastY = event.screenY;
    applyResize(origin);
  }

  function stopResizing(event: ReactPointerEvent<HTMLButtonElement>) {
    const origin = resizeOrigin.current;
    if (origin?.pointerId !== event.pointerId) return;
    origin.lastX = event.screenX;
    origin.lastY = event.screenY;
    origin.ended = true;
    if (origin.ready) {
      resizeOrigin.current = null;
      applyResize(origin);
    }
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  }

  async function startDragging(event: ReactPointerEvent<HTMLElement>) {
    if (!panelWindow || positionFrozen || event.button !== 0) return;
    if (event.target instanceof Element && event.target.closest("button, select, input, [role=button]")) return;
    event.preventDefault();
    const origin = { pointerId: event.pointerId, startX: event.screenX, startY: event.screenY, lastX: event.screenX, lastY: event.screenY, position: null as { x: number; y: number } | null, scale: 1, ended: false };
    dragOrigin.current = origin;
    event.currentTarget.setPointerCapture(event.pointerId);
    try {
      const [position, scale] = await Promise.all([panelWindow.outerPosition(), panelWindow.scaleFactor()]);
      if (dragOrigin.current === origin) {
        origin.position = position;
        origin.scale = scale;
        if (origin.ended) {
          dragOrigin.current = null;
          void panelWindow.setPosition(new PhysicalPosition(
            position.x + Math.round((origin.lastX - origin.startX) * scale),
            position.y + Math.round((origin.lastY - origin.startY) * scale),
          )).catch(error => setError(errorMessage(error)));
        }
      }
    } catch (value) {
      dragOrigin.current = null;
      setError(errorMessage(value));
    }
  }

  function moveDraggedWindow(event: ReactPointerEvent<HTMLElement>) {
    const origin = dragOrigin.current;
    if (!panelWindow || !origin || origin.pointerId !== event.pointerId) return;
    origin.lastX = event.screenX;
    origin.lastY = event.screenY;
    if (!origin.position) return;
    void panelWindow.setPosition(new PhysicalPosition(
      origin.position.x + Math.round((event.screenX - origin.startX) * origin.scale),
      origin.position.y + Math.round((event.screenY - origin.startY) * origin.scale),
    )).catch(value => setError(errorMessage(value)));
  }

  function stopDragging(event: ReactPointerEvent<HTMLElement>) {
    const origin = dragOrigin.current;
    if (origin?.pointerId !== event.pointerId) return;
    origin.lastX = event.screenX;
    origin.lastY = event.screenY;
    origin.ended = true;
    if (origin.position) dragOrigin.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  }

  function deferUpdate() {
    setAvailableUpdate(null);
    setUpdateError("");
    void updateHandle.current?.close().catch(() => undefined);
    updateHandle.current = null;
  }

  async function installUpdate() {
    if (!updateHandle.current || updateBusy) return;
    setUpdateBusy(true);
    setUpdateError("");
    try {
      await updateHandle.current.downloadAndInstall();
      await relaunch();
    } catch (value) {
      setUpdateError(`Pembaruan gagal dipasang: ${errorMessage(value)}`);
      setUpdateBusy(false);
    }
  }

  function renderUpdateNotice() {
    if (!availableUpdate) return null;
    return <aside className="widget-update-banner" role="status" aria-live="polite">
      <span className="widget-update-icon"><Icon name="spark" size={14} /></span>
      <div className="widget-update-copy">
        <strong>Daymark {availableUpdate.version} tersedia</strong>
        <span>{updateError || availableUpdate.body || "Pasang pembaruan untuk mendapatkan perbaikan terbaru."}</span>
      </div>
      <button className="widget-update-later" onClick={deferUpdate} disabled={updateBusy}>Nanti</button>
      <button className="widget-update-install" onClick={() => void installUpdate()} disabled={updateBusy}>{updateBusy ? "Mengunduh…" : "Pasang"}</button>
    </aside>;
  }

  return (
    <div className={`today-widget-window${islandOpen && !islandClosing ? " island-expanded" : ""}`} data-edge={dockEdge}>
      <i className="widget-notch-ear left" aria-hidden="true" />
      <i className="widget-notch-ear right" aria-hidden="true" />
      <section className={`today-widget-shell${islandOpen ? " widget-shell-expanded" : ""}${islandClosing ? " widget-shell-closing" : ""}`} onTransitionEnd={event => {
        if (event.target === event.currentTarget && event.propertyName === "height" && islandClosingRef.current) void finishIslandClose();
      }}>
      <button className="widget-rest-island" onClick={clickIsland} onPointerDown={event => void startIslandDrag(event)} onPointerMove={moveIslandDrag} onPointerUp={event => void endIslandDrag(event)} onPointerCancel={event => void endIslandDrag(event)} title="Klik untuk buka · seret ke atas/kiri/kanan layar · klik 3x untuk ke tengah" aria-label="Buka panel Daymark" aria-hidden={islandOpen && !islandClosing} tabIndex={islandOpen && !islandClosing ? -1 : 0}>
        <span className="widget-rest-face" aria-hidden="true">
          <span className="widget-rest-clock">{clock.toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit" })}</span>
          <span className="widget-rest-eyes"><i /><i /></span>
        </span>
        <span className="widget-rest-copy"><strong>daymark</strong><small>Hari ini · {todayTasks.length} tugas</small></span>
        {overdue.length > 0 && <span className="widget-rest-count" aria-label={`${overdue.length} tugas perlu ditinjau`}>{overdue.length}</span>}
      </button>
      {islandOpen && (panelMode === "focus" ? (
      <div className="widget-panel-content widget-focus-content-shell">
        <header className={`widget-focus-header${positionFrozen ? " position-frozen" : ""}`} onPointerDown={event => void startDragging(event)} onPointerMove={moveDraggedWindow} onPointerUp={stopDragging} onPointerCancel={stopDragging}>
          <span><Icon name="target" size={14} /> Fokus tugas</span>
          <div>
            {renderModePicker(true)}
            <button className={`widget-pin${pinned ? " pinned" : ""}`} onClick={() => void togglePin()} aria-label={pinned ? "Lepas sematan panel" : "Sematkan panel di atas"} aria-pressed={pinned} title={pinned ? "Tersemat di atas · klik untuk lepas" : "Sematkan di atas jendela lain"}><Icon name="pin" size={13} /></button>
            <button className={`widget-freeze${positionFrozen ? " frozen" : ""}`} onClick={() => setPositionFrozen(value => !value)} aria-label={positionFrozen ? "Buka kunci posisi panel" : "Kunci posisi panel"} aria-pressed={positionFrozen} title={positionFrozen ? "Buka kunci agar panel bisa dipindahkan" : "Kunci agar panel tidak terseret"}><Icon name={positionFrozen ? "lock" : "unlock"} size={14} /></button>
            <button className="widget-hide" onClick={() => void setIslandOpen(false)} aria-label={islandClosing ? "Menutup panel ke Dynamic Island" : "Tutup panel kembali ke Dynamic Island"} aria-busy={islandClosing} title="Tutup ke Dynamic Island"><Icon name="close" size={14} /></button>
          </div>
        </header>
        {renderUpdateNotice()}
        {error && <div className="widget-error" role="alert"><span>{error}</span><button onClick={() => void refresh()}>Coba lagi</button></div>}
        {focusTask ? <main className="widget-focus-content">
          <article className={`widget-focus-card${focusIsOverdue ? " is-overdue" : ""}`}>
            <div className="widget-focus-card-heading">
              <span className="widget-focus-status"><Icon name={focusIsOverdue ? "clock" : "spark"} size={12} />{focusIsOverdue ? "Perlu ditinjau" : todayTasks.includes(focusTask) ? "Jadwal hari ini" : "Fokus berikutnya"}</span>
              <span className={`widget-focus-priority priority-${focusTask.priority}`}>{priorityLabel[focusTask.priority]}</span>
            </div>
            <button className="widget-focus-title" onClick={() => { setEditingTask(focusTask); setEditorOpen(true); void changePanelMode("todo"); }}>{focusTask.title}</button>
            <div className="widget-focus-card-footer">
              <span><Icon name="clock" size={12} />{focusDue}</span>
              <button className="widget-focus-complete" onClick={() => void completeTask(focusTask)}><Icon name="check" size={13} /> Selesai</button>
            </div>
          </article>
        </main> : <main className="widget-focus-empty"><span className="widget-focus-empty-icon"><Icon name="spark" size={18} /></span><strong>Tidak ada tugas terbuka.</strong><button onClick={() => void changePanelMode("todo")}>Lihat ringkasan hari ini</button></main>}
      <button className="widget-resize-handle" aria-label="Ubah ukuran panel fokus" title="Seret untuk mengubah ukuran" onPointerDown={event => void startResize(event)} onPointerMove={moveResizedWindow} onPointerUp={stopResizing} onPointerCancel={stopResizing} />
      </div>
      ) : loading ? <div className="widget-panel-content"><p className="widget-loading">Menyiapkan ringkasan hari ini…</p></div> : (
      <div className="widget-panel-content">
        <header className={`widget-header${positionFrozen ? " position-frozen" : ""}`} onPointerDown={event => void startDragging(event)} onPointerMove={moveDraggedWindow} onPointerUp={stopDragging} onPointerCancel={stopDragging}>
          <div className="widget-brand" title={positionFrozen ? "Posisi panel dikunci" : "Seret untuk memindahkan panel"}><span className="brand-mark"><Icon name="sun" size={15} /></span><strong>daymark</strong><span className="widget-brand-caption">· panel hari ini</span></div>
          <div className="widget-window-actions">
            <button className="widget-add-button" onClick={() => { setEditingTask(null); setEditorOpen(true); }} aria-label="Tambah tugas lengkap" title="Tambah tugas lengkap"><Icon name="plus" size={16} /></button>
            {renderAppearanceControl()}
            <button className={`widget-pin${pinned ? " pinned" : ""}`} onClick={() => void togglePin()} aria-label={pinned ? "Lepas sematan panel" : "Sematkan panel di atas"} aria-pressed={pinned} title={pinned ? "Tersemat di atas · klik untuk lepas" : "Sematkan di atas jendela lain"}><Icon name="pin" size={14} /></button>
            <button className={`widget-freeze${positionFrozen ? " frozen" : ""}`} onClick={() => setPositionFrozen(value => !value)} aria-label={positionFrozen ? "Buka kunci posisi panel" : "Kunci posisi panel"} aria-pressed={positionFrozen} title={positionFrozen ? "Buka kunci agar panel bisa dipindahkan" : "Kunci agar panel tidak terseret"}><Icon name={positionFrozen ? "lock" : "unlock"} size={14} /></button>
            <button className="widget-hide" onClick={() => void setIslandOpen(false)} aria-label={islandClosing ? "Menutup panel ke Dynamic Island" : "Tutup panel kembali ke Dynamic Island"} aria-busy={islandClosing} title="Tutup ke Dynamic Island"><Icon name="close" size={15} /></button>
          </div>
        </header>
        {renderUpdateNotice()}

        <main className="widget-scroll">
          {panelMode !== "calendar" && <section className="widget-greeting">
            <p className="eyebrow">{new Date().toLocaleDateString("id-ID", { weekday: "long", day: "numeric", month: "long", year: "numeric" })}</p>
            <h1>Hari ini, satu langkah dulu.</h1>
            <p>Ringkasan singkat untuk menjaga fokusmu.</p>
          </section>}

          <div className="widget-mode-toolbar">
            <span className="widget-mode-toolbar-label"><Icon name="layers" size={13} />Tampilan panel</span>
            {renderModePicker()}
          </div>

          {error && <div className="widget-error" role="alert"><span>{error}</span><button onClick={() => void refresh()}>Coba lagi</button></div>}

          {panelMode === "calendar" ? <PanelCalendar
            tasks={snapshot?.tasks ?? []}
            selectedDate={calendarDate}
            today={today}
            onSelectDate={setCalendarDate}
            onEditTask={task => { setEditingTask(task); setEditorOpen(true); }}
            onCompleteTask={task => { void completeTask(task); }}
          /> : <>
          <section className="widget-summary" aria-label="Ringkasan tugas">
            <div className="widget-stat review-stat"><strong>{String(overdue.length).padStart(2, "0")}</strong><span>perlu ditinjau</span></div>
            <div className="widget-stat today-stat"><strong>{String(todayTasks.length).padStart(2, "0")}</strong><span>jadwal hari ini</span></div>
          </section>

          <section className="widget-progress" aria-label="Progress hari ini">
            <div><span>Progress hari ini</span><strong>{completedToday}/{totalToday}</strong></div>
            <div className="widget-progress-track" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={progress}><span style={{ width: `${progress}%` }} /></div>
          </section>

          <section className="widget-section">
            <div className="widget-section-heading"><h2><Icon name="clock" size={14} />Perlu ditinjau</h2><span>{overdue.length}</span></div>
            {overdue.length === 0 ? <p className="widget-empty">Tidak ada tugas yang tertinggal.</p> : <div className="widget-task-list">{overdue.slice(0, 2).map(task => <WidgetTask key={task.id} task={task} projects={projects} overdue onComplete={completeTask} onEdit={() => { setEditingTask(task); setEditorOpen(true); }} />)}</div>}
            {overdue.length > 0 && <button className="widget-text-action" onClick={() => void showMain()}>Tinjau tugas <Icon name="arrow" size={14} /></button>}
          </section>

          <section className="widget-section today-section">
            <div className="widget-section-heading"><h2><Icon name="sun" size={14} />Hari ini</h2><span>{todayTasks.length}</span></div>
            {todayTasks.length === 0 ? <p className="widget-empty">Belum ada jadwal. Kamu bisa mulai dari satu hal kecil.</p> : <div className="widget-task-list">{todayTasks.slice(0, 5).map(task => <WidgetTask key={task.id} task={task} projects={projects} onComplete={completeTask} onEdit={() => { setEditingTask(task); setEditorOpen(true); }} />)}</div>}
            {todayTasks.length > 5 && <button className="widget-text-action" onClick={() => void showMain()}>Lihat {todayTasks.length - 5} tugas lainnya <Icon name="arrow" size={14} /></button>}
          </section>

          {unscheduledTasks.length > 0 && <section className="widget-section">
            <div className="widget-section-heading"><h2><Icon name="inbox" size={14} />Belum dijadwalkan</h2><span>{unscheduledTasks.length}</span></div>
            <div className="widget-task-list">{unscheduledTasks.slice(0, 3).map(task => <WidgetTask key={task.id} task={task} projects={projects} onComplete={completeTask} onEdit={() => { setEditingTask(task); setEditorOpen(true); }} />)}</div>
            {unscheduledTasks.length > 3 && <button className="widget-text-action" onClick={() => void showMain()}>Lihat {unscheduledTasks.length - 3} tugas lainnya <Icon name="arrow" size={14} /></button>}
          </section>}

          {pinnedNote && <section className="widget-note"><span><Icon name="pin" size={12} /> Catatan tersemat</span><strong>{pinnedNote.title}</strong><p>{pinnedNote.content || "Belum ada isi catatan."}</p></section>}
          </>}
        </main>

        <footer className="widget-footer">
          <span>{completedToday ? `${completedToday} selesai hari ini` : "Data tersimpan di perangkat ini"}</span>
          <button className="primary-button" onClick={() => void showMain()}>Buka Daymark <Icon name="arrow" size={14} /></button>
        </footer>
      {editorOpen && <TaskEditor key={editingTask?.id ?? "new"} task={editingTask} projects={projects} onClose={() => { setEditorOpen(false); setEditingTask(null); }} onSave={saveTask} onCreate={createTask} onDelete={async task => {
        if (previewMode) {
          setSnapshot(value => value ? { ...value, tasks: value.tasks.filter(item => item.id !== task.id && item.parentId !== task.id) } : value);
          return;
        }
        await invoke("delete_task", { id: task.id });
        await refresh();
        notifyWorkspaceMutation();
      }} onCreateSubtask={createSubtask} />}
      {quickCaptureOpen && <QuickCapture onClose={() => setQuickCaptureOpen(false)} onCreate={title => createTask({ title, priority: "normal", dueAt: null, reminderOffsetMinutes: null, recurrenceRule: null, parentId: null, projectId: null, tags: [] }, "")} />}
      <button className="widget-resize-handle" aria-label="Ubah ukuran panel" title="Seret untuk memperbesar atau memperkecil panel" onPointerDown={event => void startResize(event)} onPointerMove={moveResizedWindow} onPointerUp={stopResizing} onPointerCancel={stopResizing} />
      </div>
      ))}
      </section>
    </div>
  );
}

function WidgetTask({ task, projects, overdue = false, onComplete, onEdit }: { task: Task; projects: Project[]; overdue?: boolean; onComplete: (task: Task) => void; onEdit: () => void }) {
  const project = task.projectId ? projects.find(item => item.id === task.projectId)?.name ?? "Project" : "Tanpa project";
  const due = overdue && task.dueAt
    ? `${new Date(task.dueAt).toLocaleDateString("id-ID", { day: "numeric", month: "short" })} · ${timeLabel(task.dueAt)}`
    : task.dueAt ? timeLabel(task.dueAt) : "Belum dijadwalkan";
  return (
    <article className={`widget-task${overdue ? " overdue" : ""}`}>
      <button className="task-check" aria-label={`Selesaikan: ${task.title}`} title="Tandai selesai" onClick={() => onComplete(task)} />
      <span className={`widget-priority priority-${task.priority}`} />
      <div><button className="widget-task-title" onClick={onEdit}>{task.title}</button><span>{overdue ? `Lewat · ${due}` : due} · {project}</span></div>
    </article>
  );
}

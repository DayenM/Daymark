import { useMemo, useState, type CSSProperties, type FormEvent } from "react";
import type { Task } from "../types";
import { calendarGridDays, dayKey, groupTasksByDay, shiftCalendarMonth } from "../calendar";
import { Icon } from "./Icon";

const weekdays = ["Sen", "Sel", "Rab", "Kam", "Jum", "Sab", "Min"];
const MIN_SCALE = .6;
const MAX_SCALE = 1.8;
const SCALE_KEY = "daymark.calendarScale";

function clampScale(value: number) {
  return Math.round(Math.min(MAX_SCALE, Math.max(MIN_SCALE, value)) * 100) / 100;
}

function savedScale() {
  try {
    const value = Number(localStorage.getItem(SCALE_KEY));
    return value ? clampScale(value) : 1;
  } catch {
    return 1;
  }
}

function timeOf(task: Task) {
  return task.dueAt ? new Date(task.dueAt).toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit" }) : "";
}

// Open tasks first, then by time; done tasks sink to the bottom of each day.
function byDayOrder(left: Task, right: Task) {
  if (left.status !== right.status) return left.status === "open" ? -1 : 1;
  return (left.dueAt ?? "").localeCompare(right.dueAt ?? "");
}

// Read-at-a-glance month board: every task of every day is visible without clicking.
export function CalendarPage({ tasks, onEdit, onCreate }: { tasks: Task[]; onEdit: (task: Task) => void; onCreate: (title: string, due: string) => Promise<void> }) {
  const today = dayKey(new Date());
  const [month, setMonth] = useState(() => new Date());
  const [scale, setScale] = useState(savedScale);
  const [addingDay, setAddingDay] = useState<string | null>(null);
  const [draftTitle, setDraftTitle] = useState("");
  const [draftTime, setDraftTime] = useState("09:00");
  const [saving, setSaving] = useState(false);

  function startAdding(key: string) {
    setAddingDay(key);
    setDraftTitle("");
    setDraftTime("09:00");
  }

  async function submitDraft(event: FormEvent, key: string) {
    event.preventDefault();
    if (!draftTitle.trim() || saving) return;
    setSaving(true);
    try {
      await onCreate(draftTitle.trim(), `${key}T${draftTime || "09:00"}`);
      setAddingDay(null);
    } finally {
      setSaving(false);
    }
  }

  function changeScale(value: number) {
    const next = clampScale(value);
    setScale(next);
    try { localStorage.setItem(SCALE_KEY, String(next)); } catch { /* size is only a convenience */ }
  }
  const byDay = useMemo(() => groupTasksByDay(tasks.filter(task => !task.parentId)), [tasks]);
  const days = calendarGridDays(month);
  // Drop the 6th week when it belongs entirely to the next month.
  const visibleDays = days[35].getMonth() !== month.getMonth() ? days.slice(0, 35) : days;
  const monthLabel = month.toLocaleDateString("id-ID", { month: "long", year: "numeric" });

  return (
    <section className="calendar-board glass-panel" style={{ "--cal-scale": scale } as CSSProperties}>
      <header className="calendar-board-header">
        <h2>{monthLabel}</h2>
        <div className="calendar-board-nav">
          <div className="calendar-zoom" role="group" aria-label="Ukuran tampilan kalender" title="Ukuran tampilan kalender: geser bebas, perkecil untuk melihat lebih banyak, perbesar agar tulisan lebih mudah dibaca">
            <span className="calendar-zoom-label">Ukuran</span>
            <button className="icon-button" onClick={() => changeScale(scale - .05)} disabled={scale <= MIN_SCALE} aria-label="Perkecil kalender" title="Perkecil kalender">−</button>
            <input type="range" min={MIN_SCALE} max={MAX_SCALE} step=".01" value={scale} onChange={event => changeScale(Number(event.target.value))} aria-label="Geser untuk mengatur ukuran kalender" aria-valuetext={`${Math.round(scale * 100)} persen`} />
            <button className="icon-button" onClick={() => changeScale(scale + .05)} disabled={scale >= MAX_SCALE} aria-label="Perbesar kalender" title="Perbesar kalender">+</button>
            <button className="calendar-zoom-value" onClick={() => changeScale(1)} title="Klik untuk kembali ke ukuran normal (100%)" aria-label={`Ukuran ${Math.round(scale * 100)} persen, klik untuk reset`}>{Math.round(scale * 100)}%</button>
          </div>
          <button className="soft-button" onClick={() => setMonth(new Date())}>Hari ini</button>
          <button className="icon-button" onClick={() => setMonth(value => shiftCalendarMonth(value, -1))} aria-label="Bulan sebelumnya"><span className="flip"><Icon name="chevron" size={16} /></span></button>
          <button className="icon-button" onClick={() => setMonth(value => shiftCalendarMonth(value, 1))} aria-label="Bulan berikutnya"><Icon name="chevron" size={16} /></button>
        </div>
      </header>
      <div className="calendar-weekdays" aria-hidden="true">{weekdays.map(day => <span key={day}>{day}</span>)}</div>
      <div className="calendar-grid">
        {visibleDays.map(day => {
          const key = dayKey(day);
          const dayTasks = [...(byDay.get(key) ?? [])].sort(byDayOrder);
          const classes = ["calendar-cell", day.getMonth() !== month.getMonth() && "outside", key === today && "today", key < today && "past"].filter(Boolean).join(" ");
          return (
            <div key={key} className={classes} aria-label={day.toLocaleDateString("id-ID", { weekday: "long", day: "numeric", month: "long" })}>
              <span className="calendar-cell-date">{day.getDate()}</span>
              {addingDay !== key && <button className="calendar-add" onClick={() => startAdding(key)} aria-label={`Tambah tugas ${day.toLocaleDateString("id-ID", { day: "numeric", month: "long" })}`} title="Tambah tugas di tanggal ini"><Icon name="plus" size={13} /></button>}
              {dayTasks.map(task => {
                const late = key < today && task.status === "open";
                return (
                  <button key={task.id} className={`calendar-task priority-${task.priority}${task.status === "done" ? " done" : ""}${late ? " late" : ""}`} onClick={() => onEdit(task)} title={`${timeOf(task)} · ${task.title}`}>
                    <time>{timeOf(task)}</time>
                    <span>{task.title}</span>
                  </button>
                );
              })}
              {addingDay === key && (
                <form className="calendar-add-form" onSubmit={event => void submitDraft(event, key)} onKeyDown={event => { if (event.key === "Escape") setAddingDay(null); }}>
                  <input autoFocus value={draftTitle} onChange={event => setDraftTitle(event.target.value)} placeholder="Tugas baru…" maxLength={240} aria-label="Judul tugas baru" />
                  <div>
                    <input type="time" value={draftTime} onChange={event => setDraftTime(event.target.value)} aria-label="Jam tugas" />
                    <button type="button" className="calendar-add-cancel" onClick={() => setAddingDay(null)} aria-label="Batal">×</button>
                    <button className="calendar-add-save" disabled={!draftTitle.trim() || saving} aria-label="Simpan tugas"><Icon name="check" size={13} /></button>
                  </div>
                </form>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}

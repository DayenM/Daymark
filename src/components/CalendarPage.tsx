import { useMemo, useState, type CSSProperties } from "react";
import type { Task } from "../types";
import { calendarGridDays, dayKey, groupTasksByDay, shiftCalendarMonth } from "../calendar";
import { Icon } from "./Icon";

const weekdays = ["Sen", "Sel", "Rab", "Kam", "Jum", "Sab", "Min"];
const SCALES = [.85, 1, 1.15, 1.3];
const SCALE_KEY = "daymark.calendarScale";

function savedScale() {
  try {
    const value = Number(localStorage.getItem(SCALE_KEY));
    return SCALES.includes(value) ? value : 1;
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
export function CalendarPage({ tasks, onEdit }: { tasks: Task[]; onEdit: (task: Task) => void }) {
  const today = dayKey(new Date());
  const [month, setMonth] = useState(() => new Date());
  const [scale, setScale] = useState(savedScale);
  const step = SCALES.indexOf(scale);

  function changeScale(offset: number) {
    const next = SCALES[Math.min(SCALES.length - 1, Math.max(0, step + offset))];
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
          <div className="calendar-zoom" role="group" aria-label="Ukuran tampilan kalender" title="Ukuran tampilan kalender: perkecil untuk melihat lebih banyak, perbesar agar tulisan lebih mudah dibaca">
            <span className="calendar-zoom-label">Ukuran</span>
            <button className="icon-button" onClick={() => changeScale(-1)} disabled={step === 0} aria-label="Perkecil kalender" title="Perkecil kalender">−</button>
            <output aria-live="polite">{Math.round(scale * 100)}%</output>
            <button className="icon-button" onClick={() => changeScale(1)} disabled={step === SCALES.length - 1} aria-label="Perbesar kalender" title="Perbesar kalender">+</button>
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
              {dayTasks.map(task => {
                const late = key < today && task.status === "open";
                return (
                  <button key={task.id} className={`calendar-task priority-${task.priority}${task.status === "done" ? " done" : ""}${late ? " late" : ""}`} onClick={() => onEdit(task)} title={`${timeOf(task)} · ${task.title}`}>
                    <time>{timeOf(task)}</time>
                    <span>{task.title}</span>
                  </button>
                );
              })}
            </div>
          );
        })}
      </div>
    </section>
  );
}

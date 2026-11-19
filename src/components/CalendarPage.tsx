import { useMemo, useState, type FormEvent } from "react";
import type { Task } from "../types";
import { calendarGridDays, dayKey, groupTasksByDay, shiftCalendarMonth } from "../calendar";
import { Icon } from "./Icon";
import { TaskRow } from "./TaskRow";

const weekdays = ["Sen", "Sel", "Rab", "Kam", "Jum", "Sab", "Min"];
const CHIP_LIMIT = 3;

function timeOf(task: Task) {
  return task.dueAt ? new Date(task.dueAt).toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit" }) : "";
}

// Open tasks first, then by time; done tasks sink to the bottom of each day.
function byDayOrder(left: Task, right: Task) {
  if (left.status !== right.status) return left.status === "open" ? -1 : 1;
  return (left.dueAt ?? "").localeCompare(right.dueAt ?? "");
}

export function CalendarPage({ tasks, onToggle, onEdit, onCreate }: {
  tasks: Task[];
  onToggle: (task: Task) => void;
  onEdit: (task: Task) => void;
  onCreate: (title: string, due: string) => Promise<void>;
}) {
  const today = dayKey(new Date());
  const [month, setMonth] = useState(() => new Date());
  const [selected, setSelected] = useState(today);
  const [title, setTitle] = useState("");
  const byDay = useMemo(() => groupTasksByDay(tasks.filter(task => !task.parentId)), [tasks]);
  const days = calendarGridDays(month);
  const selectedTasks = [...(byDay.get(selected) ?? [])].sort(byDayOrder);
  const selectedDate = new Date(`${selected}T12:00:00`);
  const monthLabel = month.toLocaleDateString("id-ID", { month: "long", year: "numeric" });

  function goToday() {
    setMonth(new Date());
    setSelected(today);
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!title.trim()) return;
    await onCreate(title.trim(), `${selected}T09:00`);
    setTitle("");
  }

  return (
    <section className="calendar-page">
      <div className="calendar-board glass-panel">
        <header className="calendar-board-header">
          <h2>{monthLabel}</h2>
          <div className="calendar-board-nav">
            <button className="soft-button" onClick={goToday}>Hari ini</button>
            <button className="icon-button" onClick={() => setMonth(value => shiftCalendarMonth(value, -1))} aria-label="Bulan sebelumnya"><span className="flip"><Icon name="chevron" size={16} /></span></button>
            <button className="icon-button" onClick={() => setMonth(value => shiftCalendarMonth(value, 1))} aria-label="Bulan berikutnya"><Icon name="chevron" size={16} /></button>
          </div>
        </header>
        <div className="calendar-weekdays" aria-hidden="true">{weekdays.map(day => <span key={day}>{day}</span>)}</div>
        <div className="calendar-grid" role="grid" aria-label={`Kalender ${monthLabel}`}>
          {days.map(day => {
            const key = dayKey(day);
            const dayTasks = [...(byDay.get(key) ?? [])].sort(byDayOrder);
            const open = dayTasks.filter(task => task.status === "open").length;
            const classes = ["calendar-cell", day.getMonth() !== month.getMonth() && "outside", key === today && "today", key === selected && "selected", key < today && open > 0 && "has-overdue"].filter(Boolean).join(" ");
            return (
              <button key={key} className={classes} onClick={() => setSelected(key)} aria-pressed={key === selected} aria-label={`${day.toLocaleDateString("id-ID", { weekday: "long", day: "numeric", month: "long" })}, ${dayTasks.length} tugas`}>
                <span className="calendar-cell-date">{day.getDate()}{key === today && <em>Hari ini</em>}</span>
                {dayTasks.slice(0, CHIP_LIMIT).map(task => (
                  <span key={task.id} className={`calendar-chip priority-${task.priority}${task.status === "done" ? " done" : ""}`}>
                    <time>{timeOf(task)}</time><span>{task.title}</span>
                  </span>
                ))}
                {dayTasks.length > CHIP_LIMIT && <span className="calendar-more">+{dayTasks.length - CHIP_LIMIT} lainnya</span>}
              </button>
            );
          })}
        </div>
      </div>

      <aside className="calendar-day glass-panel" aria-label="Tugas tanggal terpilih">
        <header className="calendar-day-header">
          <p className="eyebrow">{selected === today ? "Hari ini" : selected < today ? "Sudah lewat" : "Mendatang"}</p>
          <h2>{selectedDate.toLocaleDateString("id-ID", { weekday: "long", day: "numeric", month: "long" })}</h2>
          <span>{selectedTasks.filter(task => task.status === "open").length} terbuka · {selectedTasks.filter(task => task.status === "done").length} selesai</span>
        </header>
        <div className="calendar-day-list">
          {selectedTasks.length === 0
            ? <p className="empty-section">Belum ada tugas di tanggal ini.</p>
            : selectedTasks.map(task => <TaskRow key={task.id} task={task} children={tasks.filter(child => child.parentId === task.id)} overdue={selected < today && task.status === "open"} onToggle={onToggle} onEdit={onEdit} />)}
        </div>
        <form className="calendar-day-add" onSubmit={event => void submit(event)}>
          <Icon name="plus" size={15} />
          <input value={title} onChange={event => setTitle(event.target.value)} placeholder="Tambah tugas di tanggal ini…" maxLength={240} aria-label="Judul tugas baru" />
          <button className="primary-button" disabled={!title.trim()}>Tambah</button>
        </form>
      </aside>
    </section>
  );
}

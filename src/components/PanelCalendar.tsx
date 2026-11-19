import { useMemo } from "react";
import type { Task } from "../types";
import { calendarGridDays, dayKey, groupTasksByDay, shiftCalendarMonth } from "../calendar";
import { Icon } from "./Icon";

const weekdays = ["Sen", "Sel", "Rab", "Kam", "Jum", "Sab", "Min"];
const priorityOrder: Record<Task["priority"], number> = { urgent: 0, high: 1, normal: 2, low: 3 };

type PanelCalendarProps = {
  tasks: Task[];
  selectedDate: Date;
  today: string;
  onSelectDate: (date: Date) => void;
  onEditTask: (task: Task) => void;
  onCompleteTask: (task: Task) => void;
};

export function PanelCalendar({ tasks, selectedDate, today, onSelectDate, onEditTask, onCompleteTask }: PanelCalendarProps) {
  const tasksByDay = useMemo(() => {
    const grouped = groupTasksByDay(tasks);
    for (const dayTasks of grouped.values()) {
      dayTasks.sort((left, right) =>
        (left.dueAt ?? "").localeCompare(right.dueAt ?? "") || priorityOrder[left.priority] - priorityOrder[right.priority],
      );
    }
    return grouped;
  }, [tasks]);
  const selectedKey = dayKey(selectedDate);
  const selectedTasks = tasksByDay.get(selectedKey) ?? [];
  const days = useMemo(() => calendarGridDays(selectedDate), [selectedDate]);
  const monthLabel = selectedDate.toLocaleDateString("id-ID", { month: "long", year: "numeric" });
  const selectedDateLabel = selectedDate.toLocaleDateString("id-ID", { weekday: "long", day: "numeric", month: "long" });
  const openCount = selectedTasks.filter(task => task.status === "open").length;

  return (
    <section className="widget-calendar-layout" aria-label="Kalender tugas">
      <div className="widget-calendar-agenda">
        <header className="widget-calendar-day-heading">
          <div>
            <strong>{selectedKey === today ? `Hari ini · ${selectedDateLabel}` : selectedDateLabel}</strong>
            <span>{selectedTasks.length ? `${openCount} belum selesai · ${selectedTasks.length - openCount} selesai` : "Tidak ada tugas"}</span>
          </div>
        </header>
        {selectedTasks.length === 0 ? (
          <p className="widget-calendar-empty">Belum ada tugas pada tanggal ini.</p>
        ) : (
          <div className="widget-calendar-events" aria-label={`${selectedTasks.length} tugas pada ${selectedDateLabel}`}>
            {selectedTasks.map(task => (
              <article key={task.id} className={`widget-calendar-task priority-${task.priority}${task.status === "done" ? " is-done" : ""}`}>
                <time className="widget-calendar-task-time">{new Date(task.dueAt!).toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit" })}</time>
                <button className="widget-calendar-task-copy" onClick={() => onEditTask(task)} title={task.title}>
                  <strong>{task.title}</strong>
                </button>
                <button
                  className="widget-calendar-task-check"
                  onClick={() => task.status === "open" && onCompleteTask(task)}
                  disabled={task.status === "done"}
                  aria-label={task.status === "done" ? `${task.title} selesai` : `Tandai ${task.title} selesai`}
                  title={task.status === "done" ? "Sudah selesai" : "Tandai selesai"}
                >
                  <Icon name="check" size={12} />
                </button>
              </article>
            ))}
          </div>
        )}
      </div>

      <div className="widget-calendar-month">
        <header className="widget-calendar-month-heading">
          <strong>{monthLabel}</strong>
          <div>
            {selectedKey !== today && <button className="widget-calendar-today" onClick={() => onSelectDate(new Date())} title="Kembali ke hari ini">Hari ini</button>}
            <button onClick={() => onSelectDate(shiftCalendarMonth(selectedDate, -1))} aria-label="Bulan sebelumnya" title="Bulan sebelumnya">
              <Icon name="chevron" size={14} className="widget-calendar-chevron previous" />
            </button>
            <button onClick={() => onSelectDate(shiftCalendarMonth(selectedDate, 1))} aria-label="Bulan berikutnya" title="Bulan berikutnya">
              <Icon name="chevron" size={14} className="widget-calendar-chevron" />
            </button>
          </div>
        </header>
        <div className="widget-calendar-grid widget-calendar-weekdays" aria-hidden="true">
          {weekdays.map(weekday => <span key={weekday}>{weekday}</span>)}
        </div>
        <div className="widget-calendar-grid widget-calendar-days">
          {days.map(date => {
            const key = dayKey(date);
            const count = tasksByDay.get(key)?.length ?? 0;
            const isSelected = key === selectedKey;
            const isToday = key === today;
            const inMonth = date.getMonth() === selectedDate.getMonth();
            const label = `${date.toLocaleDateString("id-ID", { weekday: "long", day: "numeric", month: "long", year: "numeric" })}${count ? `, ${count} tugas` : ", tidak ada tugas"}`;
            return (
              <button
                key={key}
                className={`widget-calendar-day${isSelected ? " selected" : ""}${isToday ? " today" : ""}${inMonth ? "" : " outside-month"}${count ? " has-tasks" : ""}`}
                onClick={() => onSelectDate(date)}
                aria-label={label}
                aria-pressed={isSelected}
                aria-current={isToday ? "date" : undefined}
              >
                <span>{date.getDate()}</span>
                {count > 0 && <i aria-hidden="true" />}
              </button>
            );
          })}
        </div>
      </div>
    </section>
  );
}

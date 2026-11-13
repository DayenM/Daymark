import { useEffect, useRef, useState, type WheelEvent } from "react";
import { Icon } from "./Icon";

const weekdays = ["Sen", "Sel", "Rab", "Kam", "Jum", "Sab", "Min"];

function dateKey(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function parseDate(value: string) {
  const [year, month, day] = value.split("-").map(Number);
  return new Date(year, month - 1, day, 12);
}

export function DateTimePicker({
  value,
  onChange,
  label = "Jadwal tugas",
  compact = false,
}: {
  value: string;
  onChange: (value: string) => void;
  label?: string;
  compact?: boolean;
}) {
  const rootRef = useRef<HTMLDivElement>(null);
  const lastWheelRef = useRef(0);
  const [open, setOpen] = useState(false);
  const [date, time = ""] = value.split("T");
  const selectedDate = date ? parseDate(date) : null;
  const [month, setMonth] = useState(() => {
    const current = selectedDate ?? new Date();
    return new Date(current.getFullYear(), current.getMonth(), 1, 12);
  });

  useEffect(() => {
    if (!open) return;
    function closeOutside(event: PointerEvent) {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    }
    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }
    document.addEventListener("pointerdown", closeOutside);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOutside);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [open]);

  function showCalendar() {
    const current = selectedDate ?? new Date();
    setMonth(new Date(current.getFullYear(), current.getMonth(), 1, 12));
    setOpen(currentOpen => !currentOpen);
  }

  function moveMonth(offset: number) {
    setMonth(current => new Date(current.getFullYear(), current.getMonth() + offset, 1, 12));
  }

  function handleCalendarWheel(event: WheelEvent<HTMLElement>) {
    event.preventDefault();
    event.stopPropagation();
    if (Math.abs(event.deltaY) < 8 || Date.now() - lastWheelRef.current < 180) return;
    lastWheelRef.current = Date.now();
    moveMonth(event.deltaY > 0 ? 1 : -1);
  }

  function selectDate(nextDate: Date) {
    onChange(`${dateKey(nextDate)}T${time || "09:00"}`);
    setOpen(false);
  }

  function selectToday() {
    const today = new Date();
    setMonth(new Date(today.getFullYear(), today.getMonth(), 1, 12));
    selectDate(today);
  }

  const firstDay = new Date(month.getFullYear(), month.getMonth(), 1, 12);
  const gridStart = new Date(firstDay);
  gridStart.setDate(firstDay.getDate() - ((firstDay.getDay() + 6) % 7));
  const days = Array.from({ length: 42 }, (_, index) => {
    const day = new Date(gridStart);
    day.setDate(gridStart.getDate() + index);
    return day;
  });
  const monthLabel = new Intl.DateTimeFormat("id-ID", { month: "long", year: "numeric" }).format(month);
  const todayKey = dateKey(new Date());

  return (
    <div ref={rootRef} className={`datetime-picker${compact ? " compact" : ""}${open ? " is-open" : ""}`}>
      <div className="datetime-controls">
        <button type="button" className="datetime-date" onClick={showCalendar} aria-label={`${label}: ${selectedDate ? new Intl.DateTimeFormat("id-ID", { dateStyle: "medium" }).format(selectedDate) : "pilih tanggal"}`} aria-haspopup="dialog" aria-expanded={open}>
          <Icon name="calendar" size={14} />
          <span>{selectedDate ? new Intl.DateTimeFormat("id-ID", { day: "numeric", month: "short", year: "numeric" }).format(selectedDate) : "Pilih tanggal"}</span>
        </button>
        <label className="datetime-time" aria-label={`${label}, waktu`}>
          <Icon name="clock" size={14} />
          <input type="time" value={time} disabled={!date} required={Boolean(date)} step={60} aria-label={`${label}, waktu`} onChange={event => onChange(date ? `${date}T${event.target.value}` : "")} />
        </label>
        {date && <button type="button" className="datetime-clear" onClick={() => onChange("")} aria-label={`Hapus ${label}`}><Icon name="close" size={13} /></button>}
      </div>

      {open && (
        <section className="date-popover glass-panel" role="dialog" aria-label="Pilih tanggal" onWheel={handleCalendarWheel}>
          <header className="date-popover-header">
            <button type="button" className="date-month-nav" onClick={() => moveMonth(-1)} aria-label="Bulan sebelumnya">‹</button>
            <strong>{monthLabel}</strong>
            <button type="button" className="date-month-nav" onClick={() => moveMonth(1)} aria-label="Bulan berikutnya">›</button>
          </header>
          <div className="date-weekdays" aria-hidden="true">{weekdays.map(day => <span key={day}>{day}</span>)}</div>
          <div className="date-days">
            {days.map(day => {
              const key = dateKey(day);
              const outsideMonth = day.getMonth() !== month.getMonth();
              return <button key={key} type="button" className={`date-day${outsideMonth ? " outside" : ""}${key === date ? " selected" : ""}${key === todayKey ? " today" : ""}`} aria-pressed={key === date} aria-label={new Intl.DateTimeFormat("id-ID", { dateStyle: "full" }).format(day)} onClick={() => selectDate(day)}>{day.getDate()}</button>;
            })}
          </div>
          <footer className="date-popover-footer">
            <span>Gulir untuk pindah bulan</span>
            <button type="button" onClick={selectToday}>Hari ini</button>
          </footer>
        </section>
      )}
    </div>
  );
}

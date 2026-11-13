export function dayKey(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

export function calendarGridDays(anchor: Date) {
  const firstOfMonth = new Date(anchor.getFullYear(), anchor.getMonth(), 1);
  const mondayOffset = (firstOfMonth.getDay() + 6) % 7;
  return Array.from({ length: 42 }, (_, index) =>
    new Date(anchor.getFullYear(), anchor.getMonth(), index - mondayOffset + 1),
  );
}

export function groupTasksByDay<T extends { dueAt: string | null }>(tasks: T[]) {
  const grouped = new Map<string, T[]>();
  for (const task of tasks) {
    if (!task.dueAt) continue;
    const date = new Date(task.dueAt);
    if (Number.isNaN(date.getTime())) continue;
    const key = dayKey(date);
    const dayTasks = grouped.get(key) ?? [];
    dayTasks.push(task);
    grouped.set(key, dayTasks);
  }
  return grouped;
}

export function shiftCalendarMonth(date: Date, offset: number) {
  const targetMonth = new Date(date.getFullYear(), date.getMonth() + offset, 1);
  const lastDay = new Date(targetMonth.getFullYear(), targetMonth.getMonth() + 1, 0).getDate();
  return new Date(targetMonth.getFullYear(), targetMonth.getMonth(), Math.min(date.getDate(), lastDay));
}

export function isoWeekNumber(date: Date) {
  const weekDate = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const weekday = weekDate.getUTCDay() || 7;
  weekDate.setUTCDate(weekDate.getUTCDate() + 4 - weekday);
  const yearStart = new Date(Date.UTC(weekDate.getUTCFullYear(), 0, 1));
  return Math.ceil(((weekDate.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
}

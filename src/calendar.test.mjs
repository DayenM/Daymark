import assert from "node:assert/strict";
import { test } from "node:test";

const { calendarGridDays, dayKey, groupTasksByDay, isoWeekNumber, shiftCalendarMonth } = await import("./calendar.ts");

test("calendar grid starts on Monday and always contains six complete weeks", () => {
  const days = calendarGridDays(new Date(2026, 10, 12));

  assert.equal(days.length, 42);
  assert.equal(days[0].getDay(), 1);
  assert.equal(dayKey(days[6]), "2026-11-01");
  assert.equal(dayKey(days[35]), "2026-11-30");
});

test("month navigation clamps the selected day to the target month's last day", () => {
  assert.equal(dayKey(shiftCalendarMonth(new Date(2026, 2, 31), -1)), "2026-02-28");
});

test("tasks group by local due date while unscheduled and invalid dates are ignored", () => {
  const morning = new Date(2026, 10, 12, 9);
  const afternoon = new Date(2026, 10, 12, 14);
  const nextDay = new Date(2026, 10, 13, 10);
  const grouped = groupTasksByDay([
    { id: "morning", dueAt: morning.toISOString() },
    { id: "afternoon", dueAt: afternoon.toISOString() },
    { id: "next-day", dueAt: nextDay.toISOString() },
    { id: "unscheduled", dueAt: null },
    { id: "invalid", dueAt: "not-a-date" },
  ]);

  assert.deepEqual(grouped.get(dayKey(morning))?.map(task => task.id), ["morning", "afternoon"]);
  assert.deepEqual(grouped.get(dayKey(nextDay))?.map(task => task.id), ["next-day"]);
  assert.equal(grouped.size, 2);
});

test("ISO week number handles the start-of-year boundary", () => {
  assert.equal(isoWeekNumber(new Date(2021, 0, 1)), 53);
});

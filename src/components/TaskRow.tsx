import { useState } from "react";
import type { Task } from "../types";
import { Icon } from "./Icon";

const priorityLabel: Record<Task["priority"], string> = {
  low: "Rendah", normal: "Normal", high: "Tinggi", urgent: "Mendesak",
};

function timeLabel(value: string | null) {
  if (!value) return "Tanpa waktu";
  return new Date(value).toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit" });
}

function localDay(value: string) {
  const date = new Date(value);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

export function TaskRow({
  task,
  children = [],
  overdue = false,
  onToggle,
  onEdit,
  onRollover,
}: {
  task: Task;
  children?: Task[];
  overdue?: boolean;
  onToggle: (task: Task) => void;
  onEdit: (task: Task) => void;
  onRollover?: (task: Task) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  return (
    <div className={`task-stack ${task.status === "done" ? "is-done" : ""}`}>
      <article className={`task-row ${overdue ? "is-overdue" : ""}`}>
        <button
          className={`task-check ${task.status === "done" ? "checked" : ""}`}
          aria-label={`${task.status === "done" ? "Tandai belum selesai" : "Selesaikan"}: ${task.title}`}
          aria-pressed={task.status === "done"}
          onClick={() => onToggle(task)}
        >
          {task.status === "done" && <Icon name="check" size={14} />}
        </button>
        <span className={`priority-mark priority-${task.priority}`} aria-hidden="true" />
        <div className="task-copy">
          <button className="task-title" onClick={() => onEdit(task)}>{task.title}</button>
          <div className="task-meta">
            {task.dueAt && <span><Icon name="clock" size={13} />{timeLabel(task.dueAt)}</span>}
            {task.recurrenceRule && <span><Icon name="repeat" size={13} />Berulang</span>}
            <span className={`priority-label priority-label-${task.priority}`}>{priorityLabel[task.priority]}</span>
            {task.tags.slice(0, 3).map(tag => <span className="tag-chip" key={tag}>{tag}</span>)}
          </div>
        </div>
        {children.length > 0 && (
          <button className="subtask-count" onClick={() => setExpanded(value => !value)} aria-expanded={expanded}>
            {children.filter(child => child.status === "done").length}/{children.length}
            <span className={expanded ? "rotate" : ""}><Icon name="chevron" size={14} /></span>
          </button>
        )}
        {overdue && onRollover && <button className="rollover-link" onClick={() => onRollover(task)}>Hari ini</button>}
        <button className="icon-button task-edit" aria-label={`Detail ${task.title}`} onClick={() => onEdit(task)}>
          <Icon name="arrow" size={16} />
        </button>
      </article>
      {expanded && children.map(child => (
        <div className="subtask-row" key={child.id}>
          <TaskRow task={child} overdue={Boolean(child.dueAt && localDay(child.dueAt) < localDay(new Date().toISOString()))} onToggle={onToggle} onEdit={onEdit} onRollover={onRollover} />
        </div>
      ))}
    </div>
  );
}

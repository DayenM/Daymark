import { useEffect, useRef, useState, type FormEvent } from "react";
import { confirm } from "@tauri-apps/plugin-dialog";
import type { Priority, Project, Task, TaskDraft } from "../types";
import { DateTimePicker } from "./DateTimePicker";
import { Icon } from "./Icon";

function localDateTime(value: string | null) {
  if (!value) return "";
  const date = new Date(value);
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
}

export function TaskEditor({
  task,
  projects,
  onClose,
  onSave,
  onCreate,
  onDelete,
  onCreateSubtask,
}: {
  task: Task | null;
  projects: Project[];
  onClose: () => void;
  onSave: (task: Task, draft: TaskDraft, notes: string) => Promise<void>;
  onCreate?: (draft: TaskDraft, notes: string) => Promise<void>;
  onDelete?: (task: Task) => Promise<void>;
  onCreateSubtask?: (parent: Task, title: string) => Promise<void>;
}) {
  const titleRef = useRef<HTMLInputElement>(null);
  const [title, setTitle] = useState(task?.title ?? "");
  const [priority, setPriority] = useState<Priority>(task?.priority ?? "normal");
  const [dueAt, setDueAt] = useState(localDateTime(task?.dueAt ?? null));
  const [reminder, setReminder] = useState(task?.reminderOffsetMinutes?.toString() ?? "");
  const rule = task?.recurrenceRule ? JSON.parse(task.recurrenceRule) as { frequency?: string; interval?: number } : null;
  const [repeat, setRepeat] = useState(rule?.frequency ?? "");
  const [projectId, setProjectId] = useState(task?.projectId ?? "");
  const [tags, setTags] = useState(task?.tags.join(", ") ?? "");
  const [notes, setNotes] = useState(task?.notes ?? "");
  const [subtask, setSubtask] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => titleRef.current?.focus(), []);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError("");
    const draft: TaskDraft = {
      title,
      priority,
      dueAt: dueAt ? new Date(dueAt).toISOString() : null,
      reminderOffsetMinutes: reminder === "" ? null : Number(reminder),
      recurrenceRule: repeat ? {
        frequency: repeat as "daily" | "weekly" | "monthly",
        interval: Math.max(1, Number(rule?.interval ?? 1)),
        monthDay: null,
      } : null,
      parentId: task?.parentId ?? null,
      projectId: projectId || null,
      tags: tags.split(",").map(value => value.trim()).filter(Boolean),
    };
    try {
      if (task) await onSave(task, draft, notes);
      else if (onCreate) await onCreate(draft, notes);
      else throw new Error("Form tugas baru tidak tersedia.");
      onClose();
    } catch (value) {
      setError(value instanceof Error ? value.message : String(value));
    } finally {
      setSaving(false);
    }
  }

  async function createSubtask() {
    if (!task || !onCreateSubtask || !subtask.trim()) return;
    try {
      await onCreateSubtask(task, subtask);
      setSubtask("");
    } catch (value) {
      setError(value instanceof Error ? value.message : String(value));
    }
  }

  async function remove() {
    if (!task || !onDelete || !await confirm(`Hapus tugas “${task.title}” beserta subtugasnya?`)) return;
    try {
      await onDelete(task);
      onClose();
    } catch (value) {
      setError(value instanceof Error ? value.message : String(value));
    }
  }

  return (
    <div className="modal-scrim" role="presentation" onMouseDown={event => event.target === event.currentTarget && onClose()}>
      <section className="task-editor glass-panel" role="dialog" aria-modal="true" aria-labelledby="task-editor-title">
        <header className="modal-header">
          <div><p className="eyebrow">Ruang tugas</p><h2 id="task-editor-title">{task ? "Detail tugas" : "Tugas baru"}</h2></div>
          <button className="icon-button" onClick={onClose} aria-label="Tutup detail"><Icon name="close" /></button>
        </header>
        <form onSubmit={submit} autoComplete="off">
          <label className="field-label" htmlFor="task-title">Judul</label>
          <input ref={titleRef} id="task-title" className="field-input title-input" value={title} onChange={event => setTitle(event.target.value)} maxLength={240} autoComplete="off" required />

          <div className="field-grid">
            <label className="field-wrap"><span className="field-label">Prioritas</span>
              <select className="field-input" value={priority} onChange={event => setPriority(event.target.value as Priority)}>
                <option value="low">Rendah</option><option value="normal">Normal</option><option value="high">Tinggi</option><option value="urgent">Mendesak</option>
              </select>
            </label>
            <label className="field-wrap"><span className="field-label">Jadwal</span>
              <DateTimePicker value={dueAt} onChange={setDueAt} />
            </label>
            <label className="field-wrap"><span className="field-label">Pengingat</span>
              <select className="field-input" value={reminder} onChange={event => setReminder(event.target.value)}>
                <option value="">Tidak ada</option><option value="0">Pada waktunya</option><option value="5">5 menit sebelumnya</option><option value="15">15 menit sebelumnya</option><option value="30">30 menit sebelumnya</option><option value="60">1 jam sebelumnya</option><option value="1440">1 hari sebelumnya</option>
              </select>
            </label>
            <label className="field-wrap"><span className="field-label">Ulangi</span>
              <select className="field-input" value={repeat} onChange={event => setRepeat(event.target.value)}>
                <option value="">Tidak berulang</option><option value="daily">Setiap hari</option><option value="weekly">Setiap minggu</option><option value="monthly">Setiap bulan</option>
              </select>
            </label>
            <label className="field-wrap"><span className="field-label">Project</span>
              <select className="field-input" value={projectId} onChange={event => setProjectId(event.target.value)}>
                <option value="">Tanpa project</option>{projects.map(project => <option key={project.id} value={project.id}>{project.name}</option>)}
              </select>
            </label>
            <label className="field-wrap"><span className="field-label">Tag <span className="field-hint">pisahkan dengan koma</span></span>
              <input className="field-input" value={tags} onChange={event => setTags(event.target.value)} placeholder="kerja, pribadi" />
            </label>
          </div>

          <label className="field-label" htmlFor="task-notes">Catatan Markdown</label>
          <textarea id="task-notes" className="field-input notes-input" value={notes} onChange={event => setNotes(event.target.value)} placeholder="Tambahkan konteks, checklist, atau tautan…" />

          {task && task.parentId === null && onCreateSubtask && (
            <div className="subtask-create">
              <label className="field-label" htmlFor="subtask-title">Subtugas</label>
              <div className="inline-create">
                <input id="subtask-title" className="field-input" value={subtask} onChange={event => setSubtask(event.target.value)} placeholder="Tambahkan satu langkah kecil" onKeyDown={event => event.key === "Enter" && (event.preventDefault(), void createSubtask())} />
                <button type="button" className="icon-button" onClick={() => void createSubtask()} aria-label="Tambah subtugas"><Icon name="plus" /></button>
              </div>
            </div>
          )}

          {error && <p className="form-error" role="alert">{error}</p>}
          <footer className="modal-footer">
            {task && onDelete ? <button type="button" className="text-button danger-text" onClick={() => void remove()}><Icon name="trash" size={15} /> Hapus tugas</button> : <span />}
            <div className="button-pair"><button type="button" className="text-button" onClick={onClose}>Batal</button><button className="primary-button" disabled={saving}>{saving ? "Menyimpan…" : task ? "Simpan perubahan" : "Buat tugas"}</button></div>
          </footer>
        </form>
      </section>
    </div>
  );
}

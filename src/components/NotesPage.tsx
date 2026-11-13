import { useEffect, useState, type FormEvent } from "react";
import type { QuickNote } from "../types";
import { Icon } from "./Icon";

export function NotesPage({ notes, onCreate, onUpdate, onDelete }: {
  notes: QuickNote[];
  onCreate: (title: string) => Promise<void>;
  onUpdate: (note: QuickNote) => Promise<void>;
  onDelete: (note: QuickNote) => Promise<void>;
}) {
  const [title, setTitle] = useState("");
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!title.trim()) return;
    await onCreate(title.trim());
    setTitle("");
  }

  return (
    <div className="notes-page">
      <section className="notes-intro"><div><p className="eyebrow">Catatan cepat</p><h2>Simpan hal yang ingin tetap dekat.</h2><p>Catatan tersimpan lokal. Sematkan yang ingin muncul di briefing.</p></div><span className="notes-count">{notes.length.toString().padStart(2, "0")} catatan</span></section>
      <form className="note-create glass-panel" onSubmit={submit}>
        <span className="note-composer-icon"><Icon name="note" size={18} /></span>
        <span className="note-composer-copy"><strong>Catatan baru</strong><small>Mulai dari judul; isi bisa kamu lengkapi setelahnya.</small></span>
        <input className="note-create-input" value={title} onChange={event => setTitle(event.target.value)} placeholder="Apa yang ingin kamu simpan?" maxLength={120} aria-label="Judul catatan baru" />
        <button className="primary-button" disabled={!title.trim()}><Icon name="plus" size={14} />Buat catatan</button>
      </form>
      {notes.length === 0 ? <div className="notes-empty"><span><Icon name="note" size={23} /></span><h3>Belum ada catatan.</h3><p>Buat catatan kecil untuk hal yang ingin kamu simpan.</p></div> : <div className="note-grid">{notes.map(note => <NoteCard key={note.id} note={note} onUpdate={onUpdate} onDelete={onDelete} />)}</div>}
    </div>
  );
}

function NoteCard({ note, onUpdate, onDelete }: { note: QuickNote; onUpdate: (note: QuickNote) => Promise<void>; onDelete: (note: QuickNote) => Promise<void> }) {
  const [draft, setDraft] = useState(note);
  const [saving, setSaving] = useState(false);
  useEffect(() => setDraft(note), [note.updatedAt]);

  async function save() {
    setSaving(true);
    try { await onUpdate(draft); } finally { setSaving(false); }
  }

  return (
    <article className={`note-card glass-panel ${draft.isPinned ? "is-pinned" : ""}`}>
      <div className="note-card-top"><span className="note-pin-mark">{draft.isPinned && <Icon name="pin" size={14} />}</span><button className={`text-button pin-toggle ${draft.isPinned ? "pinned" : ""}`} onClick={() => setDraft(value => ({ ...value, isPinned: !value.isPinned }))}><Icon name="pin" size={14} />{draft.isPinned ? "Tersimpan di briefing" : "Sematkan"}</button></div>
      <input className="note-title-input" value={draft.title} onChange={event => setDraft(value => ({ ...value, title: event.target.value }))} maxLength={120} aria-label="Judul catatan" />
      <textarea className="note-content-input" value={draft.content} onChange={event => setDraft(value => ({ ...value, content: event.target.value }))} maxLength={50_000} placeholder="Tulis catatan…" aria-label="Isi catatan" />
      <footer className="note-card-footer"><button className="text-button danger-text" onClick={() => void onDelete(note)}><Icon name="trash" size={14} /> Hapus</button><button className="soft-button" onClick={() => void save()} disabled={saving}>{saving ? "Menyimpan…" : "Simpan"}</button></footer>
    </article>
  );
}

import { useEffect, useRef, useState, type FormEvent } from "react";
import { Icon } from "./Icon";

export function QuickCapture({ onClose, onCreate }: { onClose: () => void; onCreate: (title: string) => Promise<void> }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [title, setTitle] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => inputRef.current?.focus(), []);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!title.trim()) return;
    setSaving(true);
    setError("");
    try {
      await onCreate(title.trim());
      onClose();
    } catch (value) {
      setError(value instanceof Error ? value.message : String(value));
      setSaving(false);
    }
  }

  return (
    <div className="modal-scrim capture-scrim" role="presentation" onMouseDown={event => event.target === event.currentTarget && onClose()}>
      <section className="capture-panel glass-panel" role="dialog" aria-modal="true" aria-labelledby="capture-title">
        <header className="capture-header">
          <div className="capture-icon"><Icon name="spark" size={20} /></div>
          <div className="capture-heading"><p className="eyebrow">Quick capture</p><h2 id="capture-title">Tangkap dulu. Rapikan nanti.</h2><p>Simpan cepat ke Inbox, lalu tambahkan detail kapan saja.</p></div>
          <button className="icon-button capture-close" onClick={onClose} aria-label="Tutup quick capture"><Icon name="close" size={17} /></button>
        </header>
        <form onSubmit={submit}>
          <label className="capture-input-wrap" htmlFor="capture-title-input"><Icon name="note" size={17} /><input id="capture-title-input" ref={inputRef} value={title} onChange={event => setTitle(event.target.value)} placeholder="Apa langkah berikutnya?" aria-label="Judul tugas baru" maxLength={240} /><kbd>Enter</kbd></label>
          {error && <p className="form-error" role="alert">{error}</p>}
          <footer className="capture-footer"><span className="capture-shortcut"><kbd>Ctrl</kbd><kbd>Shift</kbd><kbd>Y</kbd><span>untuk membuka dari mana saja</span></span><button className="primary-button" disabled={!title.trim() || saving}><Icon name="plus" size={15} />{saving ? "Menyimpan…" : "Tambah ke Inbox"}</button></footer>
        </form>
      </section>
    </div>
  );
}

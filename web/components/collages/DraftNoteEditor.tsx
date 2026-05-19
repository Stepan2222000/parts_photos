"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api";
import { formatApiError } from "@/lib/formatApiError";
import s from "./DraftNoteEditor.module.css";

interface Props {
  collageId: string;
  initialNote: string;
}

export default function DraftNoteEditor({ collageId, initialNote }: Props) {
  const router = useRouter();
  const [note, setNote] = useState(initialNote);
  const [savedNote, setSavedNote] = useState(initialNote);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    setNote(initialNote);
    setSavedNote(initialNote);
  }, [initialNote]);

  async function save() {
    const trimmed = note.trim();
    if (!trimmed) {
      setErr("Комментарий не может быть пустым");
      return;
    }
    if (trimmed === savedNote) return;

    setBusy(true);
    setErr(null);
    setSaved(false);
    try {
      await api.collages.patchNote(collageId, trimmed);
      setSavedNote(trimmed);
      setSaved(true);
      router.refresh();
    } catch (e) {
      setErr(formatApiError(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={s.wrap}>
      <label className={s.label} htmlFor="draft-note">
        Комментарий
      </label>
      <textarea
        id="draft-note"
        className={s.textarea}
        value={note}
        onChange={(e) => {
          setNote(e.target.value);
          setSaved(false);
        }}
        rows={3}
        disabled={busy}
      />
      <div className={s.row}>
        <button type="button" className={s.saveBtn} onClick={save} disabled={busy || !note.trim()}>
          {busy ? "Сохраняю…" : "Сохранить комментарий"}
        </button>
        {saved && <span className={s.ok}>Сохранено</span>}
        {err && <span className={s.err}>{err}</span>}
      </div>
    </div>
  );
}

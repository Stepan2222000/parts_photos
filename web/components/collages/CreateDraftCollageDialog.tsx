"use client";

import { useState } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { api, ApiError } from "@/lib/api";
import { formatApiError } from "@/lib/formatApiError";
import s from "@/components/shell/Modal.module.css";

interface Props {
  groupId: string;
  onClose: () => void;
}

export default function CreateDraftCollageDialog({ groupId, onClose }: Props) {
  const router = useRouter();
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = note.trim();
    if (!trimmed) {
      setErr("Введи комментарий");
      return;
    }
    setBusy(true);
    setErr(null);
    try {
      const c = await api.collages.create({
        group_id: groupId,
        owner_kind: "draft",
        note: trimmed,
      });
      onClose();
      router.push(`/collages/${c.id}?upload=1`);
      router.refresh();
    } catch (e) {
      if (e instanceof ApiError && e.status === 422) {
        setErr("Комментарий обязателен");
      } else {
        setErr(formatApiError(e));
      }
      setBusy(false);
    }
  }

  if (typeof document === "undefined") return null;
  return createPortal(
    <div className={s.backdrop} onClick={onClose}>
      <form className={s.dialog} onClick={(e) => e.stopPropagation()} onSubmit={submit}>
        <h2 className={s.title}>Новый черновик.</h2>
        <p style={{ margin: 0, fontSize: 13, color: "var(--text-muted)", lineHeight: 1.45 }}>
          Комментарий — как ты потом найдёшь этот коллаж (артикул, коробка, заметка). Item не нужен.
        </p>

        <div className={s.field}>
          <label className={s.label}>Комментарий</label>
          <textarea
            className={s.textarea}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="например: 8M0095485, коробка синяя, полка 2"
            rows={4}
            autoFocus
            disabled={busy}
          />
        </div>

        {err && <div className={s.error}>{err}</div>}

        <div className={s.actions}>
          <button type="button" className={s.btn} onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button
            type="submit"
            className={`${s.btn} ${s.btnPrimary}`}
            disabled={busy || !note.trim()}
          >
            {busy ? "Создаю…" : "Create"}
          </button>
        </div>
      </form>
    </div>,
    document.body,
  );
}

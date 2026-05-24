"use client";

import { useState } from "react";
import { createPortal } from "react-dom";
import { api, ApiError } from "@/lib/api";
import type { MoveTarget } from "@/lib/types";
import s from "@/components/shell/Modal.module.css";

interface Props {
  collageId: string;
  targets: MoveTarget[];
  photoIds: string[];
  onClose: () => void;
  /** Called after a successful move with the ids that left this collage. */
  onDone: (movedIds: string[]) => void;
}

export default function TransferDialog({ collageId, targets, photoIds, onClose, onDone }: Props) {
  // Mandatory choice: nothing pre-selected, even when there's a single target.
  const [target, setTarget] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function submit() {
    if (!target) {
      setErr("Выбери, куда переносить");
      return;
    }
    setBusy(true);
    setErr(null);
    try {
      await api.collages.transfer(collageId, target, photoIds);
      onDone(photoIds);
    } catch (e) {
      if (e instanceof ApiError && e.status === 409) {
        setErr("Некоторые фото уже перенесены. Обнови страницу.");
      } else if (e instanceof ApiError) {
        setErr(e.body || String(e));
      } else {
        setErr(String(e));
      }
      setBusy(false);
    }
  }

  return createPortal(
    <div className={s.backdrop} onClick={onClose}>
      <div className={s.dialog} onClick={(e) => e.stopPropagation()} style={{ maxWidth: 440 }}>
        <h2 className={s.title}>Перенести на публикацию.</h2>
        <p style={{ margin: "0 0 14px", color: "var(--text-muted)", fontSize: 13.5 }}>
          {photoIds.length} фото переедут физически — в исходном коллаже их не останется.
        </p>
        <div className={s.field}>
          <label className={s.label}>Куда</label>
          {targets.map((t) => (
            <label key={t.id} className={s.row} style={{ cursor: "pointer", padding: "6px 0" }}>
              <input
                type="radio"
                name="move-target"
                className={s.checkbox}
                checked={target === t.id}
                onChange={() => setTarget(t.id)}
                disabled={busy}
              />
              {t.name}
            </label>
          ))}
        </div>
        {err && <div className={s.error}>{err}</div>}
        <div className={s.actions}>
          <button type="button" className={s.btn} onClick={onClose} disabled={busy}>
            Отмена
          </button>
          <button
            type="button"
            className={`${s.btn} ${s.btnPrimary}`}
            onClick={submit}
            disabled={busy || !target}
          >
            {busy ? "Переношу…" : `Перенести (${photoIds.length})`}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

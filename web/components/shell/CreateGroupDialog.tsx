"use client";

import { useState } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api";
import s from "./Modal.module.css";

interface Props {
  onClose: () => void;
}

export default function CreateGroupDialog({ onClose }: Props) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [isReference, setIsReference] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) {
      setErr("Имя обязательно");
      return;
    }
    setBusy(true);
    setErr(null);
    try {
      const g = await api.groups.create({
        name: name.trim(),
        description: description.trim() || undefined,
        is_reference: isReference,
      });
      onClose();
      router.push(`/groups/${g.id}`);
      router.refresh();
    } catch (e) {
      setErr(String(e));
      setBusy(false);
    }
  }

  if (typeof document === "undefined") return null;
  return createPortal(
    <div className={s.backdrop} onClick={onClose}>
      <form className={s.dialog} onClick={(e) => e.stopPropagation()} onSubmit={submit}>
        <h2 className={s.title}>Новая группа.</h2>

        <div className={s.field}>
          <label className={s.label}>Имя</label>
          <input
            className={s.input}
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Эталонные / Avito #2 / С дефектами"
            autoFocus
          />
        </div>

        <div className={s.field}>
          <label className={s.label}>Описание</label>
          <textarea
            className={s.textarea}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Канал-эталон. Один на систему."
          />
        </div>

        <label className={s.checkbox}>
          <input
            type="checkbox"
            checked={isReference}
            onChange={(e) => setIsReference(e.target.checked)}
          />
          Эталонная группа (только одна на систему)
        </label>

        {err && <div className={s.error}>{err}</div>}

        <div className={s.actions}>
          <button type="button" className={s.btn} onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button type="submit" className={`${s.btn} ${s.btnPrimary}`} disabled={busy}>
            {busy ? "Создаю…" : "Create"}
          </button>
        </div>
      </form>
    </div>,
    document.body,
  );
}

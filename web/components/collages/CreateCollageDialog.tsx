"use client";

import { useState } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { api, ApiError } from "@/lib/api";
import type { OwnerSearchResult } from "@/lib/types";
import OwnerSearch from "@/components/owners/OwnerSearch";
import s from "@/components/shell/Modal.module.css";

interface Props {
  groupId: string;
  onClose: () => void;
}

export default function CreateCollageDialog({ groupId, onClose }: Props) {
  const router = useRouter();
  const [owner, setOwner] = useState<OwnerSearchResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!owner) {
      setErr("Выбери запчасть");
      return;
    }
    setBusy(true);
    setErr(null);
    try {
      const c = await api.collages.create({
        group_id: groupId,
        owner_kind: "smart_part",
        owner_id: owner.smart_id,
      });
      onClose();
      router.push(`/collages/${c.id}?upload=1`);
      router.refresh();
    } catch (e) {
      if (e instanceof ApiError && e.status === 409) {
        setErr(`Коллаж для ${owner.smart_id} уже существует в этой группе.`);
      } else if (e instanceof ApiError && e.status === 422) {
        setErr(`Запчасть ${owner.smart_id} не найдена в каталоге smart.`);
      } else {
        setErr(String(e));
      }
      setBusy(false);
    }
  }

  if (typeof document === "undefined") return null;
  return createPortal(
    <div className={s.backdrop} onClick={onClose}>
      <form className={s.dialog} onClick={(e) => e.stopPropagation()} onSubmit={submit}>
        <h2 className={s.title}>Новый коллаж.</h2>

        <div className={s.field}>
          <label className={s.label}>Запчасть</label>
          <OwnerSearch selected={owner} onChange={setOwner} />
        </div>

        {err && <div className={s.error}>{err}</div>}

        <div className={s.actions}>
          <button type="button" className={s.btn} onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button type="submit" className={`${s.btn} ${s.btnPrimary}`} disabled={busy || !owner}>
            {busy ? "Создаю…" : "Create"}
          </button>
        </div>
      </form>
    </div>,
    document.body,
  );
}

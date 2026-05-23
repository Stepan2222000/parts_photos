"use client";

import { useState } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { api, ApiError } from "@/lib/api";
import type { DefectFilter, ItemSearchResult, OwnerKind, OwnerSearchResult } from "@/lib/types";
import OwnerSearch from "@/components/owners/OwnerSearch";
import ItemPicker from "./ItemPicker";
import s from "@/components/shell/Modal.module.css";

interface Props {
  groupId: string;
  ownerKind: OwnerKind;
  defectFilter: DefectFilter | null;
  onClose: () => void;
}

export default function CreateCollageDialog({ groupId, ownerKind, defectFilter, onClose }: Props) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // ── smart_part branch state ──
  const [owner, setOwner] = useState<OwnerSearchResult | null>(null);

  function goToCollage(id: string, fresh: boolean) {
    onClose();
    router.push(fresh ? `/collages/${id}?upload=1` : `/collages/${id}`);
    router.refresh();
  }

  async function createSmart(e: React.FormEvent) {
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
      goToCollage(c.id, true);
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

  // ── instance branch: clicking an item creates (or opens existing) ──
  async function pickItem(it: ItemSearchResult) {
    if (it.existing_collage_id) {
      goToCollage(it.existing_collage_id, false);
      return;
    }
    if (!it.selectable) return; // guarded in UI too
    setBusy(true);
    setErr(null);
    try {
      const c = await api.collages.create({
        group_id: groupId,
        owner_kind: "instance",
        owner_id: String(it.item_id),
      });
      goToCollage(c.id, true);
    } catch (e) {
      if (e instanceof ApiError && e.status === 409) {
        setErr(`Коллаж для экземпляра #${it.item_id} уже существует.`);
      } else if (e instanceof ApiError) {
        setErr(`Не удалось создать: ${e.body}`);
      } else {
        setErr(String(e));
      }
      setBusy(false);
    }
  }

  if (typeof document === "undefined") return null;
  return createPortal(
    <div className={s.backdrop} onClick={onClose}>
      <div className={s.dialog} onClick={(e) => e.stopPropagation()} style={{ maxWidth: ownerKind === "instance" ? 540 : 460 }}>
        {ownerKind === "smart_part" ? (
          <form onSubmit={createSmart} style={{ display: "contents" }}>
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
        ) : (
          <>
            <h2 className={s.title}>Новый коллаж · экземпляр.</h2>
            <ItemPicker groupId={groupId} defectFilter={defectFilter} busy={busy} onPick={pickItem} />
            {err && <div className={s.error}>{err}</div>}
            <div className={s.actions}>
              <button type="button" className={s.btn} onClick={onClose} disabled={busy}>
                Закрыть
              </button>
            </div>
          </>
        )}
      </div>
    </div>,
    document.body,
  );
}

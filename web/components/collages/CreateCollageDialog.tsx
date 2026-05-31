"use client";

import { useState } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { api, ApiError } from "@/lib/api";
import type { ConditionFilter, ItemSearchResult, OwnerKind, OwnerSearchResult } from "@/lib/types";
import OwnerSearch from "@/components/owners/OwnerSearch";
import ItemPicker from "./ItemPicker";
import s from "@/components/shell/Modal.module.css";

interface Props {
  groupId: string;
  ownerKind: OwnerKind;
  conditionFilter: ConditionFilter | null;
  ownerOptional?: boolean;
  titleRequired?: boolean;
  ownerFree?: boolean;
  onClose: () => void;
}

type BindKind = "none" | "smart" | "item";

export default function CreateCollageDialog({
  groupId,
  ownerKind,
  conditionFilter,
  ownerOptional = false,
  titleRequired = false,
  ownerFree = false,
  onClose,
}: Props) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // ── smart_part / library branch state ──
  const [owner, setOwner] = useState<OwnerSearchResult | null>(null);
  const [title, setTitle] = useState("");
  // ── library binding state ──
  const [bindKind, setBindKind] = useState<BindKind>("none");
  const [pickedItem, setPickedItem] = useState<ItemSearchResult | null>(null);

  function goToCollage(id: string, fresh: boolean) {
    onClose();
    router.push(fresh ? `/collages/${id}?upload=1` : `/collages/${id}`);
    router.refresh();
  }

  // ── library branch: required title + OPTIONAL binding (smart OR item) ──
  async function createLibrary(e: React.FormEvent) {
    e.preventDefault();
    const t = title.trim();
    if (!t) {
      setErr("Введи название коллажа");
      return;
    }
    if (bindKind === "smart" && !owner) {
      setErr("Выбери запчасть или сними привязку");
      return;
    }
    if (bindKind === "item" && !pickedItem) {
      setErr("Выбери экземпляр или сними привязку");
      return;
    }
    setBusy(true);
    setErr(null);
    let binding: { owner_kind?: "smart_part" | "instance"; owner_id?: string } = {};
    if (bindKind === "smart" && owner) {
      binding = { owner_kind: "smart_part", owner_id: owner.smart_id };
    } else if (bindKind === "item" && pickedItem) {
      binding = { owner_kind: "instance", owner_id: String(pickedItem.item_id) };
    }
    try {
      const c = await api.collages.create({ group_id: groupId, title: t, ...binding });
      goToCollage(c.id, true);
    } catch (e) {
      if (e instanceof ApiError) {
        setErr(`Не удалось создать: ${e.body}`);
      } else {
        setErr(String(e));
      }
      setBusy(false);
    }
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

  const maxWidth = ownerFree ? 540 : ownerKind === "instance" ? 540 : 460;

  const BIND_OPTS: { key: BindKind; label: string }[] = [
    { key: "none", label: "Без привязки" },
    { key: "smart", label: "Запчасть" },
    { key: "item", label: "Экземпляр" },
  ];

  if (typeof document === "undefined") return null;
  return createPortal(
    <div className={s.backdrop} onClick={onClose}>
      <div className={s.dialog} onClick={(e) => e.stopPropagation()} style={{ maxWidth }}>
        {ownerFree ? (
          <form onSubmit={createLibrary} style={{ display: "contents" }}>
            <h2 className={s.title}>Новый коллаж.</h2>
            <div className={s.field}>
              <label className={s.label}>Название</label>
              <input
                className={s.input}
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Например: Подборка для Avito"
                maxLength={200}
                autoFocus
              />
            </div>
            <div className={s.field}>
              <label className={s.label}>
                Привязка <span style={{ color: "var(--text-faint)", fontWeight: 400 }}>· необязательно</span>
              </label>
              <div style={{ display: "flex", gap: 6 }}>
                {BIND_OPTS.map((o) => (
                  <button
                    key={o.key}
                    type="button"
                    onClick={() => setBindKind(o.key)}
                    style={{
                      flex: 1,
                      height: 32,
                      borderRadius: 7,
                      fontSize: 13,
                      fontFamily: "inherit",
                      cursor: "pointer",
                      border: bindKind === o.key ? "1px solid var(--brand-coral)" : "1px solid var(--border-strong)",
                      background: bindKind === o.key ? "var(--brand-coral-soft, rgba(204,120,92,0.12))" : "transparent",
                      color: bindKind === o.key ? "var(--brand-coral-active)" : "var(--text-muted)",
                    }}
                  >
                    {o.label}
                  </button>
                ))}
              </div>
            </div>
            {bindKind === "smart" && (
              <div className={s.field}>
                <OwnerSearch selected={owner} onChange={setOwner} />
              </div>
            )}
            {bindKind === "item" && (
              <ItemPicker
                groupId={groupId}
                conditionFilter={null}
                busy={busy}
                selectMode
                selectedId={pickedItem?.item_id ?? null}
                onPick={(it) => setPickedItem(it)}
              />
            )}
            {err && <div className={s.error}>{err}</div>}
            <div className={s.actions}>
              <button type="button" className={s.btn} onClick={onClose} disabled={busy}>
                Cancel
              </button>
              <button type="submit" className={`${s.btn} ${s.btnPrimary}`} disabled={busy || !title.trim()}>
                {busy ? "Создаю…" : "Create"}
              </button>
            </div>
          </form>
        ) : ownerKind === "smart_part" ? (
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
            <ItemPicker groupId={groupId} conditionFilter={conditionFilter} busy={busy} onPick={pickItem} />
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

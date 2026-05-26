"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { api, ApiError } from "@/lib/api";
import type { Collage } from "@/lib/types";
import s from "./CollageGrid.module.css";

interface Props {
  collages: Collage[];
  showGroup?: boolean;
}

function PhotoIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="3" width="18" height="18" rx="2" />
      <circle cx="8.5" cy="8.5" r="1.5" />
      <path d="m21 15-5-5L5 21" />
    </svg>
  );
}

function WarnIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10" />
      <path d="M12 7v5M12 17h.01" />
    </svg>
  );
}

function TrashIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 6h18" />
      <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" />
      <path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
      <path d="M10 11v6M14 11v6" />
    </svg>
  );
}

export default function CollageGrid({ collages, showGroup }: Props) {
  const router = useRouter();
  const [deleting, setDeleting] = useState<string | null>(null);

  if (collages.length === 0) {
    return (
      <div style={{ marginTop: 32, color: "var(--text-muted)" }}>
        Коллажей пока нет. Создай первый.
      </div>
    );
  }

  async function onDelete(c: Collage, e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    if (deleting) return;
    const what =
      c.photos_count > 0
        ? `Удалить коллаж «${c.owner_name || c.owner_id}» вместе с ${c.photos_count} фото? Это нельзя отменить.`
        : `Удалить коллаж «${c.owner_name || c.owner_id}»?`;
    if (!confirm(what)) return;
    setDeleting(c.id);
    try {
      await api.collages.delete(c.id);
      router.refresh();
    } catch (err) {
      const msg = err instanceof ApiError ? `${err.status}: ${err.body}` : String(err);
      alert(`Не удалось удалить: ${msg}`);
    } finally {
      setDeleting(null);
    }
  }

  return (
    <div className={s.grid}>
      {collages.map((c) => (
        <Link key={c.id} href={`/collages/${c.id}`} className={s.card}>
          <div className={s.thumb}>
            {c.first_photo_url ? (
              <img src={c.first_photo_url} alt="" loading="lazy" />
            ) : (
              <div className={s.empty}>
                <PhotoIcon />
              </div>
            )}
            {showGroup && c.group_name && (
              <span className={s.groupBadge}>{c.group_name}</span>
            )}
            <button
              type="button"
              className={s.deleteBtn}
              title="Удалить коллаж"
              aria-label="Удалить коллаж"
              disabled={deleting === c.id}
              onClick={(e) => onDelete(c, e)}
            >
              <TrashIcon />
            </button>
          </div>
          <div className={s.meta}>
            {c.owner_kind === "instance" && (
              <div className={s.kicker}>
                <span className={s.itemBadge}>#{c.owner_id}</span>
                {c.owner_condition === "defect" && <span className={s.defectChip}>дефект</span>}
                {c.owner_condition === "personal" && <span className={s.defectChip}>personal</span>}
              </div>
            )}
            <div className={s.name}>
              {c.owner_name || (c.owner_kind === "instance" ? "Экземпляр" : c.owner_id)}
            </div>
            <div className={s.art}>
              {c.owner_articles?.length ? c.owner_articles.join(" · ") : c.owner_id}
            </div>
            <div className={s.foot}>
              {c.photos_count > 0 ? (
                <span className={s.count}>
                  <PhotoIcon />
                  {c.photos_count} фото
                </span>
              ) : (
                <span className={`${s.count} ${s.countWarn}`}>
                  <WarnIcon />
                  нет фото
                </span>
              )}
            </div>
          </div>
        </Link>
      ))}
    </div>
  );
}

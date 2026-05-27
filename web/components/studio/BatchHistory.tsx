"use client";

import { useEffect, useRef } from "react";
import type { StudioBatch } from "@/lib/types";
import s from "./BatchHistory.module.css";

interface Props {
  batches: StudioBatch[];
  activeId: string | null;
  /** Scroll container the sentinel lives in — IntersectionObserver root. */
  scrollRootRef: React.RefObject<HTMLElement | null>;
  hasMore: boolean;
  loadingMore: boolean;
  onLoadMore: () => void;
  onSelect: (id: string | null) => void;
  onDelete: (id: string) => Promise<void>;
}

export default function BatchHistory({
  batches,
  activeId,
  scrollRootRef,
  hasMore,
  loadingMore,
  onLoadMore,
  onSelect,
  onDelete,
}: Props) {
  const sentinelRef = useRef<HTMLDivElement>(null);

  // Fire onLoadMore as the sentinel scrolls into the rail's viewport. Re-armed
  // on each appended page (batches.length) so it keeps pulling while in view.
  useEffect(() => {
    if (!hasMore) return;
    const el = sentinelRef.current;
    if (!el) return;
    const obs = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting) onLoadMore();
      },
      { root: scrollRootRef.current ?? null, rootMargin: "300px" },
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, [hasMore, loadingMore, onLoadMore, scrollRootRef, batches.length]);

  return (
    <div>
      <button
        type="button"
        className={`${s.newBtn} ${activeId === null ? s.activeBtn : ""}`}
        onClick={() => onSelect(null)}
      >
        + новый запуск
      </button>

      <div className={s.label}>История</div>

      {batches.length === 0 && (
        <div className={s.empty}>Пока пусто. Запусти первый батч.</div>
      )}

      <ul className={s.list}>
        {batches.map((b) => {
          const pct = b.total > 0 ? Math.round((b.done / b.total) * 100) : 0;
          const isActive = b.id === activeId;
          return (
            <li
              key={b.id}
              className={`${s.row} ${isActive ? s.activeRow : ""}`}
              onClick={() => onSelect(b.id)}
            >
              <div className={s.rowHead}>
                <span className={s.rowTitle}>
                  {b.name || formatTime(b.created_at)}
                </span>
                <button
                  className={s.del}
                  title="Удалить"
                  onClick={(e) => {
                    e.stopPropagation();
                    void onDelete(b.id);
                  }}
                >
                  ×
                </button>
              </div>
              <div className={s.metaLine}>
                <StatusBadge status={b.status} />
                <span className={s.meta}>
                  {b.done}/{b.total}
                  {b.failed > 0 && (
                    <span className={s.failedNum}> · {b.failed} failed</span>
                  )}
                </span>
              </div>
              <div className={s.bar}>
                <div className={s.barFill} style={{ width: `${pct}%` }} />
              </div>
            </li>
          );
        })}
      </ul>

      {hasMore && (
        <div ref={sentinelRef} className={s.sentinel}>
          {loadingMore ? "Загрузка…" : ""}
        </div>
      )}
    </div>
  );
}

function StatusBadge({ status }: { status: StudioBatch["status"] }) {
  const map: Record<StudioBatch["status"], string> = {
    queued: "Queued",
    running: "Running",
    done: "Done",
    partial: "Partial",
    failed: "Failed",
  };
  return <span className={`${s.badge} ${s["b_" + status]}`}>{map[status]}</span>;
}

function formatTime(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleString("ru-RU", {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

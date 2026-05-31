"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { GapCounts, GapKind, GapRow } from "@/lib/types";
import { api } from "@/lib/api";
import GapFillDialog from "./GapFillDialog";
import s from "./gaps.module.css";

const TABS: { key: GapKind; label: string }[] = [
  { key: "reference", label: "Эталонные" },
  { key: "personal", label: "Personal" },
  { key: "defect", label: "Defect" },
];

function gapKey(g: GapRow): string {
  return `${g.kind}:${g.smart_part_id ?? ""}:${g.item_id ?? ""}`;
}

interface Props {
  initialKind: GapKind;
  initialQ: string;
  initialCounts: GapCounts;
  initialRows: GapRow[];
}

export default function GapsClient({ initialKind, initialQ, initialCounts, initialRows }: Props) {
  const [kind, setKind] = useState<GapKind>(initialKind);
  const [q, setQ] = useState(initialQ);
  const [counts, setCounts] = useState<GapCounts>(initialCounts);
  const [rows, setRows] = useState<GapRow[]>(initialRows);
  const [loading, setLoading] = useState(false);
  const [active, setActive] = useState<GapRow | null>(null);
  const first = useRef(true);

  const reload = useCallback(async (k: GapKind, query: string) => {
    setLoading(true);
    try {
      setRows(await api.gaps.list(k, { q: query || undefined }));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    const t = setTimeout(() => reload(kind, q), 250);
    return () => clearTimeout(t);
  }, [kind, q, reload]);

  const refreshCounts = useCallback(async () => {
    try {
      setCounts(await api.gaps.counts());
    } catch {
      /* non-critical */
    }
  }, []);

  function onFilled(gap: GapRow) {
    const k = gapKey(gap);
    setRows((rs) => rs.filter((r) => gapKey(r) !== k));
    setActive(null);
    refreshCounts();
  }

  return (
    <div className={s.wrap}>
      <div className={s.tabs}>
        {TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            className={`${s.tab} ${kind === t.key ? s.tabActive : ""}`}
            onClick={() => setKind(t.key)}
          >
            {t.label}
            <span className={s.tabCount}>{counts[t.key]}</span>
          </button>
        ))}
      </div>

      <input
        className={s.search}
        placeholder="Поиск по названию, smart-id, артикулу или id экземпляра"
        value={q}
        onChange={(e) => setQ(e.target.value)}
      />

      {loading ? (
        <div className={s.muted}>Загрузка…</div>
      ) : rows.length === 0 ? (
        <div className={s.muted}>
          {q ? "Ничего не найдено." : "Пробелов нет — всё закрыто 🎉"}
        </div>
      ) : (
        <div className={s.list}>
          {rows.map((g) => (
            <GapCard key={gapKey(g)} gap={g} onOpen={() => setActive(g)} />
          ))}
        </div>
      )}

      {active && (
        <GapFillDialog
          gap={active}
          onClose={() => setActive(null)}
          onFilled={() => onFilled(active)}
        />
      )}
    </div>
  );
}

function condBadge(condition: string | null): { label: string; cls: string } | null {
  if (condition === "personal") return { label: "personal", cls: "badgePersonal" };
  if (condition === "defect") return { label: "defect", cls: "badgeDefect" };
  if (condition === "new") return { label: "new", cls: "badgeNew" };
  return null;
}

function GapCard({ gap, onOpen }: { gap: GapRow; onOpen: () => void }) {
  const id = gap.smart_part_id ?? (gap.item_id != null ? `#${gap.item_id}` : "");
  const badge = condBadge(gap.condition);
  const hasSources = gap.real_photos > 0 || gap.free_collages > 0;

  return (
    <button type="button" className={s.card} onClick={onOpen}>
      <div className={s.cardHead}>
        <span className={s.cardName}>{gap.name || id || "Без названия"}</span>
        {badge && <span className={`${s.badge} ${s[badge.cls]}`}>{badge.label}</span>}
      </div>
      <div className={s.cardMeta}>
        <span className={s.mono}>{id}</span>
        {gap.kind === "reference" && gap.in_stock_count > 1 && (
          <span className={s.dim}>· {gap.in_stock_count} в наличии</span>
        )}
        {gap.articles.length > 0 && (
          <span className={s.dim}>· {gap.articles.slice(0, 3).join(" · ")}</span>
        )}
      </div>
      <div className={s.cardSources}>
        {gap.real_photos > 0 && <span className={s.pill}>{gap.real_photos} реальных</span>}
        {gap.free_collages > 0 && (
          <span className={s.pill}>{gap.free_collages} свободных</span>
        )}
        {!hasSources && <span className={s.pillEmpty}>нет исходников — поиск/вручную</span>}
        <span className={s.cardCta}>Заполнить →</span>
      </div>
    </button>
  );
}

"use client";

import { useEffect, useRef, useState } from "react";
import { api } from "@/lib/api";
import type { ConditionFilter, ItemSearchResult } from "@/lib/types";
import s from "./ItemPicker.module.css";

interface Props {
  groupId: string;
  conditionFilter: ConditionFilter | null;
  busy: boolean;
  onPick: (item: ItemSearchResult) => void;
  // Library mode: clicking just *selects* an item (parent creates later with a
  // title); `selectedId` highlights the current pick.
  selectMode?: boolean;
  selectedId?: number | null;
}

const FILTER_HINT: Record<string, string> = {
  personal: "только personal-экземпляры",
  defect: "только дефектные",
  not_defect: "любые экземпляры, кроме дефектных",
};

export default function ItemPicker({
  groupId,
  conditionFilter,
  busy,
  onPick,
  selectMode = false,
  selectedId = null,
}: Props) {
  const [q, setQ] = useState("");
  const [results, setResults] = useState<ItemSearchResult[]>([]);
  const [partsMatched, setPartsMatched] = useState(0);
  const [loading, setLoading] = useState(false);
  const [pickingId, setPickingId] = useState<number | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const acRef = useRef<AbortController | null>(null);
  const reqSeq = useRef(0);

  useEffect(() => {
    const query = q.trim();
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (acRef.current) acRef.current.abort();
    if (query.length < 1) {
      setResults([]);
      setPartsMatched(0);
      setLoading(false);
      return;
    }
    setLoading(true);
    const seq = ++reqSeq.current;
    debounceRef.current = setTimeout(async () => {
      try {
        const r = await api.studio.itemSearch(query, groupId, 30);
        if (seq !== reqSeq.current) return; // stale
        setResults(r.results);
        setPartsMatched(r.parts_matched);
      } catch {
        if (seq !== reqSeq.current) return;
        setResults([]);
        setPartsMatched(0);
      } finally {
        if (seq === reqSeq.current) setLoading(false);
      }
    }, 220);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [q, groupId]);

  function handlePick(it: ItemSearchResult) {
    if (busy) return;
    if (selectMode) {
      if (!it.selectable) return;
      onPick(it); // parent stores the selection; no create yet
      return;
    }
    if (!it.selectable && !it.existing_collage_id) return;
    setPickingId(it.item_id);
    onPick(it);
  }

  const hasQuery = q.trim().length >= 1;

  return (
    <div className={s.wrap}>
      <div className={s.searchRow}>
        <SearchIcon />
        <input
          className={s.input}
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="id экземпляра, артикул, smart-id или название…"
          autoFocus
          disabled={busy}
        />
        {loading && <span className={s.spinner} aria-hidden />}
      </div>

      {conditionFilter && FILTER_HINT[conditionFilter] && (
        <div className={s.filterHint}>
          <span className={s.filterDot} />
          {FILTER_HINT[conditionFilter]}
        </div>
      )}

      <div className={s.list}>
        {!hasQuery && (
          <div className={s.placeholder}>
            Начни вводить — покажу подходящие экземпляры со склада.
          </div>
        )}

        {hasQuery && !loading && results.length === 0 && partsMatched > 0 && (
          <div className={s.muted}>
            Запчасть найдена, но нет подходящих экземпляров (на складе + нужное состояние).
          </div>
        )}
        {hasQuery && !loading && results.length === 0 && partsMatched === 0 && (
          <div className={s.muted}>Ничего не найдено.</div>
        )}

        {results.map((it) => {
          const isExisting = !selectMode && !!it.existing_collage_id;
          const isSelected = selectMode && selectedId === it.item_id;
          const clickable = selectMode
            ? it.selectable
            : !busy && (it.selectable || isExisting);
          const picking = pickingId === it.item_id && busy;
          return (
            <button
              key={it.item_id}
              type="button"
              className={`${s.row} ${!clickable ? s.rowDisabled : ""} ${isExisting || isSelected ? s.rowExisting : ""}`}
              onClick={() => handlePick(it)}
              disabled={!clickable}
              title={it.block_reason || undefined}
            >
              <span className={s.itemId}>#{it.item_id}</span>
              <span className={s.main}>
                <span className={s.name}>{it.smart_part_name || it.smart_part_id}</span>
                <span className={s.sub}>
                  <code className={s.smart}>{it.smart_part_id}</code>
                  {it.article && <code className={s.article}>{it.article}</code>}
                </span>
                {it.condition_note && <span className={s.defectNote}>{it.condition_note}</span>}
              </span>
              <span className={s.tags}>
                {it.condition === "defect" && <span className={s.defectChip}>дефект</span>}
                {it.condition === "personal" && <span className={s.defectChip}>personal</span>}
                {it.condition === "new" && <span className={s.defectChip}>новое</span>}
                {selectMode ? (
                  <span className={s.addChip}>{isSelected ? "выбрано ✓" : "выбрать"}</span>
                ) : isExisting ? (
                  <span className={s.existChip}>открыть →</span>
                ) : !it.selectable ? (
                  <span className={s.blockChip}>{it.block_reason}</span>
                ) : picking ? (
                  <span className={s.addChip}>создаю…</span>
                ) : (
                  <span className={s.addChip}>создать +</span>
                )}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function SearchIcon() {
  return (
    <svg className={s.searchIcon} viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="11" cy="11" r="7" />
      <path d="m21 21-4.3-4.3" />
    </svg>
  );
}

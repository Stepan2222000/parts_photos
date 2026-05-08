"use client";

import { useEffect, useRef, useState } from "react";
import { api } from "@/lib/api";
import type { OwnerSearchResult } from "@/lib/types";
import s from "./OwnerSearch.module.css";

interface Props {
  selected: OwnerSearchResult | null;
  onChange: (o: OwnerSearchResult | null) => void;
}

export default function OwnerSearch({ selected, onChange }: Props) {
  const [q, setQ] = useState("");
  const [results, setResults] = useState<OwnerSearchResult[]>([]);
  const [open, setOpen] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (selected) return;
    if (q.trim().length < 2) {
      setResults([]);
      return;
    }
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(async () => {
      try {
        const r = await api.owners.search(q.trim(), 20);
        setResults(r);
      } catch (e) {
        console.error("Owner search failed:", e);
        setResults([]);
      }
    }, 200);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [q, selected]);

  if (selected) {
    return (
      <div className={s.selected}>
        <span className={s.id}>{selected.smart_id}</span>
        <span className={s.name}>{selected.name}</span>
        <button type="button" onClick={() => onChange(null)}>×</button>
      </div>
    );
  }

  return (
    <div className={s.wrap}>
      <input
        className={s.input}
        value={q}
        onChange={(e) => {
          setQ(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        placeholder="Поиск по smart_id, названию или артикулу"
        autoFocus
      />
      {open && q.trim().length >= 2 && (
        <div className={s.list}>
          {results.length === 0 ? (
            <div className={s.empty}>Ничего не найдено.</div>
          ) : (
            results.map((r) => (
              <button
                key={r.smart_id}
                type="button"
                className={s.item}
                onClick={() => {
                  onChange(r);
                  setOpen(false);
                }}
              >
                <span className={s.name}>{r.name}</span>
                <span className={s.id}>
                  {r.smart_id}
                  {r.articles.length ? ` · ${r.articles.join(", ")}` : ""}
                </span>
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}

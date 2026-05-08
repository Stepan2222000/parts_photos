"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import CollageGrid from "@/components/collages/CollageGrid";
import { api, ApiError } from "@/lib/api";
import type { Collage, Group } from "@/lib/types";
import s from "./page.module.css";

type Filter = "all" | "empty" | "few";
type Sort = "updated" | "count" | "owner";

interface Props {
  groups: Group[];
  initialQ: string;
  initialFilter: Filter;
  initialSort: Sort;
  initialGroupId: string;
  initialResults: Collage[];
}

const DEBOUNCE_MS = 250;

export default function SearchClient({
  groups,
  initialQ,
  initialFilter,
  initialSort,
  initialGroupId,
  initialResults,
}: Props) {
  const router = useRouter();
  const [q, setQ] = useState(initialQ);
  const [filter, setFilter] = useState<Filter>(initialFilter);
  const [sort, setSort] = useState<Sort>(initialSort);
  const [groupId, setGroupId] = useState(initialGroupId);
  const [results, setResults] = useState<Collage[]>(initialResults);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const abortRef = useRef<AbortController | null>(null);
  const firstRun = useRef(true);

  useEffect(() => {
    if (firstRun.current) {
      firstRun.current = false;
      return;
    }

    const trimmed = q.trim();
    abortRef.current?.abort();

    if (!trimmed) {
      setResults([]);
      setLoading(false);
      setError(null);
      syncUrl(trimmed, filter, sort, groupId);
      return;
    }

    const ac = new AbortController();
    abortRef.current = ac;

    const handle = window.setTimeout(async () => {
      setLoading(true);
      setError(null);
      try {
        const data = await fetchSearch(
          { q: trimmed, group_id: groupId || undefined, filter, sort },
          ac.signal,
        );
        if (!ac.signal.aborted) {
          setResults(data);
          setLoading(false);
        }
      } catch (e) {
        if (ac.signal.aborted) return;
        setLoading(false);
        if (e instanceof ApiError) setError(`API ${e.status}: ${e.body || "ошибка"}`);
        else setError(String(e));
      }
    }, DEBOUNCE_MS);

    syncUrl(trimmed, filter, sort, groupId);

    return () => {
      window.clearTimeout(handle);
      ac.abort();
    };
  }, [q, filter, sort, groupId]);

  function syncUrl(qVal: string, f: Filter, srt: Sort, gid: string) {
    const u = new URLSearchParams();
    if (qVal) u.set("q", qVal);
    if (f !== "all") u.set("filter", f);
    if (srt !== "updated") u.set("sort", srt);
    if (gid) u.set("group_id", gid);
    const qs = u.toString();
    router.replace(qs ? `/photos-search?${qs}` : "/photos-search", { scroll: false });
  }

  return (
    <>
      <div className={s.form}>
        <div className={s.inputWrap}>
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Honda, 06192-ZW9-020, smart_10001016 ..."
            className={s.input}
            autoFocus
            type="search"
          />
          {loading && <span className={s.spinner} aria-hidden />}
        </div>
        <select
          value={groupId}
          onChange={(e) => setGroupId(e.target.value)}
          className={s.select}
        >
          <option value="">Все группы</option>
          {groups.map((g) => (
            <option key={g.id} value={g.id}>
              {g.name}
            </option>
          ))}
        </select>
        <select
          value={filter}
          onChange={(e) => setFilter(e.target.value as Filter)}
          className={s.select}
        >
          <option value="all">Все коллажи</option>
          <option value="empty">Без фото</option>
          <option value="few">Меньше 3 фото</option>
        </select>
        <select
          value={sort}
          onChange={(e) => setSort(e.target.value as Sort)}
          className={s.select}
        >
          <option value="updated">По обновлению</option>
          <option value="count">По числу фото</option>
          <option value="owner">По smart-id</option>
        </select>
      </div>

      {error && <div className={s.error}>{error}</div>}

      {q.trim() ? (
        <>
          <div className={s.stats}>
            <strong className={s.statsCount}>{results.length}</strong>{" "}
            результат(ов) по запросу «{q}»
            {loading && <span className={s.statsHint}> · обновляю…</span>}
          </div>
          {results.length > 0 ? (
            <CollageGrid collages={results} showGroup />
          ) : !loading ? (
            <div className={s.empty}>Ничего не найдено.</div>
          ) : null}
        </>
      ) : (
        <div className={s.empty}>Введи запрос — поиск идёт по smart-id, названию и артикулам.</div>
      )}
    </>
  );
}

async function fetchSearch(
  params: { q: string; group_id?: string; filter: Filter; sort: Sort },
  signal: AbortSignal,
): Promise<Collage[]> {
  const u = new URLSearchParams({ q: params.q, filter: params.filter, sort: params.sort });
  if (params.group_id) u.set("group_id", params.group_id);
  const base =
    process.env.NEXT_PUBLIC_PHOTOS_API_BASE ||
    process.env.PHOTOS_API_BASE ||
    "http://localhost:8001";
  const r = await fetch(`${base}/collages/search?${u.toString()}`, {
    signal,
    cache: "no-store",
  });
  if (!r.ok) throw new ApiError(r.status, "/collages/search", await r.text());
  return r.json();
}

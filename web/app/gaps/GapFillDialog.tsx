"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { api, ApiError } from "@/lib/api";
import { isMove } from "@/lib/channels";
import type { Collage, GapRow, GapSourceCollage, GapSources, Photo } from "@/lib/types";
import s from "./gaps.module.css";

interface Props {
  gap: GapRow;
  onClose: () => void;
  onFilled: () => void;
}

/** A photo that can be picked, with the channel it currently lives in. */
interface Pick {
  photo: Photo;
  sourceGroupId: string;
  label: string;
}

function flatten(collages: GapSourceCollage[], labelOf: (c: GapSourceCollage) => string): Pick[] {
  const out: Pick[] = [];
  for (const c of collages) {
    for (const p of c.photos) {
      out.push({ photo: p, sourceGroupId: c.group_id, label: labelOf(c) });
    }
  }
  return out;
}

export default function GapFillDialog({ gap, onClose, onFilled }: Props) {
  const router = useRouter();
  const [sources, setSources] = useState<GapSources | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // Manual escape-hatch: search any collage and pull its photos in.
  const [searchQ, setSearchQ] = useState("");
  const [searchHits, setSearchHits] = useState<Collage[]>([]);
  const [manual, setManual] = useState<Pick[]>([]);
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    let alive = true;
    api.gaps
      .sources(gap.kind, {
        smartPartId: gap.smart_part_id ?? undefined,
        itemId: gap.item_id ?? undefined,
      })
      .then((r) => alive && setSources(r))
      .catch((e) => alive && setErr(String(e)));
    return () => {
      alive = false;
    };
  }, [gap]);

  const realPicks = useMemo(
    () =>
      sources
        ? flatten(sources.real, (c) =>
            c.item_id != null ? `#${c.item_id}${c.condition ? ` · ${c.condition}` : ""}` : "Реальные",
          )
        : [],
    [sources],
  );
  const freePicks = useMemo(
    () => (sources ? flatten(sources.free, (c) => c.title || "Свободный коллаж") : []),
    [sources],
  );

  const groupOf = useMemo(() => {
    const m: Record<string, string> = {};
    for (const p of [...realPicks, ...freePicks, ...manual]) m[p.photo.id] = p.sourceGroupId;
    return m;
  }, [realPicks, freePicks, manual]);

  const tally = useMemo(() => {
    let move = 0;
    let copy = 0;
    for (const id of selected) {
      if (isMove(groupOf[id] ?? "", gap.target_group_id)) move++;
      else copy++;
    }
    return { move, copy };
  }, [selected, groupOf, gap.target_group_id]);

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function runSearch(value: string) {
    setSearchQ(value);
    if (searchTimer.current) clearTimeout(searchTimer.current);
    if (!value.trim()) {
      setSearchHits([]);
      return;
    }
    searchTimer.current = setTimeout(async () => {
      try {
        setSearchHits(await api.collages.search({ q: value.trim(), limit: 30 }));
      } catch {
        setSearchHits([]);
      }
    }, 250);
  }

  async function addManual(collage: Collage) {
    if (manual.some((p) => p.photo.collage_id === collage.id)) return;
    try {
      const detail = await api.collages.get(collage.id);
      const label = detail.title || detail.owner_name || detail.group_name || "Коллаж";
      const picks = detail.photos
        .filter((p) => p.state === "uploaded" && !p.mime.startsWith("video/"))
        .map((p) => ({ photo: p, sourceGroupId: detail.group_id, label }));
      setManual((m) => [...m, ...picks]);
    } catch (e) {
      setErr(String(e));
    }
  }

  async function doFill() {
    if (selected.size === 0) return;
    setBusy(true);
    setErr(null);
    try {
      await api.gaps.fill({
        target_group_id: gap.target_group_id,
        target_owner_kind: gap.target_owner_kind,
        target_owner_id: gap.target_owner_id,
        photo_ids: [...selected],
      });
      onFilled();
    } catch (e) {
      setErr(e instanceof ApiError ? e.body || String(e) : String(e));
      setBusy(false);
    }
  }

  function doUpgrade() {
    if (selected.size === 0) return;
    const ids = [...selected].map(encodeURIComponent).join(",");
    router.push(`/studio?source_photo_ids=${ids}`);
  }

  const targetIsPub = gap.kind !== "reference";
  const fillSub =
    tally.move > 0 && tally.copy > 0
      ? `${tally.move} уйдут из Реальных · ${tally.copy} копий`
      : tally.move > 0
        ? "фото уйдут из Реальных"
        : "копия — исходники остаются";
  const upgradeSub = tally.move > 0 ? "после приёмки уйдут из Реальных" : "исходники остаются";

  const id = gap.smart_part_id ?? (gap.item_id != null ? `#${gap.item_id}` : "");

  return createPortal(
    <div className={s.backdrop} onClick={onClose}>
      <div className={s.dialog} onClick={(e) => e.stopPropagation()}>
        <div className={s.dlgHead}>
          <div>
            <h2 className={s.dlgTitle}>{gap.name || id}</h2>
            <div className={s.dlgSub}>
              <span className={s.mono}>{id}</span>
              {gap.articles.length > 0 && <span className={s.dim}> · {gap.articles.slice(0, 4).join(" · ")}</span>}
            </div>
          </div>
          <button type="button" className={s.x} onClick={onClose} aria-label="Закрыть">
            ✕
          </button>
        </div>

        <div className={s.fateNote}>
          {targetIsPub
            ? "На публикацию: из «Реальных» — перенос (фото уйдут из Реальных); из «Свободных» и поиска — копия (остаются)."
            : "Эталонные: фото копируются — исходники остаются в источнике."}
        </div>

        <div className={s.dlgBody}>
          {!sources ? (
            <div className={s.muted}>Загрузка источников…</div>
          ) : (
            <>
              <Section
                title={
                  targetIsPub
                    ? "Реальные фото — перенос, уйдут из Реальных"
                    : "Реальные фото — копия, остаются"
                }
                picks={realPicks}
                selected={selected}
                onToggle={toggle}
                empty="Нет реальных фото."
              />
              <Section
                title="Свободные коллажи — копия, остаются"
                picks={freePicks}
                selected={selected}
                onToggle={toggle}
                empty="Нет свободных коллажей."
              />

              <div className={s.section}>
                <div className={s.sectionTitle}>Поиск — любые фото (через силу)</div>
                <input
                  className={s.search}
                  placeholder="Найти коллаж по названию / артикулу / smart-id"
                  value={searchQ}
                  onChange={(e) => runSearch(e.target.value)}
                />
                {searchHits.length > 0 && (
                  <div className={s.hits}>
                    {searchHits.map((c) => (
                      <button
                        key={c.id}
                        type="button"
                        className={s.hit}
                        onClick={() => addManual(c)}
                        disabled={manual.some((p) => p.photo.collage_id === c.id)}
                      >
                        + {c.title || c.owner_name || c.owner_id || "коллаж"}
                        <span className={s.dim}> · {c.group_name} · {c.photos_count} фото</span>
                      </button>
                    ))}
                  </div>
                )}
                {manual.length > 0 && (
                  <PhotoStrip picks={manual} selected={selected} onToggle={toggle} />
                )}
              </div>
            </>
          )}
        </div>

        {err && <div className={s.error}>{err}</div>}

        <div className={s.dlgFoot}>
          <span className={s.footCount}>{selected.size} выбрано</span>
          <div className={s.footActions}>
            <button type="button" className={s.btn} onClick={onClose} disabled={busy}>
              Отмена
            </button>
            <button
              type="button"
              className={s.btnGhost}
              onClick={doUpgrade}
              disabled={busy || selected.size === 0}
              title={upgradeSub}
            >
              <span>Апгрейдить → ({selected.size})</span>
              <span className={s.btnSub}>{upgradeSub}</span>
            </button>
            <button
              type="button"
              className={s.btnPrimary}
              onClick={doFill}
              disabled={busy || selected.size === 0}
              title={fillSub}
            >
              <span>{busy ? "Переношу…" : `Заполнить (${selected.size})`}</span>
              <span className={s.btnSub}>{fillSub}</span>
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}

function Section({
  title,
  picks,
  selected,
  onToggle,
  empty,
}: {
  title: string;
  picks: Pick[];
  selected: Set<string>;
  onToggle: (id: string) => void;
  empty: string;
}) {
  return (
    <div className={s.section}>
      <div className={s.sectionTitle}>{title}</div>
      {picks.length === 0 ? (
        <div className={s.muted}>{empty}</div>
      ) : (
        <PhotoStrip picks={picks} selected={selected} onToggle={onToggle} />
      )}
    </div>
  );
}

function PhotoStrip({
  picks,
  selected,
  onToggle,
}: {
  picks: Pick[];
  selected: Set<string>;
  onToggle: (id: string) => void;
}) {
  return (
    <div className={s.strip}>
      {picks.map((p) => {
        const on = selected.has(p.photo.id);
        return (
          <button
            key={p.photo.id}
            type="button"
            className={`${s.thumb} ${on ? s.thumbOn : ""}`}
            onClick={() => onToggle(p.photo.id)}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={p.photo.url} alt="" />
            {on && <span className={s.check}>✓</span>}
            <span className={s.thumbLabel}>{p.label}</span>
          </button>
        );
      })}
    </div>
  );
}

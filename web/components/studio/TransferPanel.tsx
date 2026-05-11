"use client";

import { useEffect, useMemo, useState } from "react";
import { api } from "@/lib/api";
import type {
  JobSuggestions,
  LookupItem,
  StudioBatchDetail,
  StudioJob,
} from "@/lib/types";
import s from "./TransferPanel.module.css";

interface TargetGroup {
  id: string;
  name: string;
  defect_filter: "with" | "without" | "any";
}

interface Props {
  batch: StudioBatchDetail;
  onTransferred: () => Promise<void> | void;
}

type ManualPick = { itemId: number; smartPartId: string; smartPartName: string | null };

/** Per-job state inside the currently active target group. */
type RowState =
  | { kind: "pick"; items: SuggestedItem[] }       // 1+ candidate items, default pick made
  | { kind: "manual"; pick: ManualPick }            // user picked via manual lookup
  | { kind: "no-defect-match" }                     // smart_part found but no items pass filter
  | { kind: "no-smart-match" };                     // filename doesn't map to any smart_part

interface SuggestedItem {
  item_id: number;
  defect: boolean;
  defect_note: string | null;
  existing_collage_id: string | null;
}

export default function TransferPanel({ batch, onTransferred }: Props) {
  const [groups, setGroups] = useState<TargetGroup[]>([]);
  const [activeGroup, setActiveGroup] = useState<string | null>(null);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [pickedItems, setPickedItems] = useState<Map<string, number>>(new Map());
  const [manualPicks, setManualPicks] = useState<Map<string, ManualPick>>(new Map());
  const [busy, setBusy] = useState(false);

  const eligibleJobs = useMemo(
    () => batch.jobs.filter((j) => j.status === "succeeded" && !j.transferred_to_photo_id),
    [batch.jobs],
  );

  useEffect(() => {
    api.studio.targetGroups().then(setGroups).catch(() => setGroups([]));
  }, []);

  // Per-group counts shown in the tab labels.
  const groupCounts = useMemo(() => {
    const out: Record<string, number> = {};
    for (const g of groups) {
      let n = 0;
      for (const j of eligibleJobs) {
        const items = j.suggestions?.items_by_group?.[g.id];
        if ((items && items.length > 0) || manualPicks.has(j.id + ":" + g.id)) n++;
      }
      out[g.id] = n;
    }
    return out;
  }, [groups, eligibleJobs, manualPicks]);

  // Auto-select sensible defaults when active group changes.
  useEffect(() => {
    if (!activeGroup) {
      setPicked(new Set());
      setPickedItems(new Map());
      return;
    }
    const nextPicked = new Set<string>();
    const nextItems = new Map<string, number>();
    for (const j of eligibleJobs) {
      const m = manualPicks.get(j.id + ":" + activeGroup);
      if (m) {
        nextItems.set(j.id, m.itemId);
        nextPicked.add(j.id);
        continue;
      }
      const items = j.suggestions?.items_by_group?.[activeGroup];
      if (!items || items.length === 0) continue;
      nextItems.set(j.id, items[0].item_id);
      nextPicked.add(j.id);
    }
    setPicked(nextPicked);
    setPickedItems(nextItems);
  }, [activeGroup, eligibleJobs, manualPicks]);

  if (eligibleJobs.length === 0) return null;

  async function transferSelected() {
    if (busy || !activeGroup || picked.size === 0) return;
    setBusy(true);
    try {
      const transfers = Array.from(picked)
        .map((jobId) => {
          const itemId = pickedItems.get(jobId);
          return itemId == null ? null : { job_id: jobId, group_id: activeGroup, item_id: itemId };
        })
        .filter((x): x is { job_id: string; group_id: string; item_id: number } => x !== null);
      if (transfers.length === 0) return;
      await api.studio.transfers(batch.id, transfers);
      await onTransferred();
    } catch (e) {
      alert(`Не удалось перенести: ${e}`);
    } finally {
      setBusy(false);
    }
  }

  const allCheckable = eligibleJobs.filter((j) => {
    if (!activeGroup) return false;
    if (manualPicks.has(j.id + ":" + activeGroup)) return true;
    const items = j.suggestions?.items_by_group?.[activeGroup];
    return !!(items && items.length > 0);
  });
  const allOn = allCheckable.length > 0 && allCheckable.every((j) => picked.has(j.id));

  return (
    <section className={s.panel}>
      <header className={s.head}>
        <div className={s.headLeft}>
          <h3 className={s.title}>Перенести в коллаж</h3>
          <p className={s.sub}>
            {eligibleJobs.length} результат{plural(eligibleJobs.length, "", "а", "ов")} ждут переноса.
            {" "}Выбери группу — для каждого подскажу куда положить или создам новый коллаж под нужный экземпляр.
          </p>
        </div>
      </header>

      <nav className={s.tabs}>
        {groups.map((g) => {
          const n = groupCounts[g.id] ?? 0;
          const isActive = activeGroup === g.id;
          return (
            <button
              key={g.id}
              className={`${s.tab} ${isActive ? s.tabActive : ""}`}
              onClick={() => setActiveGroup(isActive ? null : g.id)}
            >
              <span className={s.tabName}>{g.name}</span>
              <span className={s.tabMeta}>
                {n > 0 ? `${n} готов${plural(n, "о", "ы", "ы")}` : "—"}
                {g.defect_filter === "with" && <em className={s.filterChip}>дефектные</em>}
                {g.defect_filter === "without" && <em className={s.filterChip}>без дефектов</em>}
              </span>
            </button>
          );
        })}
      </nav>

      {!activeGroup ? (
        <div className={s.empty}>
          <div className={s.emptyIcon}>↑</div>
          <div className={s.emptyText}>Выбери группу выше — покажу варианты переноса для каждого фото.</div>
        </div>
      ) : (
        <>
          <div className={s.toolbar}>
            <label className={s.allLbl}>
              <input
                type="checkbox"
                checked={allOn}
                disabled={allCheckable.length === 0}
                onChange={(e) => {
                  if (!activeGroup) return;
                  if (e.target.checked) {
                    setPicked(new Set(allCheckable.map((j) => j.id)));
                  } else {
                    setPicked(new Set());
                  }
                }}
              />
              <span>Выбрать все ({allCheckable.length})</span>
            </label>
            <span className={s.toolbarRight}>выбрано {picked.size}</span>
          </div>

          <ul className={s.rows}>
            {eligibleJobs.map((j) => (
              <JobRow
                key={j.id}
                job={j}
                groupId={activeGroup}
                checked={picked.has(j.id)}
                pickedItemId={pickedItems.get(j.id) ?? null}
                manualPick={manualPicks.get(j.id + ":" + activeGroup) ?? null}
                onToggle={(on) =>
                  setPicked((cur) => {
                    const next = new Set(cur);
                    if (on) next.add(j.id);
                    else next.delete(j.id);
                    return next;
                  })
                }
                onPickItem={(itemId) =>
                  setPickedItems((cur) => new Map(cur).set(j.id, itemId))
                }
                onManual={(p) =>
                  setManualPicks((cur) => {
                    const next = new Map(cur);
                    next.set(j.id + ":" + activeGroup, p);
                    return next;
                  })
                }
              />
            ))}
          </ul>

          <div className={s.actionBar}>
            <button
              className={s.cta}
              onClick={transferSelected}
              disabled={busy || picked.size === 0}
            >
              {busy ? "Переношу…" : `Перенести выбранные (${picked.size})`}
            </button>
          </div>
        </>
      )}
    </section>
  );
}

// ─── one job row ────────────────────────────────────────────────────────────

interface RowProps {
  job: StudioJob;
  groupId: string;
  checked: boolean;
  pickedItemId: number | null;
  manualPick: ManualPick | null;
  onToggle: (on: boolean) => void;
  onPickItem: (itemId: number) => void;
  onManual: (p: ManualPick) => void;
}

function JobRow({
  job, groupId, checked, pickedItemId, manualPick,
  onToggle, onPickItem, onManual,
}: RowProps) {
  const [manualOpen, setManualOpen] = useState(false);
  const sug = job.suggestions;
  const items: SuggestedItem[] = sug?.items_by_group?.[groupId] ?? [];
  const filename = job.source_filename || job.id.slice(0, 8);

  let state: RowState;
  if (manualPick) state = { kind: "manual", pick: manualPick };
  else if (sug && items.length > 0) state = { kind: "pick", items };
  else if (sug) state = { kind: "no-defect-match" };
  else state = { kind: "no-smart-match" };

  const checkable = state.kind === "pick" || state.kind === "manual";

  return (
    <li className={`${s.row} ${checked ? s.rowOn : ""} ${!checkable ? s.rowMuted : ""}`}>
      <div className={s.rowTop}>
        <input
          type="checkbox"
          className={s.check}
          checked={checked}
          disabled={!checkable}
          onChange={(e) => onToggle(e.target.checked)}
        />
        <div className={s.thumb}>
          {job.result_url ? <img src={job.result_url} alt="" /> : null}
        </div>
        <div className={s.heading}>
          <div className={s.partName}>
            {state.kind === "manual" && (state.pick.smartPartName || state.pick.smartPartId)}
            {state.kind === "pick" && (sug!.smart_part_name || sug!.smart_part_id)}
            {state.kind === "no-defect-match" && (sug!.smart_part_name || sug!.smart_part_id)}
            {state.kind === "no-smart-match" && <span className={s.faintItalic}>Не распознано</span>}
          </div>
          <div className={s.fileMeta}>
            <code className={s.fname}>{filename}</code>
            {state.kind === "pick" && sug && (
              <>
                <span className={s.dot}>·</span>
                <span className={s.matched}>matched: <code>{sug.matched_article}</code></span>
              </>
            )}
            {state.kind === "manual" && (
              <>
                <span className={s.dot}>·</span>
                <span className={s.matched}>вручную: <code>{state.pick.smartPartId}</code></span>
              </>
            )}
          </div>
        </div>
      </div>

      <div className={s.rowBody}>
        {state.kind === "pick" && (
          <ItemPicker
            items={state.items}
            pickedItemId={pickedItemId ?? state.items[0].item_id}
            onPickItem={onPickItem}
          />
        )}
        {state.kind === "manual" && (
          <div className={s.manualCard}>
            <span className={s.itemBadge}>Item #{state.pick.itemId}</span>
            <span className={s.itemMode}>создастся новый коллаж</span>
            <button
              className={s.manualReset}
              onClick={() => {
                onManual({ itemId: 0, smartPartId: "", smartPartName: null });
                setManualOpen(true);
              }}
              title="Перевыбрать"
            >
              сменить
            </button>
          </div>
        )}
        {state.kind === "no-defect-match" && (
          <div className={s.note}>
            <span className={s.warn}>—</span> в этой группе нет подходящих экземпляров для{" "}
            <code>{sug!.smart_part_id}</code>
          </div>
        )}
        {state.kind === "no-smart-match" && (
          <div className={s.noteRow}>
            <div className={s.note}>
              <span className={s.warn}>⚠</span> имя файла не нашлось в smart-каталоге
            </div>
            <button
              className={s.findBtn}
              onClick={() => setManualOpen((o) => !o)}
            >
              {manualOpen ? "Скрыть поиск" : "Найти запчасть вручную"}
            </button>
          </div>
        )}
      </div>

      {manualOpen && (state.kind === "no-smart-match" || (state.kind === "manual" && manualPick?.itemId === 0)) && (
        <ManualLookup
          groupId={groupId}
          onPicked={(itemId, smartPartId, smartPartName) => {
            onManual({ itemId, smartPartId, smartPartName });
            onPickItem(itemId);
            onToggle(true);
            setManualOpen(false);
          }}
        />
      )}
    </li>
  );
}

function ItemPicker({
  items, pickedItemId, onPickItem,
}: {
  items: SuggestedItem[];
  pickedItemId: number;
  onPickItem: (id: number) => void;
}) {
  // Single item — show as chip, no choice needed.
  if (items.length === 1) {
    const it = items[0];
    return (
      <div className={s.singleCard}>
        <span className={s.itemBadge}>Item #{it.item_id}</span>
        {it.defect && <span className={s.defectChip}>дефект</span>}
        <span className={s.itemMode}>
          {it.existing_collage_id ? "→ добавится в существующий коллаж" : "➕ создастся новый коллаж"}
        </span>
      </div>
    );
  }
  // Multiple items — render as click-cards.
  return (
    <div className={s.itemGrid}>
      {items.map((it) => {
        const active = it.item_id === pickedItemId;
        return (
          <button
            key={it.item_id}
            type="button"
            className={`${s.itemCard} ${active ? s.itemCardActive : ""}`}
            onClick={() => onPickItem(it.item_id)}
          >
            <span className={s.itemRadio} aria-hidden>
              {active ? "●" : "○"}
            </span>
            <span className={s.itemBadge}>Item #{it.item_id}</span>
            {it.defect && <span className={s.defectChip}>дефект</span>}
            <span className={s.itemMode}>
              {it.existing_collage_id ? "уже есть коллаж" : "будет создан"}
            </span>
            {it.defect_note && (
              <span className={s.itemNote} title={it.defect_note}>
                {it.defect_note.slice(0, 40)}{it.defect_note.length > 40 ? "…" : ""}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}

// ─── manual lookup ──────────────────────────────────────────────────────────

function ManualLookup({
  groupId, onPicked,
}: {
  groupId: string;
  onPicked: (itemId: number, smartPartId: string, smartPartName: string | null) => void;
}) {
  const [q, setQ] = useState("");
  const [parts, setParts] = useState<{ smart_id: string; name: string; articles: string[] }[]>([]);
  const [activePart, setActivePart] = useState<{ id: string; name: string } | null>(null);
  const [items, setItems] = useState<LookupItem[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (q.length < 2) { setParts([]); return; }
    const t = setTimeout(async () => {
      try {
        const r = await api.owners.search(q, 8);
        setParts(r);
      } catch {
        setParts([]);
      }
    }, 200);
    return () => clearTimeout(t);
  }, [q]);

  async function pickPart(smartId: string, name: string) {
    setActivePart({ id: smartId, name });
    setLoading(true);
    setItems([]);
    try {
      const r = await api.studio.lookup(smartId, groupId);
      setItems(r);
    } catch (e) {
      alert(`Не удалось загрузить экземпляры: ${e}`);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className={s.lookup}>
      <input
        autoFocus
        className={s.lookupInput}
        placeholder="артикул, smart-id или название…"
        value={q}
        onChange={(e) => setQ(e.target.value)}
      />
      {!activePart && parts.length > 0 && (
        <ul className={s.lookupList}>
          {parts.map((p) => (
            <li
              key={p.smart_id}
              className={s.lookupRow}
              onClick={() => pickPart(p.smart_id, p.name)}
            >
              <div className={s.lookupRowMain}>
                <span className={s.lookupName}>{p.name}</span>
                <code className={s.lookupSmart}>{p.smart_id}</code>
              </div>
              {p.articles[0] && (
                <code className={s.lookupArticle}>{p.articles[0]}</code>
              )}
            </li>
          ))}
        </ul>
      )}
      {activePart && (
        <div className={s.lookupItems}>
          <div className={s.lookupActive}>
            <strong>{activePart.name}</strong>
            <code>{activePart.id}</code>
            <button className={s.lookupBack} onClick={() => setActivePart(null)}>
              ← сменить запчасть
            </button>
          </div>
          {loading && <div className={s.note}>Загрузка экземпляров…</div>}
          {!loading && items.length === 0 && (
            <div className={s.note}>
              <span className={s.warn}>—</span> нет подходящих экземпляров для этой группы
            </div>
          )}
          {items.length > 0 && (
            <div className={s.itemGrid}>
              {items.map((it) => (
                <button
                  key={it.item_id}
                  type="button"
                  className={s.itemCard}
                  onClick={() => onPicked(it.item_id, activePart.id, activePart.name)}
                >
                  <span className={s.itemBadge}>Item #{it.item_id}</span>
                  {it.defect && <span className={s.defectChip}>дефект</span>}
                  <span className={s.itemMode}>
                    {it.existing_collage_id ? "уже есть коллаж" : "будет создан"}
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function plural(n: number, one: string, few: string, many: string): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return one;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return few;
  return many;
}

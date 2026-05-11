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

// What the user has chosen (or what we have inferred) for one job inside one
// target group. `kind` drives the row UI; `itemId` is the to-be-transferred
// target.
type Pick =
  | { kind: "auto"; itemId: number; existing: boolean }
  | { kind: "manual"; itemId: number; smartPartId: string; smartPartName: string | null }
  | { kind: "needs-pick" }
  | { kind: "no-defect-match" }
  | { kind: "no-smart-match" };

export default function TransferPanel({ batch, onTransferred }: Props) {
  const [groups, setGroups] = useState<TargetGroup[]>([]);
  const [activeGroup, setActiveGroup] = useState<string | null>(null);
  const [picked, setPicked] = useState<Set<string>>(new Set()); // job ids
  const [pickedItems, setPickedItems] = useState<Map<string, number>>(new Map()); // jobId → itemId
  const [manualPicks, setManualPicks] = useState<
    Map<string, { itemId: number; smartPartId: string; smartPartName: string | null }>
  >(new Map());
  const [busy, setBusy] = useState(false);

  // Eligible jobs = succeeded, not yet transferred. Filtering once for the
  // panel to show progress to the user even when active group is null.
  const eligibleJobs = useMemo(
    () => batch.jobs.filter((j) => j.status === "succeeded" && !j.transferred_to_photo_id),
    [batch.jobs],
  );

  useEffect(() => {
    api.studio.targetGroups().then(setGroups).catch(() => setGroups([]));
  }, []);

  // Reset picks when active group changes — auto-select rows that have a
  // sensible default (existing collage / will-create / first of many).
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

  const activeGroupObj = groups.find((g) => g.id === activeGroup) || null;

  async function transferSelected() {
    if (busy || !activeGroup || picked.size === 0) return;
    setBusy(true);
    try {
      const transfers: { job_id: string; group_id: string; item_id: number }[] = [];
      for (const jobId of picked) {
        const itemId = pickedItems.get(jobId);
        if (itemId == null) continue;
        transfers.push({ job_id: jobId, group_id: activeGroup, item_id: itemId });
      }
      if (transfers.length === 0) return;
      await api.studio.transfers(batch.id, transfers);
      await onTransferred();
    } catch (e) {
      alert(`Не удалось перенести: ${e}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className={s.card}>
      <header className={s.head}>
        <div>
          <h3 className={s.title}>Перенести в коллаж</h3>
          <p className={s.sub}>
            Выбери группу — для каждого готового результата подскажу куда положить
            (или создать новый коллаж под нужный экземпляр).
          </p>
        </div>
        {activeGroup && (
          <button
            className={s.cta}
            onClick={transferSelected}
            disabled={busy || picked.size === 0}
          >
            {busy ? "Переношу…" : `Перенести (${picked.size})`}
          </button>
        )}
      </header>

      <nav className={s.tabs}>
        {groups.map((g) => (
          <button
            key={g.id}
            className={`${s.tab} ${activeGroup === g.id ? s.tabActive : ""}`}
            onClick={() => setActiveGroup(g.id === activeGroup ? null : g.id)}
          >
            {g.name}
          </button>
        ))}
      </nav>

      {!activeGroup ? (
        <div className={s.empty}>Выбери группу выше — покажу варианты.</div>
      ) : (
        <ul className={s.rows}>
          {eligibleJobs.map((j) => (
            <JobRow
              key={j.id}
              job={j}
              group={activeGroupObj!}
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
      )}
    </section>
  );
}

// ─── one row ────────────────────────────────────────────────────────────────

interface RowProps {
  job: StudioJob;
  group: TargetGroup;
  checked: boolean;
  pickedItemId: number | null;
  manualPick:
    | { itemId: number; smartPartId: string; smartPartName: string | null }
    | null;
  onToggle: (on: boolean) => void;
  onPickItem: (itemId: number) => void;
  onManual: (p: { itemId: number; smartPartId: string; smartPartName: string | null }) => void;
}

function JobRow({
  job, group, checked, pickedItemId, manualPick,
  onToggle, onPickItem, onManual,
}: RowProps) {
  const [manualOpen, setManualOpen] = useState(false);
  const sug = job.suggestions;
  const items = sug?.items_by_group?.[group.id] ?? [];
  const filename = job.source_filename || job.id.slice(0, 8);

  // Determine state. Manual pick wins everything.
  let state: Pick;
  if (manualPick) {
    state = { kind: "manual", ...manualPick };
  } else if (sug && items.length > 0) {
    state = items.length === 1
      ? { kind: "auto", itemId: items[0].item_id, existing: !!items[0].existing_collage_id }
      : { kind: "needs-pick" };
  } else if (sug && items.length === 0) {
    state = { kind: "no-defect-match" };
  } else {
    state = { kind: "no-smart-match" };
  }

  const checkable =
    state.kind === "auto" || state.kind === "needs-pick" || state.kind === "manual";

  return (
    <li className={`${s.row} ${checked ? s.rowOn : ""} ${!checkable ? s.rowGrey : ""}`}>
      <div className={s.rowMain}>
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
        <div className={s.body}>
          <div className={s.fname}>{filename}</div>
          <RowDetail
            state={state}
            items={items}
            sug={sug}
            pickedItemId={pickedItemId}
            onPickItem={onPickItem}
          />
        </div>
        {state.kind === "no-smart-match" && (
          <button
            className={s.findBtn}
            onClick={() => setManualOpen((o) => !o)}
          >
            {manualOpen ? "Скрыть" : "Найти запчасть"}
          </button>
        )}
      </div>
      {manualOpen && state.kind === "no-smart-match" && (
        <ManualLookup
          groupId={group.id}
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

function RowDetail({
  state, items, sug, pickedItemId, onPickItem,
}: {
  state: Pick;
  items: { item_id: number; defect: boolean; defect_note: string | null; existing_collage_id: string | null }[];
  sug: JobSuggestions | null;
  pickedItemId: number | null;
  onPickItem: (id: number) => void;
}) {
  if (state.kind === "no-smart-match") {
    return <div className={s.muted}>имя файла не распознано — найди запчасть вручную</div>;
  }
  if (state.kind === "no-defect-match") {
    return (
      <div className={s.muted}>
        {sug && (
          <>
            <code className={s.mono}>{sug.matched_article}</code> →{" "}
            {sug.smart_part_name || sug.smart_part_id}
            <span className={s.muted2}> · нет подходящих экземпляров для этой группы</span>
          </>
        )}
      </div>
    );
  }
  if (state.kind === "manual") {
    return (
      <div className={s.detail}>
        <span className={s.target}>→ Item #{state.itemId}</span>
        <span className={s.muted2}>
          {state.smartPartName || state.smartPartId} · вручную
        </span>
      </div>
    );
  }
  if (state.kind === "auto") {
    const it = items[0];
    return (
      <div className={s.detail}>
        <span className={s.target}>
          {state.existing ? "→" : "➕"} Item #{state.itemId}
        </span>
        <span className={s.muted2}>
          {sug?.smart_part_name || sug?.smart_part_id}
          {it.defect ? <em className={s.defectChip}>дефект</em> : null}
          {state.existing ? " · добавится в существующий" : " · создастся новый коллаж"}
        </span>
      </div>
    );
  }
  // needs-pick
  return (
    <div className={s.detail}>
      <select
        className={s.select}
        value={pickedItemId ?? items[0].item_id}
        onChange={(e) => onPickItem(Number(e.target.value))}
      >
        {items.map((it) => (
          <option key={it.item_id} value={it.item_id}>
            Item #{it.item_id}
            {it.defect ? " (дефект)" : ""}
            {it.existing_collage_id ? " — уже есть" : " — создастся"}
          </option>
        ))}
      </select>
      <span className={s.muted2}>
        {sug?.smart_part_name || sug?.smart_part_id} · {items.length} экземпляра
      </span>
    </div>
  );
}

// ─── manual lookup ──────────────────────────────────────────────────────────

function ManualLookup({
  groupId,
  onPicked,
}: {
  groupId: string;
  onPicked: (itemId: number, smartPartId: string, smartPartName: string | null) => void;
}) {
  const [q, setQ] = useState("");
  const [parts, setParts] = useState<{ smart_id: string; name: string; articles: string[] }[]>([]);
  const [activePart, setActivePart] = useState<{ id: string; name: string } | null>(null);
  const [items, setItems] = useState<LookupItem[]>([]);
  const [loading, setLoading] = useState(false);

  // Debounced part search
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
        placeholder="артикул или smart-id…"
        value={q}
        onChange={(e) => setQ(e.target.value)}
      />
      {parts.length > 0 && !activePart && (
        <ul className={s.lookupList}>
          {parts.map((p) => (
            <li
              key={p.smart_id}
              className={s.lookupRow}
              onClick={() => pickPart(p.smart_id, p.name)}
            >
              <span className={s.lookupName}>{p.name}</span>
              <code className={s.lookupSmart}>{p.smart_id}</code>
            </li>
          ))}
        </ul>
      )}
      {activePart && (
        <div className={s.lookupItems}>
          <div className={s.lookupActive}>
            <strong>{activePart.name}</strong> · <code>{activePart.id}</code>
            <button className={s.lookupBack} onClick={() => setActivePart(null)}>
              сменить
            </button>
          </div>
          {loading && <div className={s.muted}>Загрузка…</div>}
          {!loading && items.length === 0 && (
            <div className={s.muted}>
              нет подходящих экземпляров для этой группы
            </div>
          )}
          {items.map((it) => (
            <button
              key={it.item_id}
              className={s.lookupItem}
              onClick={() => onPicked(it.item_id, activePart.id, activePart.name)}
            >
              <span>Item #{it.item_id}</span>
              {it.defect ? <span className={s.defectChip}>дефект</span> : null}
              {it.existing_collage_id ? (
                <span className={s.muted2}>уже есть коллаж</span>
              ) : (
                <span className={s.muted2}>будет создан</span>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

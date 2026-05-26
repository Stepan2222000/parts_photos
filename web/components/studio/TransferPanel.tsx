"use client";

import { useEffect, useMemo, useState } from "react";
import { api } from "@/lib/api";
import type {
  GroupSuggestion,
  LookupItem,
  StudioBatchDetail,
  StudioJob,
  TargetGroup,
  TransferRules,
} from "@/lib/types";
import s from "./TransferPanel.module.css";

interface Props {
  batch: StudioBatchDetail;
  onTransferred: () => Promise<void> | void;
}

type ManualPick =
  | { kind: "instance"; itemId: number; smartPartId: string; smartPartName: string | null }
  | { kind: "smart_part"; smartPartId: string; smartPartName: string | null };

/** Per-(job, target group) computed state. Forbidden rows are filtered out
 *  upstream (visibleJobs), so this union doesn't include "forbidden". */
type RowState =
  | { kind: "smart-existing"; smartPartId: string; smartPartName: string | null; collageId: string }
  | { kind: "smart-create"; smartPartId: string; smartPartName: string | null }
  | { kind: "instance-pick"; items: SuggestedItem[] }
  | { kind: "manual"; pick: ManualPick }
  | { kind: "no-condition-match" }
  | { kind: "no-smart-match" };

interface SuggestedItem {
  item_id: number;
  condition: string;
  condition_note: string | null;
  existing_collage_id: string | null;
}

export default function TransferPanel({ batch, onTransferred }: Props) {
  const [groups, setGroups] = useState<TargetGroup[]>([]);
  const [rules, setRules] = useState<TransferRules | null>(null);
  const [active, setActive] = useState<string | null>(null);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [pickedItems, setPickedItems] = useState<Map<string, number>>(new Map());
  const [manualPicks, setManualPicks] = useState<Map<string, ManualPick>>(new Map());
  const [busy, setBusy] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);

  // Eligible jobs = succeeded, not yet transferred.
  const eligibleJobs = useMemo(
    () => batch.jobs.filter((j) => j.status === "succeeded" && !j.transferred_to_photo_id),
    [batch.jobs],
  );

  useEffect(() => {
    api.studio.targetGroups().then(setGroups).catch(() => setGroups([]));
    api.studio.transferRules().then(setRules).catch(() => setRules({ allowed: {} }));
  }, []);

  // Filter jobs allowed in this target tab by source→target matrix.
  function isAllowed(jobSourceGroup: string | null, targetId: string): boolean {
    if (!rules) return false;
    const list = rules.allowed[targetId] || [];
    if (jobSourceGroup === null) return list.includes("upload");
    return list.includes(jobSourceGroup);
  }

  // Per-group counts: jobs whose matrix-allows AND have a pickable suggestion.
  const groupCounts = useMemo(() => {
    const out: Record<string, number> = {};
    for (const g of groups) {
      let n = 0;
      for (const j of eligibleJobs) {
        if (!isAllowed(j.source_group_id, g.id)) continue;
        const k = pickableState(j, g, manualPicks).kind;
        if (k !== "no-smart-match" && k !== "no-condition-match") {
          n++;
        }
      }
      out[g.id] = n;
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [groups, eligibleJobs, rules, manualPicks]);

  // Auto-select sensible defaults whenever the active tab changes.
  useEffect(() => {
    if (!active) {
      setPicked(new Set());
      setPickedItems(new Map());
      return;
    }
    const target = groups.find((g) => g.id === active);
    if (!target) return;
    const nextPicked = new Set<string>();
    const nextItems = new Map<string, number>();
    for (const j of eligibleJobs) {
      if (!isAllowed(j.source_group_id, active)) continue;
      const st = pickableState(j, target, manualPicks);
      if (st.kind === "smart-existing" || st.kind === "smart-create") {
        nextPicked.add(j.id);
      } else if (st.kind === "instance-pick") {
        nextItems.set(j.id, st.items[0].item_id);
        nextPicked.add(j.id);
      } else if (st.kind === "manual") {
        if (st.pick.kind === "instance") nextItems.set(j.id, st.pick.itemId);
        nextPicked.add(j.id);
      }
    }
    setPicked(nextPicked);
    setPickedItems(nextItems);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, eligibleJobs, manualPicks, groups, rules]);

  if (eligibleJobs.length === 0) return null;

  const target = active ? groups.find((g) => g.id === active) || null : null;
  const visibleJobs = active ? eligibleJobs.filter((j) => isAllowed(j.source_group_id, active)) : [];

  const checkableJobs = visibleJobs.filter((j) => {
    if (!target) return false;
    const st = pickableState(j, target, manualPicks);
    return st.kind === "smart-existing"
        || st.kind === "smart-create"
        || st.kind === "instance-pick"
        || st.kind === "manual";
  });
  const allOn = checkableJobs.length > 0 && checkableJobs.every((j) => picked.has(j.id));

  async function transferSelected() {
    if (busy || !active || !target || picked.size === 0) return;
    setBusy(true);
    try {
      const transfers = Array.from(picked).map((jobId) => {
        const job = eligibleJobs.find((j) => j.id === jobId);
        if (!job) return null;
        if (target.owner_kind === "smart_part") {
          const st = pickableState(job, target, manualPicks);
          const smartPartId =
            st.kind === "smart-existing" || st.kind === "smart-create"
              ? st.smartPartId
              : st.kind === "manual" && st.pick.kind === "smart_part"
                ? st.pick.smartPartId
                : null;
          if (smartPartId == null) return null;
          return { job_id: jobId, group_id: active, item_id: null, smart_part_id: smartPartId };
        }
        const itemId = pickedItems.get(jobId);
        if (itemId == null) return null;
        return { job_id: jobId, group_id: active, item_id: itemId };
      }).filter((x) => x !== null);
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
    <section className={s.panel}>
      <header className={s.head}>
        <div className={s.headLeft}>
          <h3 className={s.title}>Перенести в коллаж</h3>
          <p className={s.sub}>
            {eligibleJobs.length} результат{plural(eligibleJobs.length, "", "а", "ов")} ждут переноса.
            {" "}Выбери группу — для каждого подскажу куда положить или создам новый коллаж под нужный экземпляр.
          </p>
        </div>
        <button className={s.helpBtn} onClick={() => setHelpOpen(true)} title="Правила переноса">
          ⓘ Правила
        </button>
      </header>

      <nav className={s.tabs}>
        {groups.map((g) => {
          const n = groupCounts[g.id] ?? 0;
          const isActive = active === g.id;
          return (
            <button
              key={g.id}
              className={`${s.tab} ${isActive ? s.tabActive : ""}`}
              onClick={() => setActive(isActive ? null : g.id)}
            >
              <span className={s.tabName}>{g.name}</span>
              <span className={s.tabMeta}>
                {n > 0 ? `${n} готов${plural(n, "о", "ы", "ы")}` : "—"}
                {g.owner_kind === "smart_part" && <em className={s.kindChip}>smart</em>}
                {g.owner_kind === "instance" && g.condition_filter === "defect" && <em className={s.filterChip}>дефектные</em>}
                {g.owner_kind === "instance" && g.condition_filter === "personal" && <em className={s.filterChip}>personal</em>}
              </span>
            </button>
          );
        })}
      </nav>

      {!active ? (
        <div className={s.empty}>
          <div className={s.emptyIcon}>↑</div>
          <div className={s.emptyText}>Выбери группу выше — покажу варианты переноса для каждого фото.</div>
        </div>
      ) : (
        <>
          {visibleJobs.length === 0 ? (
            <div className={s.empty}>
              <div className={s.emptyText}>
                Нет фото, которые можно перенести в эту группу из их источников.
              </div>
            </div>
          ) : (
            <>
              <div className={s.toolbar}>
                <label className={s.allLbl}>
                  <input
                    type="checkbox"
                    checked={allOn}
                    disabled={checkableJobs.length === 0}
                    onChange={(e) => {
                      if (e.target.checked) setPicked(new Set(checkableJobs.map((j) => j.id)));
                      else setPicked(new Set());
                    }}
                  />
                  <span>Выбрать все ({checkableJobs.length})</span>
                </label>
                <span className={s.toolbarRight}>выбрано {picked.size}</span>
              </div>

              <ul className={s.rows}>
                {visibleJobs.map((j) => (
                  <JobRow
                    key={j.id}
                    job={j}
                    group={target!}
                    checked={picked.has(j.id)}
                    pickedItemId={pickedItems.get(j.id) ?? null}
                    manualPick={manualPicks.get(j.id + ":" + active) ?? null}
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
                        next.set(j.id + ":" + active, p);
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
        </>
      )}

      {helpOpen && <RulesModal groups={groups} rules={rules} onClose={() => setHelpOpen(false)} />}
    </section>
  );
}

// ─── helpers ────────────────────────────────────────────────────────────────

function pickableState(
  job: StudioJob,
  group: TargetGroup,
  manualPicks: Map<string, ManualPick>,
): RowState {
  const sug = job.suggestions;
  const slot: GroupSuggestion | undefined = sug?.by_group?.[group.id];

  const m = manualPicks.get(job.id + ":" + group.id);
  if (m) return { kind: "manual", pick: m };

  if (group.owner_kind === "smart_part") {
    if (sug) {
      const s = slot && slot.kind === "smart_part" ? slot : null;
      const smartName = sug.smart_part_name;
      if (s && s.existing_collage_id) {
        return { kind: "smart-existing", smartPartId: sug.smart_part_id, smartPartName: smartName, collageId: s.existing_collage_id };
      }
      return { kind: "smart-create", smartPartId: sug.smart_part_id, smartPartName: smartName };
    }
    return { kind: "no-smart-match" };
  }
  // instance group
  if (sug) {
    const items = slot && slot.kind === "instance" ? slot.items : [];
    if (items.length > 0) return { kind: "instance-pick", items };
    return { kind: "no-condition-match" };
  }
  return { kind: "no-smart-match" };
}

// ─── one job row ────────────────────────────────────────────────────────────

interface RowProps {
  job: StudioJob;
  group: TargetGroup;
  checked: boolean;
  pickedItemId: number | null;
  manualPick: ManualPick | null;
  onToggle: (on: boolean) => void;
  onPickItem: (itemId: number) => void;
  onManual: (p: ManualPick) => void;
}

function JobRow({
  job, group, checked, pickedItemId, manualPick,
  onToggle, onPickItem, onManual,
}: RowProps) {
  const [manualOpen, setManualOpen] = useState(false);
  const sug = job.suggestions;
  const filename = job.source_filename || job.id.slice(0, 8);
  const state = pickableState(job, group, manualPick ? new Map([[job.id + ":" + group.id, manualPick]]) : new Map());

  const checkable = state.kind === "smart-existing"
    || state.kind === "smart-create"
    || state.kind === "instance-pick"
    || state.kind === "manual";

  const partName = sug?.smart_part_name
    ?? (state.kind === "manual" ? state.pick.smartPartName : null)
    ?? (state.kind === "smart-existing" || state.kind === "smart-create" ? state.smartPartId : null);

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
            {partName || <span className={s.faintItalic}>Не распознано</span>}
          </div>
          <div className={s.fileMeta}>
            <code className={s.fname}>{filename}</code>
            {sug?.matched_article && (
              <>
                <span className={s.dot}>·</span>
                <span className={s.matched}>
                  {sug.source_kind === "source_collage" ? "из коллажа" : "matched"}: <code>{sug.matched_article}</code>
                </span>
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
        <RowDetail state={state} group={group} pickedItemId={pickedItemId} onPickItem={onPickItem} />
        {state.kind === "no-smart-match" && (
          <button className={s.findBtn} onClick={() => setManualOpen((o) => !o)}>
            {manualOpen ? "Скрыть поиск" : "Найти запчасть вручную"}
          </button>
        )}
      </div>

      {manualOpen && state.kind === "no-smart-match" && (
        <ManualLookup
          group={group}
          onPicked={(p) => {
            onManual(p);
            if (p.kind === "instance") onPickItem(p.itemId);
            onToggle(true);
            setManualOpen(false);
          }}
        />
      )}
    </li>
  );
}

function RowDetail({
  state, group, pickedItemId, onPickItem,
}: {
  state: RowState;
  group: TargetGroup;
  pickedItemId: number | null;
  onPickItem: (id: number) => void;
}) {
  if (state.kind === "no-smart-match") {
    return <div className={s.muted}>имя файла не распознано — найди запчасть вручную</div>;
  }
  if (state.kind === "no-condition-match") {
    return (
      <div className={s.muted}>
        нет подходящих экземпляров для этой группы
      </div>
    );
  }
  if (state.kind === "smart-existing") {
    return (
      <div className={s.singleCard}>
        <span className={s.itemBadge}>→ {state.smartPartId}</span>
        <span className={s.itemMode}>добавится в существующий коллаж</span>
      </div>
    );
  }
  if (state.kind === "smart-create") {
    return (
      <div className={s.singleCard}>
        <span className={s.itemBadge}>➕ {state.smartPartId}</span>
        <span className={s.itemMode}>создастся новый коллаж в этой группе</span>
      </div>
    );
  }
  if (state.kind === "manual") {
    if (state.pick.kind === "smart_part") {
      return (
        <div className={s.singleCard}>
          <span className={s.itemBadge}>{state.pick.smartPartId}</span>
          <span className={s.itemMode}>будет создан/найден smart_part-коллаж</span>
        </div>
      );
    }
    return (
      <div className={s.singleCard}>
        <span className={s.itemBadge}>Item #{state.pick.itemId}</span>
        <span className={s.itemMode}>будет создан/найден коллаж</span>
      </div>
    );
  }
  // instance-pick
  if (state.items.length === 1) {
    const it = state.items[0];
    return (
      <div className={s.singleCard}>
        <span className={s.itemBadge}>Item #{it.item_id}</span>
        <ConditionChip condition={it.condition} />
        <span className={s.itemMode}>
          {it.existing_collage_id ? "→ добавится в существующий коллаж" : "➕ создастся новый коллаж"}
        </span>
      </div>
    );
  }
  return (
    <div className={s.itemGrid}>
      {state.items.map((it) => {
        const active = it.item_id === pickedItemId;
        return (
          <button
            key={it.item_id}
            type="button"
            className={`${s.itemCard} ${active ? s.itemCardActive : ""}`}
            onClick={() => onPickItem(it.item_id)}
          >
            <span className={s.itemRadio}>{active ? "●" : "○"}</span>
            <span className={s.itemBadge}>Item #{it.item_id}</span>
            <ConditionChip condition={it.condition} />
            <span className={s.itemMode}>
              {it.existing_collage_id ? "уже есть коллаж" : "будет создан"}
            </span>
            {it.condition_note && (
              <span className={s.itemNote} title={it.condition_note}>
                {it.condition_note.slice(0, 40)}{it.condition_note.length > 40 ? "…" : ""}
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
  group, onPicked,
}: {
  group: TargetGroup;
  onPicked: (p: ManualPick) => void;
}) {
  const [q, setQ] = useState("");
  const [parts, setParts] = useState<{ smart_id: string; name: string; articles: string[] }[]>([]);
  const [activePart, setActivePart] = useState<{ id: string; name: string } | null>(null);
  const [items, setItems] = useState<LookupItem[]>([]);
  const [smartExists, setSmartExists] = useState<string | null>(null);
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
    setSmartExists(null);
    try {
      if (group.owner_kind === "smart_part") {
        const r = await api.studio.lookupSmart(smartId, group.id);
        setSmartExists(r.existing_collage_id);
      } else {
        const r = await api.studio.lookupItems(smartId, group.id);
        setItems(r);
      }
    } catch (e) {
      alert(`Не удалось загрузить: ${e}`);
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
              {p.articles[0] && <code className={s.lookupArticle}>{p.articles[0]}</code>}
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
          {loading && <div className={s.muted}>Загрузка…</div>}
          {!loading && group.owner_kind === "smart_part" && (
            <button
              type="button"
              className={s.itemCard}
              onClick={() =>
                onPicked({ kind: "smart_part", smartPartId: activePart.id, smartPartName: activePart.name })
              }
            >
              <span className={s.itemBadge}>
                {smartExists ? `→ ${activePart.id}` : `➕ ${activePart.id}`}
              </span>
              <span className={s.itemMode}>
                {smartExists ? "добавится в существующий" : "будет создан smart_part-коллаж"}
              </span>
            </button>
          )}
          {!loading && group.owner_kind === "instance" && items.length === 0 && (
            <div className={s.muted}>нет подходящих экземпляров для этой группы</div>
          )}
          {!loading && group.owner_kind === "instance" && items.length > 0 && (
            <div className={s.itemGrid}>
              {items.map((it) => (
                <button
                  key={it.item_id}
                  type="button"
                  className={s.itemCard}
                  onClick={() =>
                    onPicked({
                      kind: "instance",
                      itemId: it.item_id,
                      smartPartId: activePart.id,
                      smartPartName: activePart.name,
                    })
                  }
                >
                  <span className={s.itemBadge}>Item #{it.item_id}</span>
                  <ConditionChip condition={it.condition} />
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

// ─── rules modal ────────────────────────────────────────────────────────────

const SOURCE_LABELS: { key: string; label: string }[] = [
  { key: "upload", label: "Fresh upload (с диска)" },
  { key: "ae697d8d-e803-42c4-9982-ecefbf8a8cdf", label: "Эталонные на публикацию" },
  { key: "3cf67240-7597-451a-8ec1-fb097afdeb88", label: "Реальные на публикацию" },
  { key: "a1790194-efa0-4dda-bed4-d8bc15b3b624", label: "Дефектные на публикацию" },
  { key: "fa0df9bb-f285-4eb2-ab46-cd24e520a4e1", label: "Avito 2-й аккаунт" },
  { key: "721bf726-cdda-4ca8-bf22-f345ca0f677b", label: "Реальные фотографии" },
  { key: "edce2987-daae-4339-8330-8cb96ad912bf", label: "Дефектные фотографии" },
];

function RulesModal({
  groups, rules, onClose,
}: {
  groups: TargetGroup[];
  rules: TransferRules | null;
  onClose: () => void;
}) {
  useEffect(() => {
    function onKey(e: KeyboardEvent) { if (e.key === "Escape") onClose(); }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  if (!rules) return null;

  return (
    <div className={s.modalBack} onClick={onClose}>
      <div className={s.modal} onClick={(e) => e.stopPropagation()}>
        <div className={s.modalHead}>
          <h3 className={s.modalTitle}>Правила переноса</h3>
          <button className={s.modalClose} onClick={onClose}>×</button>
        </div>
        <p className={s.modalSub}>
          Что откуда куда можно положить. Студия не пускает дефектные исходники в чистые группы и не даёт делать
          фейковые дефекты из чистых исходников.
        </p>
        <div className={s.matrixWrap}>
          <table className={s.matrix}>
            <thead>
              <tr>
                <th className={s.matrixCorner}>Source ↓ \ Target →</th>
                {groups.map((g) => (
                  <th key={g.id} className={s.matrixHead}>
                    <div>{g.name}</div>
                    <div className={s.matrixHeadSub}>
                      {g.owner_kind === "smart_part" ? "smart" : "instance"}
                    </div>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {SOURCE_LABELS.map((src) => (
                <tr key={src.key}>
                  <th className={s.matrixRowHead}>{src.label}</th>
                  {groups.map((g) => {
                    const ok = (rules.allowed[g.id] || []).includes(src.key);
                    return (
                      <td key={g.id} className={ok ? s.matrixYes : s.matrixNo}>
                        {ok ? "✓" : "✗"}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

/** Small chip showing the item's condition; nothing for plain "new". */
function ConditionChip({ condition }: { condition: string }) {
  if (condition === "defect") return <span className={s.defectChip}>дефект</span>;
  if (condition === "personal") return <span className={s.defectChip}>personal</span>;
  return null;
}

function plural(n: number, one: string, few: string, many: string): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return one;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return few;
  return many;
}

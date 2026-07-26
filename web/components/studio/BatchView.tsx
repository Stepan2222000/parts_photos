"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { Group, StudioBatchDetail, StudioJob } from "@/lib/types";
import { api, ApiError } from "@/lib/api";
import TransferPanel from "./TransferPanel";
import s from "./BatchView.module.css";

interface Props {
  batch: StudioBatchDetail | null;
  onBack: () => void;
  onTransferred: () => Promise<void> | void;
  /** Called after a refine job is queued — the parent restarts polling. */
  onRefined: () => void;
}

/** A root job + its refine versions (v1 = root, v2.. = refines), in
 *  created_at order. At most one version can be transferred. */
interface JobChain {
  root: StudioJob;
  versions: StudioJob[];
  transferred: StudioJob | null;
}

function buildChains(jobs: StudioJob[]): JobChain[] {
  const byId = new Map(jobs.map((j) => [j.id, j]));
  const rootOf = (j: StudioJob): StudioJob => {
    let cur = j;
    while (cur.parent_job_id) {
      const p = byId.get(cur.parent_job_id);
      if (!p) break;
      cur = p;
    }
    return cur;
  };
  const chains = new Map<string, JobChain>();
  for (const j of jobs) {
    if (j.parent_job_id) continue;
    chains.set(j.id, {
      root: j,
      versions: [j],
      transferred: j.transferred_to_photo_id ? j : null,
    });
  }
  // jobs come sorted by created_at ASC, so versions stay in order.
  for (const j of jobs) {
    if (!j.parent_job_id) continue;
    const chain = chains.get(rootOf(j).id);
    if (!chain) continue;
    chain.versions.push(j);
    if (j.transferred_to_photo_id) chain.transferred = j;
  }
  return Array.from(chains.values());
}

export default function BatchView({ batch, onBack, onTransferred, onRefined }: Props) {
  const [activeRootId, setActiveRootId] = useState<string | null>(null);
  const [groups, setGroups] = useState<Group[]>([]);
  // Explicit version picks per chain (rootId → jobId). Without a pick the
  // chain defaults to its latest succeeded version.
  const [picks, setPicks] = useState<Map<string, string>>(new Map());

  useEffect(() => {
    api.groups.list().then(setGroups).catch(() => setGroups([]));
  }, []);

  const chains = useMemo(() => buildChains(batch?.jobs ?? []), [batch?.jobs]);

  if (!batch) {
    return (
      <div className={s.skeleton}>
        <div className={s.skLine} />
        <div className={s.skLine} />
        <div className={s.skGrid} />
      </div>
    );
  }

  function selectedOf(chain: JobChain): StudioJob {
    const pickId = picks.get(chain.root.id);
    if (pickId) {
      const v = chain.versions.find((x) => x.id === pickId);
      if (v) return v;
    }
    if (chain.transferred) return chain.transferred;
    for (let i = chain.versions.length - 1; i >= 0; i--) {
      if (chain.versions[i].status === "succeeded") return chain.versions[i];
    }
    return chain.versions[chain.versions.length - 1];
  }

  function pickVersion(rootId: string, jobId: string) {
    setPicks((cur) => new Map(cur).set(rootId, jobId));
  }

  const pct = batch.total > 0 ? Math.round((batch.done / batch.total) * 100) : 0;
  const activeChain = chains.find((c) => c.root.id === activeRootId) || null;
  const groupNameById = (id: string | null) =>
    id ? (groups.find((g) => g.id === id)?.name || id.slice(0, 8)) : null;

  // Transfer works on the version currently selected in the preview; chains
  // that already sent a version to a collage are done.
  const transferableJobs = chains
    .filter((c) => !c.transferred)
    .map((c) => selectedOf(c))
    .filter((j) => j.status === "succeeded");

  return (
    <div>
      <button className={s.back} onClick={onBack}>
        ← новый запуск
      </button>

      <div className={s.head}>
        <h1 className={s.title}>
          {batch.name || `Batch ${batch.id.slice(0, 8)}`}
        </h1>
        <div className={s.meta}>
          <span>создан {new Date(batch.created_at).toLocaleString("ru-RU")}</span>
          {batch.finished_at && (
            <span> · завершён {new Date(batch.finished_at).toLocaleString("ru-RU")}</span>
          )}
        </div>
        <div className={s.progress}>
          <div className={s.progressTop}>
            <span className={s.pct}>{pct}%</span>
            <span className={s.frac}>
              {batch.done}/{batch.total}
              {batch.failed > 0 && (
                <span className={s.failedNum}> · {batch.failed} failed</span>
              )}
            </span>
          </div>
          <div className={s.bar}>
            <div className={s.barFill} style={{ width: `${pct}%` }} />
          </div>
        </div>
      </div>

      <TransferPanel batch={batch} jobs={transferableJobs} onTransferred={onTransferred} />

      <div className={s.grid}>
        {chains.map((c) => (
          <ChainCard
            key={c.root.id}
            chain={c}
            selected={selectedOf(c)}
            active={activeRootId === c.root.id}
            groupName={groupNameById(c.transferred?.transferred_to_group_id ?? null)}
            onSelect={() =>
              setActiveRootId(c.root.id === activeRootId ? null : c.root.id)
            }
          />
        ))}
      </div>

      {activeChain && (
        <ChainDrawer
          chain={activeChain}
          selected={selectedOf(activeChain)}
          groupName={groupNameById(activeChain.transferred?.transferred_to_group_id ?? null)}
          onPickVersion={(jobId) => pickVersion(activeChain.root.id, jobId)}
          onRefined={(newJob) => {
            pickVersion(activeChain.root.id, newJob.id);
            onRefined();
          }}
          onClose={() => setActiveRootId(null)}
        />
      )}
    </div>
  );
}

const STATUS_LABEL: Record<StudioJob["status"], string> = {
  queued: "queued", running: "running", succeeded: "✓", failed: "failed",
};

function ChainCard({
  chain, selected, active, groupName, onSelect,
}: {
  chain: JobChain;
  selected: StudioJob;
  active: boolean;
  groupName: string | null;
  onSelect: () => void;
}) {
  const isFailed = selected.status === "failed";
  const cls = `${s.card} ${active ? s.cardActive : ""} ${isFailed ? s.cardFailed : ""}`;
  const verIdx = chain.versions.findIndex((v) => v.id === selected.id) + 1;
  const busy = chain.versions.some(
    (v) => v.status === "queued" || v.status === "running",
  );

  return (
    <div className={cls} onClick={onSelect}>
      <div className={s.cardImg}>
        {selected.status === "succeeded" && selected.result_url ? (
          <img src={selected.result_url} alt="" />
        ) : selected.status === "running" ? (
          <div className={s.spinner}>
            <div className={s.spinnerDot} />
            <div className={s.spinnerDot} />
            <div className={s.spinnerDot} />
          </div>
        ) : (
          <img src={chain.root.source_url} alt="" className={s.dim} />
        )}
        <span className={`${s.status} ${s["st_" + selected.status]}`}>
          {STATUS_LABEL[selected.status]}
        </span>
        {chain.versions.length > 1 && (
          <span className={s.versions}>
            v{verIdx}/{chain.versions.length}
            {busy && selected.status !== "running" && " ⋯"}
          </span>
        )}
        {chain.transferred && (
          <span className={s.transferred} title={groupName || ""}>
            {groupName ? `в ${groupName}` : "в коллаже"}
          </span>
        )}
      </div>
      <div className={s.cardFoot}>
        <span className={s.cardName}>
          {chain.root.source_filename || chain.root.source_kind}
        </span>
        {selected.elapsed_seconds != null && (
          <span className={s.cardElapsed}>{Math.round(selected.elapsed_seconds)}s</span>
        )}
      </div>
    </div>
  );
}

function ChainDrawer({
  chain, selected, groupName, onPickVersion, onRefined, onClose,
}: {
  chain: JobChain;
  selected: StudioJob;
  groupName: string | null;
  onPickVersion: (jobId: string) => void;
  onRefined: (newJob: StudioJob) => void;
  onClose: () => void;
}) {
  const transferred = chain.transferred !== null;

  return (
    <div className={s.drawerBack} onClick={onClose}>
      <div className={s.drawer} onClick={(e) => e.stopPropagation()}>
        <div className={s.drawerHead}>
          <h3 className={s.drawerTitle}>
            {chain.root.source_filename || `Job ${chain.root.id.slice(0, 8)}`}
          </h3>
          <button className={s.drawerClose} onClick={onClose}>×</button>
        </div>

        {transferred && (
          <div className={s.transferBar}>
            <div className={s.transferredBadge}>
              <span>✓ Перенесено{groupName ? ` в ${groupName}` : ""}</span>
            </div>
          </div>
        )}

        {chain.versions.length > 1 && (
          <div className={s.verStrip}>
            {chain.versions.map((v, i) => (
              <button
                key={v.id}
                type="button"
                className={`${s.verBtn} ${v.id === selected.id ? s.verBtnActive : ""}`}
                onClick={() => onPickVersion(v.id)}
              >
                <span className={`${s.verDot} ${s["vd_" + v.status]}`} />
                v{i + 1}
                {v.id === chain.transferred?.id && " · в коллаже"}
              </button>
            ))}
          </div>
        )}

        <div className={s.compare}>
          <div className={s.compareSide}>
            <div className={s.compareLabel}>Before</div>
            <img src={chain.root.source_url} alt="" />
          </div>
          <div className={s.compareSide}>
            <div className={s.compareLabel}>
              After{chain.versions.length > 1 ? ` · v${chain.versions.findIndex((v) => v.id === selected.id) + 1}` : ""}
            </div>
            {selected.result_url ? (
              <img src={selected.result_url} alt="" />
            ) : (
              <div className={s.compareEmpty}>
                {selected.status === "running" || selected.status === "queued"
                  ? "Генерация…"
                  : selected.error || "Нет результата"}
              </div>
            )}
          </div>
        </div>

        {selected.refine_prompt && (
          <div className={s.promptNote}>
            <span className={s.promptNoteLabel}>Правка этой версии:</span>{" "}
            {selected.refine_prompt}
          </div>
        )}

        {selected.error && <div className={s.error}>{selected.error}</div>}
        {selected.log_tail && (
          <details className={s.logBlock}>
            <summary>Логи codex</summary>
            <pre className={s.log}>{selected.log_tail}</pre>
          </details>
        )}

        {!transferred && (
          <RefineForm
            baseJob={selected}
            disabled={selected.status !== "succeeded"}
            onRefined={onRefined}
          />
        )}
      </div>
    </div>
  );
}

function RefineForm({
  baseJob, disabled, onRefined,
}: {
  baseJob: StudioJob;
  disabled: boolean;
  onRefined: (newJob: StudioJob) => void;
}) {
  const [prompt, setPrompt] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const previewUrl = useMemo(
    () => (file ? URL.createObjectURL(file) : null),
    [file],
  );
  useEffect(() => {
    return () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl);
    };
  }, [previewUrl]);

  function onPaste(e: React.ClipboardEvent) {
    for (const item of e.clipboardData.items) {
      if (item.type.startsWith("image/")) {
        const f = item.getAsFile();
        if (f) {
          setFile(f);
          e.preventDefault();
          return;
        }
      }
    }
  }

  async function submit() {
    const text = prompt.trim();
    if (!text || busy || disabled) return;
    setBusy(true);
    setError(null);
    try {
      const newJob = await api.studio.refineJob(baseJob.id, text, file);
      setPrompt("");
      setFile(null);
      onRefined(newJob);
    } catch (e) {
      setError(e instanceof ApiError ? `${e.status}: ${e.body}` : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={s.refineBox}>
      <div className={s.refineTitle}>Доработать эту версию</div>
      <p className={s.refineSub}>
        Опиши, что исправить — получится новая версия, оригинал останется.
        Можно приложить картинку-референс (или вставить из буфера прямо в поле).
      </p>
      <textarea
        className={s.refineTa}
        placeholder="например: убери блик на корпусе, тень слишком жёсткая — сделай мягче…"
        value={prompt}
        rows={3}
        disabled={disabled || busy}
        onChange={(e) => setPrompt(e.target.value)}
        onPaste={onPaste}
      />
      <div className={s.refineRow}>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          hidden
          onChange={(e) => setFile(e.target.files?.[0] ?? null)}
        />
        {file ? (
          <div className={s.attachChip}>
            {previewUrl && <img src={previewUrl} alt="" className={s.attachThumb} />}
            <span className={s.attachName}>{file.name || "из буфера"}</span>
            <button
              type="button"
              className={s.attachRemove}
              onClick={() => {
                setFile(null);
                if (fileInputRef.current) fileInputRef.current.value = "";
              }}
            >
              ×
            </button>
          </div>
        ) : (
          <button
            type="button"
            className={s.attachBtn}
            disabled={disabled || busy}
            onClick={() => fileInputRef.current?.click()}
          >
            + референс
          </button>
        )}
        <button
          type="button"
          className={s.refineCta}
          disabled={disabled || busy || !prompt.trim()}
          onClick={submit}
        >
          {busy ? "Ставлю в очередь…" : "Доработать"}
        </button>
      </div>
      {disabled && (
        <div className={s.refineHint}>
          Дорабатывать можно только успешно сгенерированную версию.
        </div>
      )}
      {error && <div className={s.error}>{error}</div>}
    </div>
  );
}

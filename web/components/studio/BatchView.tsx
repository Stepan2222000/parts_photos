"use client";

import { useEffect, useState } from "react";
import type { Group, StudioBatchDetail, StudioJob } from "@/lib/types";
import { api } from "@/lib/api";
import TransferPanel from "./TransferPanel";
import s from "./BatchView.module.css";

interface Props {
  batch: StudioBatchDetail | null;
  onBack: () => void;
  onTransferred: () => Promise<void> | void;
}

export default function BatchView({ batch, onBack, onTransferred }: Props) {
  const [activeJobId, setActiveJobId] = useState<string | null>(null);
  const [groups, setGroups] = useState<Group[]>([]);

  useEffect(() => {
    api.groups.list().then(setGroups).catch(() => setGroups([]));
  }, []);

  if (!batch) {
    return (
      <div className={s.skeleton}>
        <div className={s.skLine} />
        <div className={s.skLine} />
        <div className={s.skGrid} />
      </div>
    );
  }

  const pct = batch.total > 0 ? Math.round((batch.done / batch.total) * 100) : 0;
  const activeJob = batch.jobs.find((j) => j.id === activeJobId) || null;
  const groupNameById = (id: string | null) =>
    id ? (groups.find((g) => g.id === id)?.name || id.slice(0, 8)) : null;

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

      <TransferPanel batch={batch} onTransferred={onTransferred} />

      <div className={s.grid}>
        {batch.jobs.map((j) => (
          <JobCard
            key={j.id}
            job={j}
            active={activeJobId === j.id}
            groupName={groupNameById(j.transferred_to_group_id)}
            onSelect={() => setActiveJobId(j.id === activeJobId ? null : j.id)}
          />
        ))}
      </div>

      {activeJob && (
        <JobDrawer
          job={activeJob}
          groupName={groupNameById(activeJob.transferred_to_group_id)}
          onClose={() => setActiveJobId(null)}
        />
      )}
    </div>
  );
}

const STATUS_LABEL: Record<StudioJob["status"], string> = {
  queued: "queued", running: "running", succeeded: "✓", failed: "failed",
};

function JobCard({
  job, active, groupName, onSelect,
}: {
  job: StudioJob;
  active: boolean;
  groupName: string | null;
  onSelect: () => void;
}) {
  const isFailed = job.status === "failed";
  const cls = `${s.card} ${active ? s.cardActive : ""} ${isFailed ? s.cardFailed : ""}`;

  return (
    <div className={cls} onClick={onSelect}>
      <div className={s.cardImg}>
        {job.status === "succeeded" && job.result_url ? (
          <img src={job.result_url} alt="" />
        ) : job.status === "running" ? (
          <div className={s.spinner}>
            <div className={s.spinnerDot} />
            <div className={s.spinnerDot} />
            <div className={s.spinnerDot} />
          </div>
        ) : (
          <img src={job.source_url} alt="" className={s.dim} />
        )}
        <span className={`${s.status} ${s["st_" + job.status]}`}>
          {STATUS_LABEL[job.status]}
        </span>
        {job.transferred_to_photo_id && (
          <span className={s.transferred} title={groupName || ""}>
            {groupName ? `в ${groupName}` : "в коллаже"}
          </span>
        )}
      </div>
      <div className={s.cardFoot}>
        <span className={s.cardName}>
          {job.source_filename || job.source_kind}
        </span>
        {job.elapsed_seconds != null && (
          <span className={s.cardElapsed}>{Math.round(job.elapsed_seconds)}s</span>
        )}
      </div>
    </div>
  );
}

function JobDrawer({
  job, groupName, onClose,
}: {
  job: StudioJob;
  groupName: string | null;
  onClose: () => void;
}) {
  const transferred = !!job.transferred_to_photo_id;

  return (
    <div className={s.drawerBack} onClick={onClose}>
      <div className={s.drawer} onClick={(e) => e.stopPropagation()}>
        <div className={s.drawerHead}>
          <h3 className={s.drawerTitle}>
            {job.source_filename || `Job ${job.id.slice(0, 8)}`}
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

        <div className={s.compare}>
          <div className={s.compareSide}>
            <div className={s.compareLabel}>Before</div>
            <img src={job.source_url} alt="" />
          </div>
          <div className={s.compareSide}>
            <div className={s.compareLabel}>After</div>
            {job.result_url ? (
              <img src={job.result_url} alt="" />
            ) : (
              <div className={s.compareEmpty}>
                {job.status === "running"
                  ? "Генерация…"
                  : job.error || "Нет результата"}
              </div>
            )}
          </div>
        </div>
        {job.error && <div className={s.error}>{job.error}</div>}
        {job.log_tail && (
          <details className={s.logBlock}>
            <summary>Логи codex</summary>
            <pre className={s.log}>{job.log_tail}</pre>
          </details>
        )}
      </div>
    </div>
  );
}

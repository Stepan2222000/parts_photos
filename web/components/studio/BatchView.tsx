"use client";

import { useMemo, useState } from "react";
import { api } from "@/lib/api";
import type { StudioBatchDetail, StudioJob } from "@/lib/types";
import TransferSuggestions from "./TransferSuggestions";
import s from "./BatchView.module.css";

interface Props {
  batch: StudioBatchDetail | null;
  onBack: () => void;
  onTransferred: () => Promise<void> | void;
}

export default function BatchView({ batch, onBack, onTransferred }: Props) {
  const [activeJobId, setActiveJobId] = useState<string | null>(null);

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
  const succeededJobs = batch.jobs.filter((j) => j.status === "succeeded");

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

      <TransferSuggestions
        batch={batch}
        onTransferred={onTransferred}
      />

      <div className={s.grid}>
        {batch.jobs.map((j) => (
          <JobCard
            key={j.id}
            job={j}
            active={activeJobId === j.id}
            onSelect={() => setActiveJobId(j.id === activeJobId ? null : j.id)}
            onTransfer={async (collageId) => {
              await api.studio.transferJob(j.id, collageId);
              await onTransferred();
            }}
          />
        ))}
      </div>

      {activeJob && (
        <JobDrawer
          job={activeJob}
          onClose={() => setActiveJobId(null)}
          onTransferred={onTransferred}
        />
      )}
    </div>
  );
}

function JobCard({
  job,
  active,
  onSelect,
  onTransfer,
}: {
  job: StudioJob;
  active: boolean;
  onSelect: () => void;
  onTransfer: (collageId: string) => Promise<void>;
}) {
  const isDone = job.status === "succeeded";
  const isFailed = job.status === "failed";
  const isRunning = job.status === "running";
  const cls = `${s.card} ${active ? s.cardActive : ""} ${isFailed ? s.cardFailed : ""}`;

  return (
    <div className={cls} onClick={onSelect}>
      <div className={s.cardImg}>
        {isDone && job.result_url ? (
          <img src={job.result_url} alt="" />
        ) : isRunning ? (
          <div className={s.spinner}>
            <div className={s.spinnerDot} />
            <div className={s.spinnerDot} />
            <div className={s.spinnerDot} />
          </div>
        ) : isFailed ? (
          <img src={job.source_url} alt="" className={s.dim} />
        ) : (
          <img src={job.source_url} alt="" className={s.dim} />
        )}
        <span className={`${s.status} ${s["st_" + job.status]}`}>
          {job.status === "queued" && "queued"}
          {job.status === "running" && "running"}
          {job.status === "succeeded" && "✓"}
          {job.status === "failed" && "failed"}
        </span>
        {job.transferred_to_photo_id && (
          <span className={s.transferred}>в коллаже</span>
        )}
      </div>
      <div className={s.cardFoot}>
        <span className={s.cardName}>
          {job.source_filename || job.source_kind}
        </span>
        {isDone && job.elapsed_seconds && (
          <span className={s.cardElapsed}>{Math.round(job.elapsed_seconds)}s</span>
        )}
      </div>
    </div>
  );
}

function JobDrawer({
  job,
  onClose,
  onTransferred,
}: {
  job: StudioJob;
  onClose: () => void;
  onTransferred: () => Promise<void> | void;
}) {
  return (
    <div className={s.drawerBack} onClick={onClose}>
      <div className={s.drawer} onClick={(e) => e.stopPropagation()}>
        <div className={s.drawerHead}>
          <h3 className={s.drawerTitle}>
            {job.source_filename || `Job ${job.id.slice(0, 8)}`}
          </h3>
          <button className={s.drawerClose} onClick={onClose}>×</button>
        </div>
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
        {job.suggested && job.suggested.length > 0 && !job.transferred_to_photo_id && (
          <div className={s.sugBlock}>
            <div className={s.sugTitle}>Предложения по коллажам:</div>
            <ul className={s.sugList}>
              {job.suggested.map((s2) => (
                <li key={s2.collage_id} className={s.sugRow}>
                  <span>
                    <strong>{s2.owner_id}</strong>
                    {s2.owner_name && <span> — {s2.owner_name}</span>}
                  </span>
                  <button
                    className={s.sugBtn}
                    onClick={async () => {
                      await api.studio.transferJob(job.id, s2.collage_id);
                      await onTransferred();
                    }}
                  >
                    Перенести →
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </div>
  );
}

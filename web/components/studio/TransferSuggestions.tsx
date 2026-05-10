"use client";

import { useMemo, useState } from "react";
import { api } from "@/lib/api";
import type { StudioBatchDetail } from "@/lib/types";
import s from "./TransferSuggestions.module.css";

interface Props {
  batch: StudioBatchDetail;
  onTransferred: () => Promise<void> | void;
}

export default function TransferSuggestions({ batch, onTransferred }: Props) {
  const candidates = useMemo(() => {
    const out: { jobId: string; jobName: string; collageId: string; ownerId: string }[] = [];
    for (const j of batch.jobs) {
      if (j.status !== "succeeded") continue;
      if (j.transferred_to_photo_id) continue;
      if (!j.suggested || j.suggested.length === 0) continue;
      const top = j.suggested[0];
      out.push({
        jobId: j.id,
        jobName: j.source_filename || j.id.slice(0, 8),
        collageId: top.collage_id,
        ownerId: top.owner_id,
      });
    }
    return out;
  }, [batch.jobs]);

  const [picked, setPicked] = useState<Set<string>>(() => new Set(candidates.map((c) => c.jobId)));
  const [busy, setBusy] = useState(false);

  if (candidates.length === 0) return null;

  async function transferAll() {
    if (busy || picked.size === 0) return;
    setBusy(true);
    try {
      const transfers = candidates
        .filter((c) => picked.has(c.jobId))
        .map((c) => ({ job_id: c.jobId, collage_id: c.collageId }));
      await api.studio.transferSuggested(batch.id, transfers);
      await onTransferred();
    } catch (e) {
      alert(`Не удалось перенести: ${e}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={s.card}>
      <div className={s.head}>
        <div>
          <h3 className={s.title}>Совпадения по статьям</h3>
          <p className={s.sub}>
            {candidates.length} из готовых результатов имеют имя файла, совпадающее со статьёй коллажа.
          </p>
        </div>
        <button
          className={s.btn}
          onClick={transferAll}
          disabled={busy || picked.size === 0}
        >
          {busy ? "Переношу…" : `Перенести (${picked.size})`}
        </button>
      </div>
      <ul className={s.list}>
        {candidates.map((c) => (
          <li key={c.jobId} className={s.row}>
            <label className={s.lbl}>
              <input
                type="checkbox"
                checked={picked.has(c.jobId)}
                onChange={(e) => {
                  setPicked((cur) => {
                    const next = new Set(cur);
                    if (e.target.checked) next.add(c.jobId);
                    else next.delete(c.jobId);
                    return next;
                  });
                }}
              />
              <span className={s.name}>{c.jobName}</span>
              <span className={s.arrow}>→</span>
              <span className={s.owner}>{c.ownerId}</span>
            </label>
          </li>
        ))}
      </ul>
    </div>
  );
}

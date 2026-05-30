"use client";

import { useState } from "react";
import type { Photo } from "@/lib/types";
import { downloadFile, photoFilename } from "@/lib/download";
import s from "./VideoPanel.module.css";

function DownloadIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <polyline points="7 10 12 15 17 10" />
      <line x1="12" y1="15" x2="12" y2="3" />
    </svg>
  );
}
function TrashIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="3,6 5,6 21,6" />
      <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
    </svg>
  );
}

function VideoCard({
  video,
  ownerId,
  onDelete,
}: {
  video: Photo;
  ownerId: string;
  onDelete: (id: string) => void;
}) {
  const [busy, setBusy] = useState(false);

  async function onDownload() {
    setBusy(true);
    try {
      await downloadFile(video.url, photoFilename(ownerId, video.position, video.url));
    } catch (e) {
      alert(`Не удалось скачать: ${e}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={s.card}>
      <div className={s.media}>
        {video.state === "uploaded" ? (
          <video src={video.url} controls preload="metadata" playsInline />
        ) : video.state === "failed" ? (
          <div className={`${s.status} ${s.statusFailed}`}>
            Не удалось обработать видео
          </div>
        ) : (
          <div className={s.status}>
            <span className={s.spinner} aria-hidden />
            Обрабатывается…
          </div>
        )}
      </div>
      <div className={s.bar}>
        {video.state === "uploaded" && (
          <button type="button" title="Скачать" disabled={busy} onClick={onDownload}>
            <DownloadIcon />
          </button>
        )}
        <button
          type="button"
          className={s.danger}
          title="Удалить"
          onClick={() => onDelete(video.id)}
        >
          <TrashIcon />
        </button>
      </div>
    </div>
  );
}

interface Props {
  videos: Photo[];
  ownerId: string;
  onDelete: (id: string) => void;
}

export default function VideoPanel({ videos, ownerId, onDelete }: Props) {
  if (videos.length === 0) return null;
  return (
    <div className={s.wrap}>
      <div className={s.head}>
        <h2 className="display display-sm">Видео.</h2>
        <span className={s.count}>{videos.length}</span>
      </div>
      <div className={s.grid}>
        {videos.map((v) => (
          <VideoCard key={v.id} video={v} ownerId={ownerId} onDelete={onDelete} />
        ))}
      </div>
    </div>
  );
}

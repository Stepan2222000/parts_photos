"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { api } from "@/lib/api";
import s from "./Uploader.module.css";

interface QueueItem {
  key: string;
  name: string;
  progress: number;
  status: "queued" | "uploading" | "done" | "error";
  error?: string;
}

interface Props {
  collageId: string;
}

const MAX_PARALLEL = 4;

export default function Uploader({ collageId }: Props) {
  const router = useRouter();
  const search = useSearchParams();
  const [over, setOver] = useState(false);
  const [queue, setQueue] = useState<QueueItem[]>([]);
  const fileRef = useRef<HTMLInputElement>(null);
  const cameraRef = useRef<HTMLInputElement>(null);

  function update(key: string, patch: Partial<QueueItem>) {
    setQueue((q) => q.map((it) => (it.key === key ? { ...it, ...patch } : it)));
  }

  async function uploadOne(file: File, key: string) {
    update(key, { status: "uploading", progress: 0 });
    try {
      await api.photos.upload(collageId, file, (pct) =>
        update(key, { progress: pct }),
      );
      update(key, { status: "done", progress: 100 });
      router.refresh();
      // Drop the row after a moment so the queue doesn't grow unbounded
      // across many sessions.
      setTimeout(() => setQueue((q) => q.filter((it) => it.key !== key)), 2000);
    } catch (e) {
      update(key, { status: "error", error: String(e) });
    }
  }

  async function enqueue(files: FileList | File[]) {
    const arr = Array.from(files);
    if (arr.length === 0) return;
    const items: QueueItem[] = arr.map((f, i) => ({
      key: `${Date.now()}-${i}-${f.name}`,
      name: f.name,
      progress: 0,
      status: "queued",
    }));
    setQueue((q) => [...q, ...items]);

    let cursor = 0;
    async function worker() {
      while (cursor < arr.length) {
        const idx = cursor++;
        await uploadOne(arr[idx], items[idx].key);
      }
    }
    await Promise.all(
      Array.from({ length: Math.min(MAX_PARALLEL, arr.length) }, () => worker()),
    );
  }

  useEffect(() => {
    if (search?.get("upload") === "1" && fileRef.current) {
      fileRef.current.click();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <>
      <div
        className={`${s.zone} ${over ? s.over : ""}`}
        onDragEnter={(e) => {
          e.preventDefault();
          setOver(true);
        }}
        onDragOver={(e) => {
          e.preventDefault();
          setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setOver(false);
          if (e.dataTransfer.files.length) enqueue(e.dataTransfer.files);
        }}
      >
        <div className={s.title}>Перетащи фото сюда.</div>
        <div className={s.sub}>
          Принимаем jpg, png, heic. HEIC конвертируется в JPEG. Параллельно ≤ {MAX_PARALLEL} файлов.
        </div>
        <div className={s.row}>
          <label className={s.btn}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
              <polyline points="17,8 12,3 7,8" />
              <line x1="12" y1="3" x2="12" y2="15" />
            </svg>
            Choose files
            <input
              ref={fileRef}
              type="file"
              accept="image/*,.heic,.heif"
              multiple
              onChange={(e) => {
                if (e.target.files) enqueue(e.target.files);
                e.target.value = "";
              }}
            />
          </label>
          <label className={s.btn}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="2" y="6" width="20" height="14" rx="2" />
              <circle cx="12" cy="13" r="4" />
              <path d="M7 6l2-3h6l2 3" />
            </svg>
            Take photo
            <input
              ref={cameraRef}
              type="file"
              accept="image/*"
              capture="environment"
              onChange={(e) => {
                if (e.target.files) enqueue(e.target.files);
                e.target.value = "";
              }}
            />
          </label>
        </div>
      </div>

      {queue.length > 0 && (
        <div className={s.queue}>
          {queue.map((it) => (
            <div key={it.key} className={s.q}>
              <div className={s.qMain}>
                <span className={s.qName}>{it.name}</span>
                <div className={s.qBar}>
                  <div className={s.qBarInner} style={{ width: `${it.progress}%` }} />
                </div>
                <span className={`${s.qStatus} ${it.status === "error" ? s.qFailed : ""}`}>
                  {it.status === "queued" && "ожидает"}
                  {it.status === "uploading" && `${Math.round(it.progress)}%`}
                  {it.status === "done" && "готово"}
                  {it.status === "error" && "ошибка"}
                </span>
              </div>
              {it.status === "error" && it.error && (
                <div className={s.qErr}>{it.error}</div>
              )}
            </div>
          ))}
        </div>
      )}
    </>
  );
}

"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { Photo } from "@/lib/types";
import { downloadFile, photoFilename } from "@/lib/download";
import { copyImageToClipboard } from "@/lib/clipboard";
import s from "./Lightbox.module.css";

interface Props {
  photos: Photo[];
  startIndex: number;
  ownerId: string;
  onClose: () => void;
}

function CloseIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M18 6 6 18M6 6l12 12" />
    </svg>
  );
}
function DownloadIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <polyline points="7 10 12 15 17 10" />
      <line x1="12" y1="15" x2="12" y2="3" />
    </svg>
  );
}
function CopyIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="9" y="9" width="13" height="13" rx="2" />
      <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
    </svg>
  );
}
function CheckIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="20 6 9 17 4 12" />
    </svg>
  );
}
function ChevronLeft() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="15 18 9 12 15 6" />
    </svg>
  );
}
function ChevronRight() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="9 18 15 12 9 6" />
    </svg>
  );
}

export default function Lightbox({ photos, startIndex, ownerId, onClose }: Props) {
  const [idx, setIdx] = useState(startIndex);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const touchStartX = useRef<number | null>(null);

  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, []);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
      else if (e.key === "ArrowLeft") setIdx((i) => Math.max(0, i - 1));
      else if (e.key === "ArrowRight") setIdx((i) => Math.min(photos.length - 1, i + 1));
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [photos.length, onClose]);

  const photo = photos[idx];
  if (!photo) return null;

  const filename = photoFilename(ownerId, photo.position, photo.url);

  async function onDownload() {
    setBusy(true);
    try {
      await downloadFile(photo.url, filename);
    } catch (e) {
      alert(`Не удалось скачать: ${e}`);
    } finally {
      setBusy(false);
    }
  }

  async function onCopy() {
    setBusy(true);
    try {
      await copyImageToClipboard(photo.url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    } catch (e) {
      alert(`Не удалось скопировать: ${e}`);
    } finally {
      setBusy(false);
    }
  }

  function onTouchStart(e: React.TouchEvent) {
    touchStartX.current = e.touches[0].clientX;
  }
  function onTouchEnd(e: React.TouchEvent) {
    if (touchStartX.current === null) return;
    const dx = e.changedTouches[0].clientX - touchStartX.current;
    touchStartX.current = null;
    if (Math.abs(dx) < 50) return;
    if (dx < 0) setIdx((i) => Math.min(photos.length - 1, i + 1));
    else setIdx((i) => Math.max(0, i - 1));
  }

  return createPortal(
    <div
      className={s.backdrop}
      onClick={onClose}
      onTouchStart={onTouchStart}
      onTouchEnd={onTouchEnd}
      role="dialog"
      aria-modal="true"
    >
      <div className={s.toolbar} onClick={(e) => e.stopPropagation()}>
        <span className={s.counter}>
          {idx + 1} / {photos.length}
        </span>
        <span className={s.filename}>{filename}</span>
        <div className={s.spacer} />
        <button
          type="button"
          className={s.tbBtn}
          onClick={onCopy}
          disabled={busy}
          title={copied ? "Скопировано" : "Скопировать изображение"}
        >
          {copied ? <CheckIcon /> : <CopyIcon />}
          <span className={s.tbLabel}>{copied ? "Готово" : "Копировать"}</span>
        </button>
        <button
          type="button"
          className={s.tbBtn}
          onClick={onDownload}
          disabled={busy}
          title="Скачать"
        >
          <DownloadIcon />
          <span className={s.tbLabel}>Скачать</span>
        </button>
        <button type="button" className={s.tbBtn} onClick={onClose} title="Закрыть (Esc)">
          <CloseIcon />
        </button>
      </div>

      <img
        src={photo.url}
        alt=""
        className={s.image}
        onClick={(e) => e.stopPropagation()}
        draggable={false}
      />

      {idx > 0 && (
        <button
          type="button"
          className={`${s.nav} ${s.navLeft}`}
          onClick={(e) => {
            e.stopPropagation();
            setIdx(idx - 1);
          }}
          aria-label="Предыдущая"
        >
          <ChevronLeft />
        </button>
      )}
      {idx < photos.length - 1 && (
        <button
          type="button"
          className={`${s.nav} ${s.navRight}`}
          onClick={(e) => {
            e.stopPropagation();
            setIdx(idx + 1);
          }}
          aria-label="Следующая"
        >
          <ChevronRight />
        </button>
      )}
    </div>,
    document.body,
  );
}

"use client";

import { useEffect, useId, useState } from "react";
import { useRouter } from "next/navigation";
import {
  DndContext,
  DragEndEvent,
  KeyboardSensor,
  PointerSensor,
  TouchSensor,
  closestCenter,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  rectSortingStrategy,
  sortableKeyboardCoordinates,
  useSortable,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";

import type { Photo } from "@/lib/types";
import { api, ApiError } from "@/lib/api";
import { downloadFile, photoFilename } from "@/lib/download";
import { copyImageToClipboard } from "@/lib/clipboard";
import Lightbox from "./Lightbox";
import s from "./PhotosGrid.module.css";

function CopyIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="9" y="9" width="13" height="13" rx="2" />
      <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
    </svg>
  );
}
function SparklesIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 3l1.6 4.4L18 9l-4.4 1.6L12 15l-1.6-4.4L6 9l4.4-1.6L12 3z" />
      <path d="M19 14l.7 1.7 1.7.7-1.7.7-.7 1.7-.7-1.7-1.7-.7 1.7-.7L19 14z" />
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

function Tile({
  photo,
  position,
  collageId,
  ownerId,
  onDelete,
  onOpen,
}: {
  photo: Photo;
  position: number;
  collageId: string;
  ownerId: string;
  onDelete: (id: string) => void;
  onOpen: (photoId: string) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: photo.id });

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  const cn = [s.tile, isDragging ? s.dragging : "", photo.state === "failed" ? s.failed : ""]
    .filter(Boolean)
    .join(" ");

  const [copied, setCopied] = useState(false);

  async function onDownloadClick() {
    try {
      await downloadFile(photo.url, photoFilename(ownerId, photo.position, photo.url));
    } catch (e) {
      alert(`Не удалось скачать: ${e}`);
    }
  }

  async function onCopyClick() {
    try {
      await copyImageToClipboard(photo.url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1000);
    } catch (e) {
      alert(`Не удалось скопировать: ${e}`);
    }
  }

  return (
    <div ref={setNodeRef} style={style} className={cn} {...attributes} {...listeners}>
      {photo.state === "uploaded" ? (
        <img
          src={photo.url}
          alt=""
          loading="lazy"
          onClick={(e) => {
            e.stopPropagation();
            onOpen(photo.id);
          }}
        />
      ) : null}
      <span className={s.pos}>{String(position).padStart(2, "0")}</span>
      <div className={s.tileActions}>
        {photo.state === "uploaded" && (
          <a
            href={`/studio?source_photo_id=${encodeURIComponent(photo.id)}&target_collage_id=${encodeURIComponent(collageId)}`}
            title="Upgrade в Studio"
            onClick={(e) => e.stopPropagation()}
            onPointerDown={(e) => e.stopPropagation()}
          >
            <SparklesIcon />
          </a>
        )}
        {photo.state === "uploaded" && (
          <button
            type="button"
            title={copied ? "Скопировано" : "Скопировать изображение"}
            onClick={(e) => {
              e.stopPropagation();
              onCopyClick();
            }}
            onPointerDown={(e) => e.stopPropagation()}
          >
            {copied ? <CheckIcon /> : <CopyIcon />}
          </button>
        )}
        {photo.state === "uploaded" && (
          <button
            type="button"
            title="Скачать"
            onClick={(e) => {
              e.stopPropagation();
              onDownloadClick();
            }}
            onPointerDown={(e) => e.stopPropagation()}
          >
            <DownloadIcon />
          </button>
        )}
        <button
          type="button"
          className={s.danger}
          title="Delete"
          onClick={(e) => {
            e.stopPropagation();
            onDelete(photo.id);
          }}
          onPointerDown={(e) => e.stopPropagation()}
        >
          <TrashIcon />
        </button>
      </div>
      {photo.state === "failed" && <span className={s.failedMark}>failed</span>}
    </div>
  );
}

interface Props {
  collageId: string;
  ownerId: string;
  photos: Photo[];
}

export default function PhotosGrid({ collageId, ownerId, photos: initialPhotos }: Props) {
  const router = useRouter();
  const dndId = useId();
  const [photos, setPhotos] = useState(initialPhotos);
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);

  useEffect(() => {
    setPhotos(initialPhotos);
  }, [initialPhotos]);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 250, tolerance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  async function onDragEnd(e: DragEndEvent) {
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    const oldIndex = photos.findIndex((p) => p.id === active.id);
    const newIndex = photos.findIndex((p) => p.id === over.id);
    if (oldIndex < 0 || newIndex < 0) return;

    const prev = photos;
    const next = arrayMove(photos, oldIndex, newIndex).map((p, i) => ({
      ...p,
      position: i + 1,
    }));
    setPhotos(next);
    try {
      await api.collages.reorder(
        collageId,
        next.map((p) => ({ photo_id: p.id, position: p.position })),
      );
      router.refresh();
    } catch (err) {
      setPhotos(prev);
      if (err instanceof ApiError && err.status === 409) {
        alert("Список фото изменился (новая загрузка). Обнови страницу и попробуй ещё раз.");
        router.refresh();
      } else {
        alert(`Не удалось переставить: ${err}`);
      }
    }
  }

  async function onDelete(id: string) {
    if (!confirm("Удалить фото? Soft-delete, файл останется в S3.")) return;
    await api.photos.delete(id);
    setPhotos((curr) => curr.filter((p) => p.id !== id));
    router.refresh();
  }

  if (photos.length === 0) {
    return (
      <div style={{ marginTop: 18, color: "var(--text-muted)" }}>
        Фото пока нет. Добавь первые.
      </div>
    );
  }

  const uploaded = photos.filter((p) => p.state === "uploaded");

  function openLightbox(photoId: string) {
    const i = uploaded.findIndex((p) => p.id === photoId);
    if (i >= 0) setLightboxIndex(i);
  }

  return (
    <>
      <DndContext id={dndId} sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
        <SortableContext items={photos.map((p) => p.id)} strategy={rectSortingStrategy}>
          <div className={s.grid}>
            {photos.map((p, i) => (
              <Tile
                key={p.id}
                photo={p}
                position={i + 1}
                collageId={collageId}
                ownerId={ownerId}
                onDelete={onDelete}
                onOpen={openLightbox}
              />
            ))}
          </div>
        </SortableContext>
      </DndContext>
      {lightboxIndex !== null && (
        <Lightbox
          photos={uploaded}
          startIndex={lightboxIndex}
          ownerId={ownerId}
          onClose={() => setLightboxIndex(null)}
        />
      )}
    </>
  );
}

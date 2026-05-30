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

import type { MoveTarget, Photo } from "@/lib/types";
import { isVideo } from "@/lib/types";
import { api, ApiError } from "@/lib/api";
import { downloadFile, photoFilename } from "@/lib/download";
import { copyImageToClipboard } from "@/lib/clipboard";
import Lightbox from "./Lightbox";
import TransferDialog from "./TransferDialog";
import VideoPanel from "./VideoPanel";
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
function SelectIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="3" width="18" height="18" rx="3" />
      <path d="m9 12 2 2 4-4" />
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
  selectMode,
  isSelected,
  onToggleSelect,
  onDelete,
  onOpen,
}: {
  photo: Photo;
  position: number;
  collageId: string;
  ownerId: string;
  selectMode: boolean;
  isSelected: boolean;
  onToggleSelect: (id: string) => void;
  onDelete: (id: string) => void;
  onOpen: (photoId: string) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: photo.id, disabled: selectMode });

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  const selectable = photo.state === "uploaded";

  const cn = [
    s.tile,
    isDragging ? s.dragging : "",
    photo.state === "failed" ? s.failed : "",
    selectMode ? s.selecting : "",
    isSelected ? s.selected : "",
    selectMode && !selectable ? s.unselectable : "",
  ]
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
    <div
      ref={setNodeRef}
      style={style}
      className={cn}
      {...attributes}
      {...listeners}
      onClick={selectMode && selectable ? () => onToggleSelect(photo.id) : undefined}
    >
      {photo.state === "uploaded" ? (
        <img
          src={photo.url}
          alt=""
          loading="lazy"
          onClick={
            selectMode
              ? undefined
              : (e) => {
                  e.stopPropagation();
                  onOpen(photo.id);
                }
          }
        />
      ) : null}
      <span className={s.pos}>{String(position).padStart(2, "0")}</span>

      {selectMode && selectable && (
        <span className={`${s.selectMark} ${isSelected ? s.selectMarkOn : ""}`}>
          {isSelected && <CheckIcon />}
        </span>
      )}

      {!selectMode && (
        <div className={s.tileActions}>
          {photo.state === "uploaded" && (
            <a
              href={`/studio?source_photo_id=${encodeURIComponent(photo.id)}&from_collage=${encodeURIComponent(collageId)}`}
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
      )}
      {photo.state === "failed" && <span className={s.failedMark}>failed</span>}
    </div>
  );
}

interface Props {
  collageId: string;
  groupId: string;
  ownerId: string;
  photos: Photo[];
}

export default function PhotosGrid({ collageId, groupId, ownerId, photos: initialPhotos }: Props) {
  const router = useRouter();
  const dndId = useId();
  const [photos, setPhotos] = useState(initialPhotos);
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);
  const [selectMode, setSelectMode] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  // Publication channels this group's raw photos may be moved into. Empty when
  // the current group isn't a direct-move source → the move action is hidden.
  const [moveTargets, setMoveTargets] = useState<MoveTarget[]>([]);
  const [showTransfer, setShowTransfer] = useState(false);

  useEffect(() => {
    let alive = true;
    api.groups
      .moveTargets(groupId)
      .then((t) => alive && setMoveTargets(t))
      .catch(() => alive && setMoveTargets([]));
    return () => {
      alive = false;
    };
  }, [groupId]);

  useEffect(() => {
    setPhotos(initialPhotos);
    // Drop any selected ids that no longer exist / are no longer uploaded.
    setSelected((prev) => {
      if (prev.size === 0) return prev;
      const live = new Set(
        initialPhotos.filter((p) => p.state === "uploaded").map((p) => p.id),
      );
      const next = new Set([...prev].filter((id) => live.has(id)));
      return next.size === prev.size ? prev : next;
    });
  }, [initialPhotos]);

  // While a video is still transcoding, refresh so its state flips to
  // "готово"/"ошибка" without a manual reload.
  const hasPendingVideo = photos.some((p) => isVideo(p) && p.state === "pending");
  useEffect(() => {
    if (!hasPendingVideo) return;
    const t = setInterval(() => router.refresh(), 3000);
    return () => clearInterval(t);
  }, [hasPendingVideo, router]);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 250, tolerance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  async function onDragEnd(e: DragEndEvent) {
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    // Only images are sortable. Reorder within the image subset, then append
    // videos so the payload still covers every alive photo (the reorder
    // endpoint rejects a partial list with 409).
    const imgs = photos.filter((p) => !isVideo(p));
    const vids = photos.filter((p) => isVideo(p));
    const oldIndex = imgs.findIndex((p) => p.id === active.id);
    const newIndex = imgs.findIndex((p) => p.id === over.id);
    if (oldIndex < 0 || newIndex < 0) return;

    const prev = photos;
    const next = [...arrayMove(imgs, oldIndex, newIndex), ...vids].map((p, i) => ({
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
    const target = photos.find((p) => p.id === id);
    const msg =
      target && isVideo(target)
        ? "Удалить видео? Файл будет удалён из хранилища."
        : "Удалить фото? Soft-delete, файл останется в S3.";
    if (!confirm(msg)) return;
    await api.photos.delete(id);
    setPhotos((curr) => curr.filter((p) => p.id !== id));
    router.refresh();
  }

  const imagePhotos = photos.filter((p) => !isVideo(p));
  const videoPhotos = photos.filter((p) => isVideo(p));

  if (photos.length === 0) {
    return (
      <div style={{ marginTop: 18, color: "var(--text-muted)" }}>
        Фото пока нет. Добавь первые.
      </div>
    );
  }

  const uploaded = imagePhotos.filter((p) => p.state === "uploaded");

  function openLightbox(photoId: string) {
    const i = uploaded.findIndex((p) => p.id === photoId);
    if (i >= 0) setLightboxIndex(i);
  }

  function toggleSelect(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function exitSelect() {
    setSelectMode(false);
    setSelected(new Set());
  }

  function goToStudio(ids: string[]) {
    const unique = Array.from(new Set(ids));
    if (unique.length === 0) return;
    if (
      unique.length > 20 &&
      !confirm(`Выбрано ${unique.length} фото — отправить все в Studio одним батчем?`)
    ) {
      return;
    }
    const qs =
      `source_photo_ids=${unique.map(encodeURIComponent).join(",")}` +
      `&from_collage=${encodeURIComponent(collageId)}`;
    router.push(`/studio?${qs}`);
  }

  function onTransferDone(movedIds: string[]) {
    const gone = new Set(movedIds);
    setPhotos((curr) => curr.filter((p) => !gone.has(p.id)));
    setShowTransfer(false);
    exitSelect();
    router.refresh();
  }

  const canMove = moveTargets.length > 0;
  const allSelected = uploaded.length > 0 && selected.size === uploaded.length;

  return (
    <>
      {imagePhotos.length > 0 && (selectMode ? (
        <div className={s.selectBar}>
          <span className={s.selectCount}>Выбрано {selected.size}</span>
          <div className={s.selectBarBtns}>
            <button
              type="button"
              className={s.btnGhost}
              onClick={() =>
                setSelected(allSelected ? new Set() : new Set(uploaded.map((p) => p.id)))
              }
            >
              {allSelected ? "Снять все" : "Выбрать все"}
            </button>
            <button type="button" className={s.btnGhost} onClick={exitSelect}>
              Отмена
            </button>
            {canMove && (
              <button
                type="button"
                className={s.btnGhost}
                disabled={selected.size === 0}
                onClick={() => setShowTransfer(true)}
              >
                На публикацию ({selected.size}) →
              </button>
            )}
            <button
              type="button"
              className={s.btnCoral}
              disabled={selected.size === 0}
              onClick={() => goToStudio([...selected])}
            >
              <SparklesIcon />
              Апгрейдить ({selected.size}) →
            </button>
          </div>
        </div>
      ) : (
        <div className={s.toolbar}>
          <button type="button" className={s.btnGhost} onClick={() => setSelectMode(true)}>
            <SelectIcon />
            Выбрать
          </button>
          {uploaded.length > 0 && (
            <button
              type="button"
              className={s.btnCoral}
              onClick={() => goToStudio(uploaded.map((p) => p.id))}
            >
              <SparklesIcon />
              Апгрейдить весь коллаж
            </button>
          )}
        </div>
      ))}

      {imagePhotos.length > 0 && (
        <DndContext id={dndId} sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
          <SortableContext items={imagePhotos.map((p) => p.id)} strategy={rectSortingStrategy}>
            <div className={s.grid}>
              {imagePhotos.map((p, i) => (
                <Tile
                  key={p.id}
                  photo={p}
                  position={i + 1}
                  collageId={collageId}
                  ownerId={ownerId}
                  selectMode={selectMode}
                  isSelected={selected.has(p.id)}
                  onToggleSelect={toggleSelect}
                  onDelete={onDelete}
                  onOpen={openLightbox}
                />
              ))}
            </div>
          </SortableContext>
        </DndContext>
      )}

      <VideoPanel videos={videoPhotos} ownerId={ownerId} onDelete={onDelete} />
      {lightboxIndex !== null && (
        <Lightbox
          photos={uploaded}
          startIndex={lightboxIndex}
          ownerId={ownerId}
          onClose={() => setLightboxIndex(null)}
        />
      )}
      {showTransfer && (
        <TransferDialog
          collageId={collageId}
          targets={moveTargets}
          photoIds={[...selected]}
          onClose={() => setShowTransfer(false)}
          onDone={onTransferDone}
        />
      )}
    </>
  );
}

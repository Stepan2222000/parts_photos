"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import type {
  Collage,
  CollageDetail,
  Photo,
  SuggestedTransfer,
} from "@/lib/types";
import type { CollagePickedPhoto } from "./SourcesPanel";
import s from "./CollagePickerDialog.module.css";

type Mode = "photos" | "collage-only";

interface BaseProps {
  onClose: () => void;
  /** Pre-suggested matches (e.g. by article match) shown above the search list. */
  suggestions?: SuggestedTransfer[];
  /** Title override; default depends on mode. */
  title?: string;
}

interface PhotosProps extends BaseProps {
  mode?: "photos";
  onPick: (photos: CollagePickedPhoto[]) => void;
}

interface CollageOnlyProps extends BaseProps {
  mode: "collage-only";
  onPickCollage: (collage: { id: string; owner_id: string; group_id: string }) => void;
}

type Props = PhotosProps | CollageOnlyProps;

export default function CollagePickerDialog(props: Props) {
  const { onClose } = props;
  const mode: Mode = props.mode || "photos";
  const suggestions = props.suggestions || [];

  const [q, setQ] = useState("");
  const [results, setResults] = useState<Collage[]>([]);
  const [active, setActive] = useState<CollageDetail | null>(null);
  const [picked, setPicked] = useState<Set<string>>(new Set());

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  useEffect(() => {
    if (q.length < 2) {
      setResults([]);
      return;
    }
    const t = setTimeout(async () => {
      try {
        const r = await api.collages.search({ q, limit: 20 });
        setResults(r);
      } catch {
        setResults([]);
      }
    }, 250);
    return () => clearTimeout(t);
  }, [q]);

  async function openCollage(id: string) {
    setActive(null);
    setPicked(new Set());
    try {
      const c = await api.collages.get(id);
      setActive(c);
    } catch (e) {
      alert(`Не удалось загрузить коллаж: ${e}`);
    }
  }

  function togglePhoto(p: Photo) {
    if (p.state !== "uploaded") return;
    setPicked((cur) => {
      const next = new Set(cur);
      if (next.has(p.id)) next.delete(p.id);
      else next.add(p.id);
      return next;
    });
  }

  function confirmPhotos() {
    if (mode !== "photos" || !active) return;
    const out: CollagePickedPhoto[] = [];
    for (const p of active.photos) {
      if (picked.has(p.id)) {
        out.push({
          id: p.id,
          url: p.url,
          collageId: active.id,
          collageOwnerId: active.owner_id,
        });
      }
    }
    if (out.length > 0) (props as PhotosProps).onPick(out);
  }

  function confirmCollage() {
    if (mode !== "collage-only" || !active) return;
    (props as CollageOnlyProps).onPickCollage({
      id: active.id,
      owner_id: active.owner_id,
      group_id: active.group_id,
    });
  }

  const title =
    props.title || (mode === "collage-only" ? "Выбор коллажа" : "Выбор фото из коллажей");

  return (
    <div className={s.backdrop} onClick={onClose}>
      <div className={s.modal} onClick={(e) => e.stopPropagation()}>
        <div className={s.head}>
          <h2 className={s.title}>{title}</h2>
          <button className={s.close} onClick={onClose}>×</button>
        </div>
        <div className={s.body}>
          <div className={s.left}>
            <input
              className={s.search}
              placeholder="Найти коллаж: smart-id, артикул, имя"
              autoFocus
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
            {suggestions.length > 0 && (
              <div className={s.sugBlock}>
                <div className={s.sugLabel}>Похоже на это:</div>
                <ul className={s.list}>
                  {suggestions.map((sug) => (
                    <li
                      key={sug.collage_id}
                      className={`${s.item} ${s.sugItem} ${active?.id === sug.collage_id ? s.activeItem : ""}`}
                      onClick={() => openCollage(sug.collage_id)}
                    >
                      <div className={s.itemThumb}>★</div>
                      <div className={s.itemMain}>
                        <span className={s.itemName}>{sug.owner_id}</span>
                        {sug.owner_name && (
                          <span className={s.itemGroup}>{sug.owner_name}</span>
                        )}
                      </div>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            <ul className={s.list}>
              {results.length === 0 && q.length >= 2 && (
                <li className={s.empty}>Ничего не нашлось.</li>
              )}
              {results.map((c) => (
                <li
                  key={c.id}
                  className={`${s.item} ${active?.id === c.id ? s.activeItem : ""}`}
                  onClick={() => openCollage(c.id)}
                >
                  <div className={s.itemThumb}>
                    {c.first_photo_url ? (
                      <img src={c.first_photo_url} alt="" />
                    ) : (
                      <span>—</span>
                    )}
                  </div>
                  <div className={s.itemMain}>
                    <span className={s.itemName}>{c.owner_id}</span>
                    {c.group_name && (
                      <span className={s.itemGroup}>{c.group_name}</span>
                    )}
                  </div>
                  <span className={s.itemCount}>{c.photos_count}</span>
                </li>
              ))}
            </ul>
          </div>
          <div className={s.right}>
            {!active && (
              <div className={s.placeholder}>
                {mode === "collage-only"
                  ? "Найди коллаж и подтверди — туда уйдёт результат."
                  : "Введи запрос слева и выбери коллаж."}
              </div>
            )}
            {active && mode === "photos" && (
              <>
                <div className={s.rightHead}>
                  <h3 className={s.rightTitle}>{active.owner_id}</h3>
                  <span className={s.rightSub}>
                    {active.photos.length} фото · выбрано {picked.size}
                  </span>
                </div>
                <div className={s.grid}>
                  {active.photos
                    .filter((p) => p.state === "uploaded")
                    .map((p) => (
                      <button
                        key={p.id}
                        type="button"
                        className={`${s.cell} ${picked.has(p.id) ? s.cellPicked : ""}`}
                        onClick={() => togglePhoto(p)}
                      >
                        <img src={p.url} alt="" />
                        {picked.has(p.id) && (
                          <span className={s.check}>✓</span>
                        )}
                      </button>
                    ))}
                </div>
              </>
            )}
            {active && mode === "collage-only" && (
              <div className={s.collagePreview}>
                <div className={s.rightHead}>
                  <h3 className={s.rightTitle}>{active.owner_id}</h3>
                  <span className={s.rightSub}>
                    {active.group_name} · {active.photos.length} фото
                  </span>
                </div>
                <div className={s.grid}>
                  {active.photos
                    .filter((p) => p.state === "uploaded")
                    .slice(0, 12)
                    .map((p) => (
                      <div key={p.id} className={s.cell}>
                        <img src={p.url} alt="" />
                      </div>
                    ))}
                </div>
              </div>
            )}
          </div>
        </div>
        <div className={s.foot}>
          <button className={s.cancel} onClick={onClose}>
            Отмена
          </button>
          {mode === "photos" ? (
            <button
              className={s.confirm}
              onClick={confirmPhotos}
              disabled={picked.size === 0}
            >
              Добавить ({picked.size})
            </button>
          ) : (
            <button
              className={s.confirm}
              onClick={confirmCollage}
              disabled={active === null}
            >
              {active ? `Перенести в ${active.owner_id}` : "Выбери коллаж"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import type { Collage, CollageDetail, Photo } from "@/lib/types";
import type { CollagePickedPhoto } from "./SourcesPanel";
import s from "./CollagePickerDialog.module.css";

interface Props {
  onClose: () => void;
  onPick: (photos: CollagePickedPhoto[]) => void;
}

export default function CollagePickerDialog({ onClose, onPick }: Props) {
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

  function confirm() {
    if (!active) return;
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
    if (out.length > 0) onPick(out);
  }

  return (
    <div className={s.backdrop} onClick={onClose}>
      <div className={s.modal} onClick={(e) => e.stopPropagation()}>
        <div className={s.head}>
          <h2 className={s.title}>Выбор фото из коллажей</h2>
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
                Введи запрос слева и выбери коллаж.
              </div>
            )}
            {active && (
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
          </div>
        </div>
        <div className={s.foot}>
          <button className={s.cancel} onClick={onClose}>
            Отмена
          </button>
          <button
            className={s.confirm}
            onClick={confirm}
            disabled={picked.size === 0}
          >
            Добавить ({picked.size})
          </button>
        </div>
      </div>
    </div>
  );
}

"use client";

import { useRef } from "react";
import type { StudioAsset } from "@/lib/types";
import s from "./AssetPicker.module.css";

interface Props {
  kind: "background" | "watermark";
  title: string;
  helper: string;
  items: StudioAsset[];
  activeId: string | null;
  onSelect: (id: string) => void;
  onUpload: (file: File) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
}

export default function AssetPicker({
  kind,
  title,
  helper,
  items,
  activeId,
  onSelect,
  onUpload,
  onDelete,
}: Props) {
  const fileInput = useRef<HTMLInputElement>(null);

  return (
    <div className={s.card}>
      <div className={s.head}>
        <div>
          <h3 className={s.title}>{title}</h3>
          <p className={s.sub}>{helper}</p>
        </div>
        <label className={s.uploadBtn}>
          + загрузить
          <input
            ref={fileInput}
            type="file"
            accept={kind === "watermark" ? "image/png,image/webp" : "image/*"}
            style={{ display: "none" }}
            onChange={async (e) => {
              const f = e.target.files?.[0];
              e.target.value = "";
              if (f) await onUpload(f);
            }}
          />
        </label>
      </div>

      {items.length === 0 ? (
        <div className={s.empty}>
          {kind === "background"
            ? "Библиотека фонов пуста. Загрузи первый — JPEG или PNG."
            : "Загрузи свой вотермарк — лучше PNG с прозрачным фоном."}
        </div>
      ) : (
        <div className={s.strip}>
          {items.map((a) => (
            <div
              key={a.id}
              className={`${s.tile} ${activeId === a.id ? s.tileActive : ""}`}
            >
              <button
                type="button"
                className={s.tileBtn}
                title={a.name}
                onClick={() => onSelect(a.id)}
              >
                <img src={a.url} alt="" />
              </button>
              <button
                type="button"
                className={s.tileX}
                title="Удалить из библиотеки"
                onClick={() => onDelete(a.id)}
              >
                ×
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

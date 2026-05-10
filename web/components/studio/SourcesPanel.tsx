"use client";

import { useRef, useState } from "react";
import { api } from "@/lib/api";
import type { Group } from "@/lib/types";
import CollagePickerDialog from "./CollagePickerDialog";
import s from "./SourcesPanel.module.css";

export interface CollagePickedPhoto {
  id: string;
  url: string;
  collageId: string;
  collageOwnerId: string;
}

interface Props {
  files: File[];
  onFilesChange: (f: File[]) => void;
  collagePhotos: CollagePickedPhoto[];
  onCollagePhotosChange: (p: CollagePickedPhoto[]) => void;
  targetCollageId: string | null;
  onTargetCollageChange: (id: string | null) => void;
}

export default function SourcesPanel({
  files,
  onFilesChange,
  collagePhotos,
  onCollagePhotosChange,
  targetCollageId,
  onTargetCollageChange,
}: Props) {
  const [tab, setTab] = useState<"upload" | "collage">("upload");
  const [over, setOver] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  function addFiles(list: FileList | File[]) {
    const arr = Array.from(list);
    onFilesChange([...files, ...arr]);
  }

  function removeFileAt(i: number) {
    onFilesChange(files.filter((_, idx) => idx !== i));
  }

  function removeCollageAt(i: number) {
    onCollagePhotosChange(collagePhotos.filter((_, idx) => idx !== i));
  }

  return (
    <div className={s.card}>
      <div className={s.head}>
        <div>
          <h3 className={s.title}>Источник</h3>
          <p className={s.sub}>
            Загрузи файлы или выбери уже залитые в коллажи. Можно и то и другое.
          </p>
        </div>
        <div className={s.tabs}>
          <button
            type="button"
            className={`${s.tab} ${tab === "upload" ? s.activeTab : ""}`}
            onClick={() => setTab("upload")}
          >
            Загрузить файлы
          </button>
          <button
            type="button"
            className={`${s.tab} ${tab === "collage" ? s.activeTab : ""}`}
            onClick={() => setTab("collage")}
          >
            Из коллажа
          </button>
        </div>
      </div>

      {tab === "upload" && (
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
            if (e.dataTransfer.files.length) addFiles(e.dataTransfer.files);
          }}
        >
          <div className={s.zoneTitle}>Перетащи фото сюда</div>
          <div className={s.zoneSub}>
            jpg, png, webp, heic. Без сжатия. Максимум 25 MB на файл (лимит gpt-image-2).
          </div>
          <button
            type="button"
            className={s.zoneBtn}
            onClick={() => fileInput.current?.click()}
          >
            Выбрать файлы
          </button>
          <input
            ref={fileInput}
            type="file"
            accept="image/*,.heic,.heif"
            multiple
            style={{ display: "none" }}
            onChange={(e) => {
              if (e.target.files) addFiles(e.target.files);
              e.target.value = "";
            }}
          />
        </div>
      )}

      {tab === "collage" && (
        <div className={s.collageStub}>
          <button
            type="button"
            className={s.zoneBtn}
            onClick={() => setPickerOpen(true)}
          >
            Открыть picker коллажей
          </button>
          {pickerOpen && (
            <CollagePickerDialog
              onClose={() => setPickerOpen(false)}
              onPick={(picked) => {
                // merge, dedupe by id
                const next = [...collagePhotos];
                for (const p of picked) {
                  if (!next.find((x) => x.id === p.id)) next.push(p);
                }
                onCollagePhotosChange(next);
                setPickerOpen(false);
              }}
            />
          )}
        </div>
      )}

      {(files.length > 0 || collagePhotos.length > 0) && (
        <div className={s.previewGrid}>
          {files.map((f, i) => (
            <div key={`u-${i}`} className={s.thumb}>
              <FileThumb file={f} />
              <button
                className={s.thumbX}
                title="Убрать"
                onClick={() => removeFileAt(i)}
              >
                ×
              </button>
              <span className={s.thumbName}>{f.name}</span>
            </div>
          ))}
          {collagePhotos.map((p, i) => (
            <div key={`c-${p.id}`} className={s.thumb}>
              <img src={p.url} alt="" />
              <button
                className={s.thumbX}
                title="Убрать"
                onClick={() => removeCollageAt(i)}
              >
                ×
              </button>
              <span className={s.thumbName}>{p.collageOwnerId}</span>
            </div>
          ))}
        </div>
      )}

      <div className={s.target}>
        <label className={s.targetLabel}>
          Куда положить результаты после генерации
        </label>
        <CollageInlineSearch
          value={targetCollageId}
          onChange={onTargetCollageChange}
        />
        <p className={s.targetHint}>
          Опционально. Если не выбрать — результаты остаются в Studio, переносятся вручную из истории.
        </p>
      </div>
    </div>
  );
}

function FileThumb({ file }: { file: File }) {
  const [src, setSrc] = useState<string | null>(null);
  if (src === null) {
    const r = new FileReader();
    r.onload = (e) => setSrc(String(e.target?.result || ""));
    r.readAsDataURL(file);
  }
  return src ? <img src={src} alt="" /> : <div className={s.thumbStub} />;
}

function CollageInlineSearch({
  value,
  onChange,
}: {
  value: string | null;
  onChange: (id: string | null) => void;
}) {
  const [q, setQ] = useState("");
  const [results, setResults] = useState<{ id: string; owner_id: string; group_name?: string | null }[]>([]);
  const [open, setOpen] = useState(false);
  const [resolved, setResolved] = useState<{ id: string; owner_id: string } | null>(null);

  async function lookup(text: string) {
    setQ(text);
    if (text.length < 2) {
      setResults([]);
      return;
    }
    try {
      const r = await api.collages.search({ q: text, limit: 8 });
      setResults(
        r.map((c) => ({ id: c.id, owner_id: c.owner_id, group_name: c.group_name })),
      );
      setOpen(true);
    } catch {
      setResults([]);
    }
  }

  if (value && resolved?.id !== value) {
    api.collages
      .get(value)
      .then((c) => setResolved({ id: c.id, owner_id: c.owner_id }))
      .catch(() => setResolved({ id: value, owner_id: value }));
  }

  if (value && resolved?.id === value) {
    return (
      <div className={s.targetPicked}>
        <span className={s.targetPickedName}>{resolved.owner_id}</span>
        <button className={s.targetClear} onClick={() => onChange(null)}>×</button>
      </div>
    );
  }

  return (
    <div className={s.targetSearch}>
      <input
        className={s.targetInput}
        placeholder="Найти коллаж по smart-id или артикулу…"
        value={q}
        onChange={(e) => lookup(e.target.value)}
        onFocus={() => results.length > 0 && setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
      />
      {open && results.length > 0 && (
        <ul className={s.targetDrop}>
          {results.map((c) => (
            <li
              key={c.id}
              className={s.targetOpt}
              onMouseDown={(e) => {
                e.preventDefault();
                onChange(c.id);
                setOpen(false);
                setQ("");
              }}
            >
              <span className={s.targetOptName}>{c.owner_id}</span>
              {c.group_name && (
                <span className={s.targetOptGroup}>{c.group_name}</span>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

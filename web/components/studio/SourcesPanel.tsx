"use client";

import { useEffect, useRef, useState } from "react";
import CollagePickerDialog from "./CollagePickerDialog";
import s from "./SourcesPanel.module.css";

// Safari/macOS converts and renames any picked file to "tempImageXXXX.heic"
// when accept contains heic/heif (WebKit bug 244666). On Safari we drop the
// explicit heic hints — macOS still surfaces .heic via image/*, and this way
// the original filename survives, which the article-matching feature needs.
const isSafariMac = (): boolean => {
  if (typeof navigator === "undefined") return false;
  const ua = navigator.userAgent;
  return /Macintosh/.test(ua) && /Safari/.test(ua) && !/Chrome|CriOS|FxiOS|Edg/.test(ua);
};
const acceptImages = (): string =>
  isSafariMac() ? "image/*" : "image/*,.heic,.heif";

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
}

export default function SourcesPanel({
  files,
  onFilesChange,
  collagePhotos,
  onCollagePhotosChange,
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
            accept={acceptImages()}
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
    </div>
  );
}

function FileThumb({ file }: { file: File }) {
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    const url = URL.createObjectURL(file);
    setSrc(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);
  return src ? <img src={src} alt="" /> : <div className={s.thumbStub} />;
}

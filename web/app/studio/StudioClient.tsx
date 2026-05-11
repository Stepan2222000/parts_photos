"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { api, ApiError } from "@/lib/api";
import type {
  StudioAsset,
  StudioBatch,
  StudioBatchDetail,
  StudioOptions,
  StudioOptionKey,
} from "@/lib/types";
import OptionsPanel from "@/components/studio/OptionsPanel";
import SourcesPanel, {
  type CollagePickedPhoto,
} from "@/components/studio/SourcesPanel";
import AssetPicker from "@/components/studio/AssetPicker";
import BatchHistory from "@/components/studio/BatchHistory";
import BatchView from "@/components/studio/BatchView";
import s from "./Studio.module.css";

const DEFAULT_OPTIONS: StudioOptions = {
  replace_bg: false,
  improve_lighting: false,
  straighten_box: false,
  fix_part_defects: false,
  clean_part_dirt: false,
  redo_labels: false,
  substitute_date: false,
  remove_extras: false,
  remove_others_watermark: true,
  add_watermark: false,
};

interface Props {
  initialSourcePhotoId: string | null;
  /** Optional collage to pull `initialSourcePhotoId` from. Quick-action URL
   *  parameter — does NOT preselect a transfer target. */
  initialSourceCollageId: string | null;
  initialBatchId: string | null;
}

// Same-shape detection so polling doesn't kick a referentially-fresh object
// to React when nothing changed.
function sameDetail(a: StudioBatchDetail | null, b: StudioBatchDetail): boolean {
  if (!a || a.id !== b.id) return false;
  if (a.status !== b.status || a.done !== b.done || a.failed !== b.failed) return false;
  if (a.jobs.length !== b.jobs.length) return false;
  for (let i = 0; i < a.jobs.length; i++) {
    const ja = a.jobs[i], jb = b.jobs[i];
    if (
      ja.status !== jb.status ||
      ja.result_s3_key !== jb.result_s3_key ||
      ja.transferred_to_photo_id !== jb.transferred_to_photo_id
    ) return false;
  }
  return true;
}

function patchBatch(prev: StudioBatch[], det: StudioBatchDetail): StudioBatch[] {
  const idx = prev.findIndex((b) => b.id === det.id);
  if (idx < 0) return prev;
  const cur = prev[idx];
  if (
    cur.status === det.status &&
    cur.done === det.done &&
    cur.failed === det.failed &&
    cur.finished_at === det.finished_at
  ) return prev;
  const next = [...prev];
  next[idx] = { ...cur, status: det.status, done: det.done, failed: det.failed, finished_at: det.finished_at };
  return next;
}

function submitButtonLabel(submitting: boolean, missing: string[], n: number): string {
  if (submitting) return "Запускаю…";
  if (missing.length > 0) return `Не хватает: ${missing.join(", ")}`;
  return `Generate (${n} фото)`;
}

export default function StudioClient({
  initialSourcePhotoId,
  initialSourceCollageId,
  initialBatchId,
}: Props) {
  const router = useRouter();

  const [options, setOptions] = useState<StudioOptions>(DEFAULT_OPTIONS);
  const [customPrompt, setCustomPrompt] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [collagePhotos, setCollagePhotos] = useState<CollagePickedPhoto[]>([]);
  const [backgrounds, setBackgrounds] = useState<StudioAsset[]>([]);
  const [watermarks, setWatermarks] = useState<StudioAsset[]>([]);
  const [bgId, setBgId] = useState<string | null>(null);
  const [wmId, setWmId] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [batches, setBatches] = useState<StudioBatch[]>([]);
  const [activeBatch, setActiveBatch] = useState<StudioBatchDetail | null>(null);
  const [activeBatchId, setActiveBatchId] = useState<string | null>(initialBatchId);

  // ── Load libraries + batches on mount, and pre-fill source if asked ───────
  useEffect(() => {
    void refreshAll();
    // Quick-action из коллажа: на странице ?source_photo_id=X&target_collage_id=Y
    // подтягиваем фото-источник, чтобы пользователь сразу видел превью.
    // (target_collage_id здесь — это collage-источник для удобного fetch'а
    // фотки; куда положить результат — выбирается уже после генерации.)
    if (initialSourcePhotoId && initialSourceCollageId) {
      (async () => {
        const c = await api.collages.get(initialSourceCollageId);
        const p = c.photos.find((x) => x.id === initialSourcePhotoId);
        if (!p) {
          setError(
            `Фото ${initialSourcePhotoId} не найдено в коллаже ${initialSourceCollageId}`,
          );
          return;
        }
        setCollagePhotos([
          {
            id: p.id,
            url: p.url,
            collageId: c.id,
            collageOwnerId: c.owner_id,
          },
        ]);
      })().catch((e) => setError(`Не удалось загрузить исходное фото: ${e}`));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const refreshAll = useCallback(async () => {
    const [bs, ws, lst] = await Promise.all([
      api.studio.listBackgrounds(),
      api.studio.listWatermarks(),
      api.studio.listBatches(50),
    ]);
    setBackgrounds(bs);
    setWatermarks(ws);
    setBatches(lst);
    if (activeBatchId) {
      const det = await api.studio.getBatch(activeBatchId);
      setActiveBatch(det);
    }
  }, [activeBatchId]);

  // ── Polling for active batch progress ─────────────────────────────────────
  const pollRef = useRef<number | null>(null);
  useEffect(() => {
    if (!activeBatchId) return;
    let mounted = true;

    async function tick() {
      try {
        const det = await api.studio.getBatch(activeBatchId!);
        if (!mounted) return;
        setActiveBatch((prev) => sameDetail(prev, det) ? prev : det);
        // Sync the rail row in-place — avoids re-fetching all 50 batches per tick.
        setBatches((prev) => patchBatch(prev, det));
        if (det.status === "queued" || det.status === "running") {
          pollRef.current = window.setTimeout(tick, 2000);
        }
      } catch (e) {
        if (mounted) {
          setError(`Не удалось загрузить батч: ${e}`);
          setActiveBatchId(null);
        }
      }
    }
    tick();
    return () => {
      mounted = false;
      if (pollRef.current) {
        clearTimeout(pollRef.current);
        pollRef.current = null;
      }
    };
  }, [activeBatchId]);

  // ── Auto-pick first asset when toggle turns on ────────────────────────────
  useEffect(() => {
    if (options.replace_bg && bgId === null && backgrounds.length > 0) {
      setBgId(backgrounds[0].id);
    }
  }, [options.replace_bg, bgId, backgrounds]);
  useEffect(() => {
    if (options.add_watermark && wmId === null && watermarks.length > 0) {
      setWmId(watermarks[0].id);
    }
  }, [options.add_watermark, wmId, watermarks]);

  // ── Submit ────────────────────────────────────────────────────────────────
  const sourceCount = files.length + collagePhotos.length;
  const missing: string[] = [];
  if (sourceCount === 0) missing.push("фото");
  if (options.replace_bg && bgId === null) missing.push("фон");
  if (options.add_watermark && wmId === null) missing.push("вотермарк");
  const submittable = !submitting && missing.length === 0;

  async function handleSubmit() {
    if (!submittable) return;
    setSubmitting(true);
    setError(null);
    try {
      const batch = await api.studio.createBatch({
        options,
        customPrompt: customPrompt.trim() || undefined,
        backgroundId: bgId ?? undefined,
        watermarkId: wmId ?? undefined,
        sourcePhotoIds: collagePhotos.map((p) => p.id),
        files,
      });
      setActiveBatchId(batch.id);
      setActiveBatch(null);
      setFiles([]);
      setCollagePhotos([]);
      setCustomPrompt("");
      // Optimistic prepend — the poller will keep this row in sync.
      setBatches((prev) => [batch, ...prev]);
    } catch (e) {
      setError(e instanceof ApiError ? `${e.status}: ${e.body}` : String(e));
    } finally {
      setSubmitting(false);
    }
  }

  function selectBatch(id: string | null) {
    if (id === activeBatchId) return;
    setActiveBatchId(id);
    setActiveBatch(null);
  }

  return (
    <div className={s.layout}>
      <aside className={s.rail}>
        <BatchHistory
          batches={batches}
          activeId={activeBatchId}
          onSelect={selectBatch}
          onDelete={async (id) => {
            const transferred = (await api.studio.getBatch(id)).jobs.filter(
              (j) => j.transferred_to_photo_id,
            ).length;
            const msg = transferred
              ? `Удалить батч? ${transferred} фото уже перенесены в коллажи — они там останутся, но потеряют связь со Studio.`
              : "Удалить батч и все его результаты?";
            if (!confirm(msg)) return;
            await api.studio.deleteBatch(id);
            if (activeBatchId === id) {
              setActiveBatchId(null);
              setActiveBatch(null);
            }
            setBatches((prev) => prev.filter((b) => b.id !== id));
          }}
        />
      </aside>

      <section className={s.canvas}>
        {activeBatchId ? (
          <BatchView
            batch={activeBatch}
            onBack={() => selectBatch(null)}
            onTransferred={async () => {
              if (activeBatchId) {
                const det = await api.studio.getBatch(activeBatchId);
                setActiveBatch(det);
              }
              router.refresh();
            }}
          />
        ) : (
          <>
            <div className={s.heroRow}>
              <h1 className={s.heroTitle}>
                Studio<span className={s.heroDot}>.</span>
              </h1>
              <p className={s.heroLead}>
                Загрузи фото или возьми из коллажа, выбери что улучшить — gpt-image-2 сделает остальное в один проход.
              </p>
            </div>

            {error && <div className={s.error}>{error}</div>}

            <SourcesPanel
              files={files}
              onFilesChange={setFiles}
              collagePhotos={collagePhotos}
              onCollagePhotosChange={setCollagePhotos}
            />

            <OptionsPanel
              options={options}
              onChange={(k: StudioOptionKey, v: boolean) =>
                setOptions((o) => ({ ...o, [k]: v }))
              }
              customPrompt={customPrompt}
              onCustomPromptChange={setCustomPrompt}
            />

            {options.replace_bg && (
              <AssetPicker
                kind="background"
                title="Background"
                helper="Выбери фон для замены."
                items={backgrounds}
                activeId={bgId}
                onSelect={setBgId}
                onUpload={async (file) => {
                  const a = await api.studio.uploadBackground(file);
                  setBackgrounds((x) => [a, ...x]);
                  setBgId(a.id);
                }}
                onDelete={async (id) => {
                  if (!confirm("Удалить фон из библиотеки?")) return;
                  await api.studio.deleteBackground(id);
                  setBackgrounds((x) => x.filter((a) => a.id !== id));
                  if (bgId === id) setBgId(null);
                }}
              />
            )}

            {options.add_watermark && (
              <AssetPicker
                kind="watermark"
                title="Watermark"
                helper="Выбери свой вотермарк (PNG с альфой работает лучше всего)."
                items={watermarks}
                activeId={wmId}
                onSelect={setWmId}
                onUpload={async (file) => {
                  const a = await api.studio.uploadWatermark(file);
                  setWatermarks((x) => [a, ...x]);
                  setWmId(a.id);
                }}
                onDelete={async (id) => {
                  if (!confirm("Удалить вотермарк из библиотеки?")) return;
                  await api.studio.deleteWatermark(id);
                  setWatermarks((x) => x.filter((a) => a.id !== id));
                  if (wmId === id) setWmId(null);
                }}
              />
            )}

            <button
              type="button"
              className={s.cta}
              onClick={handleSubmit}
              disabled={!submittable}
            >
              {submitButtonLabel(submitting, missing, sourceCount)}
            </button>
          </>
        )}
      </section>
    </div>
  );
}

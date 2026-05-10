"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
  initialTargetCollageId: string | null;
  initialBatchId: string | null;
}

export default function StudioClient({
  initialSourcePhotoId,
  initialTargetCollageId,
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
  const [targetCollageId, setTargetCollageId] = useState<string | null>(
    initialTargetCollageId,
  );
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
    if (initialSourcePhotoId && initialTargetCollageId) {
      (async () => {
        const c = await api.collages.get(initialTargetCollageId);
        const p = c.photos.find((x) => x.id === initialSourcePhotoId);
        if (!p) {
          setError(
            `Фото ${initialSourcePhotoId} не найдено в коллаже ${initialTargetCollageId}`,
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
        setActiveBatch(det);
        const lst = await api.studio.listBatches(50);
        if (!mounted) return;
        setBatches(lst);
        if (det.status === "queued" || det.status === "running") {
          pollRef.current = window.setTimeout(tick, 2000);
        }
      } catch (e) {
        // Surface the failure instead of silently re-trying. Common case:
        // batch was deleted concurrently → 404. User sees the error and can
        // pick another batch.
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
        targetCollageId: targetCollageId ?? undefined,
        sourcePhotoIds: collagePhotos.map((p) => p.id),
        files,
      });
      setActiveBatchId(batch.id);
      setActiveBatch(null); // wait for polling fetch
      // clear sources + custom prompt (but keep options + assets so user can iterate fast)
      setFiles([]);
      setCollagePhotos([]);
      setCustomPrompt("");
      // refresh batches list
      const lst = await api.studio.listBatches(50);
      setBatches(lst);
    } catch (e) {
      setError(e instanceof ApiError ? `${e.status}: ${e.body}` : String(e));
    } finally {
      setSubmitting(false);
    }
  }

  function selectBatch(id: string | null) {
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
            const b = batches.find((x) => x.id === id);
            const transferred = (await api.studio.getBatch(id)).jobs.filter(
              (j) => j.transferred_to_photo_id,
            ).length;
            const msg = transferred
              ? `Удалить батч? ${transferred} фото уже перенесены в коллажи — они там останутся, но потеряют связь со Studio.`
              : "Удалить батч и все его результаты?";
            if (!confirm(msg)) return;
            await api.studio.deleteBatch(id);
            if (activeBatchId === id) selectBatch(null);
            const lst = await api.studio.listBatches(50);
            setBatches(lst);
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
              targetCollageId={targetCollageId}
              onTargetCollageChange={setTargetCollageId}
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
              {submitting
                ? "Запускаю…"
                : missing.length > 0
                  ? `Не хватает: ${missing.join(", ")}`
                  : `Generate (${sourceCount} ${sourceCount === 1 ? "фото" : "фото"})`}
            </button>
          </>
        )}
      </section>
    </div>
  );
}

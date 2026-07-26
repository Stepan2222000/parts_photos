"use client";

import { useState } from "react";
import { api, ApiError } from "@/lib/api";
import type { StudioAsset, WatermarkConfig } from "@/lib/types";
import s from "./watermark.module.css";

interface Props {
  initialConfig: WatermarkConfig;
  initialLibrary: StudioAsset[];
}

export default function WatermarkClient({ initialConfig, initialLibrary }: Props) {
  const [config, setConfig] = useState<WatermarkConfig>(initialConfig);
  const [library, setLibrary] = useState<StudioAsset[]>(initialLibrary);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const activeId = config.watermark?.id ?? null;
  const noAsset = activeId === null;

  async function run(fn: () => Promise<void>) {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(e instanceof ApiError ? `${e.status}: ${e.body}` : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={s.wrap}>
      {error && <div className={s.error}>{error}</div>}

      {/* ── Active mark + library ─────────────────────────────────────── */}
      <section className={s.card}>
        <div className={s.head}>
          <div>
            <h2 className={s.title}>Знак</h2>
            <p className={s.sub}>
              PNG с прозрачным фоном. Выбранный знак применяется во всех
              включённых каналах: по центру, ~40% ширины кадра, полупрозрачно.
            </p>
          </div>
          <label className={s.uploadBtn}>
            + загрузить
            <input
              type="file"
              accept="image/png,image/webp"
              style={{ display: "none" }}
              onChange={(e) => {
                const f = e.target.files?.[0];
                e.target.value = "";
                if (!f) return;
                void run(async () => {
                  const a = await api.studio.uploadWatermark(f);
                  setLibrary((x) => [a, ...x]);
                  // Первый загруженный знак сразу делаем активным.
                  if (activeId === null) {
                    setConfig(await api.watermark.setAsset(a.id));
                  }
                });
              }}
            />
          </label>
        </div>

        {library.length === 0 ? (
          <div className={s.empty}>
            Библиотека пуста — загрузи PNG со знаком (лучше с прозрачным фоном).
          </div>
        ) : (
          <div className={s.strip}>
            {library.map((a) => (
              <div
                key={a.id}
                className={`${s.tile} ${activeId === a.id ? s.tileActive : ""}`}
              >
                <button
                  type="button"
                  className={s.tileBtn}
                  title={a.name}
                  disabled={busy}
                  onClick={() =>
                    void run(async () => {
                      const next = activeId === a.id ? null : a.id;
                      setConfig(await api.watermark.setAsset(next));
                    })
                  }
                >
                  <img src={a.url} alt="" />
                </button>
                {activeId === a.id && <div className={s.tileBadge}>активный</div>}
                <button
                  type="button"
                  className={s.tileX}
                  title="Удалить из библиотеки"
                  disabled={busy}
                  onClick={() =>
                    void run(async () => {
                      if (!confirm("Удалить знак из библиотеки?")) return;
                      await api.studio.deleteWatermark(a.id);
                      setLibrary((x) => x.filter((w) => w.id !== a.id));
                      if (activeId === a.id) {
                        setConfig(await api.watermark.setAsset(null));
                      }
                    })
                  }
                >
                  ×
                </button>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* ── Per-channel toggles ───────────────────────────────────────── */}
      <section className={s.card}>
        <div className={s.head}>
          <div>
            <h2 className={s.title}>Каналы</h2>
            <p className={s.sub}>
              Тумблер действует на весь канал сразу: включил — все его фото
              показываются и скачиваются со знаком, выключил — снова чистые.
            </p>
          </div>
        </div>

        {noAsset && (
          <div className={s.warn}>
            Знак не выбран — тумблеры ничего не меняют, пока не выберешь
            активный знак выше.
          </div>
        )}

        <div className={s.groups}>
          {config.groups.map((g) => (
            <label key={g.id} className={s.groupRow}>
              <span className={s.groupName}>{g.name}</span>
              <input
                type="checkbox"
                className={s.switch}
                checked={g.enabled}
                disabled={busy}
                onChange={(e) => {
                  const enabled = e.target.checked;
                  void run(async () => {
                    const upd = await api.watermark.toggleGroup(g.id, enabled);
                    setConfig((c) => ({
                      ...c,
                      groups: c.groups.map((x) =>
                        x.id === upd.id ? { ...x, enabled: upd.enabled } : x,
                      ),
                    }));
                  });
                }}
              />
            </label>
          ))}
        </div>
      </section>
    </div>
  );
}

"use client";

import { useCallback, useEffect, useState } from "react";
import { api, ApiError } from "@/lib/api";
import type { BackgroundsOverview, BgPhotoState, BgVersionState } from "@/lib/types";
import s from "./backgrounds.module.css";

interface Props {
  initialOverview: BackgroundsOverview;
}

const STATE_LABEL: Record<BgVersionState, string> = {
  running: "генерится",
  pending: "в очереди",
  failed: "ошибка",
  missing: "нет версии",
  done: "готово",
};

type Filter = "all" | BgVersionState;

export default function BackgroundsClient({ initialOverview }: Props) {
  const [ov, setOv] = useState<BackgroundsOverview>(initialOverview);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [detailFor, setDetailFor] = useState<string | null>(null);
  const [detail, setDetail] = useState<BgPhotoState[]>([]);
  const [filter, setFilter] = useState<Filter>("all");

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

  const refresh = useCallback(
    async (withDetail?: string | null) => {
      try {
        setOv(await api.backgrounds.overview());
        const d = withDetail ?? detailFor;
        if (d) setDetail(await api.backgrounds.photoStates(d));
      } catch {
        /* transient poll errors are not worth surfacing */
      }
    },
    [detailFor],
  );

  // Live updates: poll while anything is generating OR the detail panel is open.
  const generating = ov.items.some((it) => it.pending > 0);
  useEffect(() => {
    if (!generating && !detailFor) return;
    const t = setInterval(() => void refresh(), 5000);
    return () => clearInterval(t);
  }, [generating, detailFor, refresh]);

  async function toggleDetail(bgId: string) {
    if (detailFor === bgId) {
      setDetailFor(null);
      return;
    }
    setDetailFor(bgId);
    setFilter("all");
    setDetail(await api.backgrounds.photoStates(bgId));
  }

  const counts: Record<Filter, number> = {
    all: detail.length,
    running: 0,
    pending: 0,
    failed: 0,
    missing: 0,
    done: 0,
  };
  for (const p of detail) counts[p.state] += 1;
  const shown = filter === "all" ? detail : detail.filter((p) => p.state === filter);

  return (
    <div className={s.wrap}>
      {error && <div className={s.error}>{error}</div>}

      <section className={s.card}>
        <div className={s.head}>
          <div>
            <h2 className={s.title}>Фоны каталога</h2>
            <p className={s.sub}>
              В наборе {ov.set_total} фото с генерируемым фоном. «Сгенерировать» —
              делает версию этого фона для каждого фото набора (от канонического
              источника). «Сделать активным» — мгновенно переключает весь каталог
              на готовые версии; переключение обратимо.
            </p>
          </div>
          <label className={s.uploadBtn}>
            + загрузить фон
            <input
              type="file"
              accept="image/png,image/jpeg,image/webp"
              style={{ display: "none" }}
              onChange={(e) => {
                const f = e.target.files?.[0];
                e.target.value = "";
                if (!f) return;
                void run(async () => {
                  await api.studio.uploadBackground(f);
                  await refresh();
                });
              }}
            />
          </label>
        </div>

        {ov.items.length === 0 ? (
          <div className={s.empty}>
            Фонов пока нет — загрузи плиту (мрамор, камень…) в PNG/JPEG.
          </div>
        ) : (
          <div className={s.grid}>
            {ov.items.map((it) => {
              const active = ov.active_id === it.asset.id;
              const missing = ov.set_total - it.done;
              return (
                <div
                  key={it.asset.id}
                  className={`${s.bgCard} ${active ? s.bgCardActive : ""}`}
                >
                  <img className={s.bgThumb} src={it.asset.url} alt="" />
                  {active && <div className={s.bgBadge}>активный</div>}
                  <button
                    type="button"
                    className={s.tileX}
                    title="Удалить фон"
                    disabled={busy || active}
                    onClick={() =>
                      void run(async () => {
                        if (!confirm(`Удалить фон «${it.asset.name}»?`)) return;
                        await api.studio.deleteBackground(it.asset.id);
                        await refresh();
                      })
                    }
                  >
                    ×
                  </button>
                  <div className={s.bgName} title={it.asset.name}>
                    {it.asset.name}
                  </div>

                  <div className={s.cover}>
                    <span className={s.coverDone}>
                      {it.done}/{ov.set_total}
                    </span>
                    {it.pending > 0 && (
                      <span className={s.coverPending}>генерится {it.pending}</span>
                    )}
                    {it.failed > 0 && (
                      <span className={s.coverFailed}>ошибок {it.failed}</span>
                    )}
                  </div>
                  <div className={s.bar}>
                    <div
                      className={s.barFill}
                      style={{
                        width: `${ov.set_total ? Math.round((it.done / ov.set_total) * 100) : 0}%`,
                      }}
                    />
                  </div>

                  <div className={s.btnRow}>
                    {!active && (
                      <button
                        type="button"
                        className={`${s.btn} ${s.btnPrimary}`}
                        disabled={busy}
                        onClick={() =>
                          void run(async () => {
                            setOv(await api.backgrounds.setActive(it.asset.id));
                          })
                        }
                      >
                        Сделать активным
                      </button>
                    )}
                    {missing > 0 && it.pending === 0 && (
                      <button
                        type="button"
                        className={s.btn}
                        disabled={busy}
                        onClick={() =>
                          void run(async () => {
                            await api.backgrounds.generate(it.asset.id);
                            await refresh();
                          })
                        }
                      >
                        Сгенерировать ({missing})
                      </button>
                    )}
                    <button
                      type="button"
                      className={s.btn}
                      onClick={() => void toggleDetail(it.asset.id)}
                    >
                      {detailFor === it.asset.id ? "Скрыть детали" : "Детализация"}
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {detailFor && (
          <div className={s.problems}>
            <div className={s.filterRow}>
              {(Object.keys(STATE_LABEL) as BgVersionState[])
                .filter((k) => counts[k] > 0)
                .map((k) => (
                  <button
                    key={k}
                    type="button"
                    className={`${s.chip} ${filter === k ? s.chipActive : ""}`}
                    onClick={() => setFilter(filter === k ? "all" : k)}
                  >
                    {STATE_LABEL[k]} {counts[k]}
                  </button>
                ))}
              <span className={s.chipTotal}>всего {counts.all}</span>
            </div>

            {shown.map((p) => (
              <div key={p.photo_id} className={s.problemRow}>
                <a
                  href={p.version_url || p.thumb_url}
                  target="_blank"
                  rel="noreferrer"
                >
                  <img
                    className={s.problemThumb}
                    src={p.version_url || p.thumb_url}
                    alt=""
                    loading="lazy"
                  />
                </a>
                <div className={s.problemInfo}>
                  <div className={s.problemTitle}>
                    <span className={`${s.stateBadge} ${s[`state_${p.state}`] || ""}`}>
                      {STATE_LABEL[p.state]}
                    </span>{" "}
                    {p.collage_title || p.collage_id}
                    {p.attempts > 0 && ` · попыток: ${p.attempts}`}
                  </div>
                  {p.error && <div className={s.problemErr}>{p.error}</div>}
                </div>
                <label
                  className={s.standing}
                  title="Стоячая запчасть — фон с углом пол/стена"
                >
                  стоит
                  <input
                    type="checkbox"
                    checked={p.standing}
                    disabled={busy}
                    onChange={(e) => {
                      const standing = e.target.checked;
                      void run(async () => {
                        await api.backgrounds.setPhotoFlags(p.photo_id, { standing });
                        setDetail((d) =>
                          d.map((x) =>
                            x.photo_id === p.photo_id ? { ...x, standing } : x,
                          ),
                        );
                      });
                    }}
                  />
                </label>
                {p.state !== "running" && p.state !== "pending" && (
                  <button
                    type="button"
                    className={s.btn}
                    disabled={busy}
                    onClick={() =>
                      void run(async () => {
                        await api.backgrounds.regeneratePhoto(detailFor, p.photo_id);
                        await refresh();
                      })
                    }
                  >
                    Перегенерировать
                  </button>
                )}
                <button
                  type="button"
                  className={s.btn}
                  title="Фото больше не участвует в генерации фонов и показывается как есть"
                  disabled={busy}
                  onClick={() =>
                    void run(async () => {
                      await api.backgrounds.setPhotoFlags(p.photo_id, {
                        in_set: false,
                      });
                      setDetail((d) => d.filter((x) => x.photo_id !== p.photo_id));
                      await refresh();
                    })
                  }
                >
                  Убрать из набора
                </button>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

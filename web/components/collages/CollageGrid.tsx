import Link from "next/link";
import type { Collage } from "@/lib/types";
import s from "./CollageGrid.module.css";

interface Props {
  collages: Collage[];
  showGroup?: boolean;
}

function PhotoIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="3" width="18" height="18" rx="2" />
      <circle cx="8.5" cy="8.5" r="1.5" />
      <path d="m21 15-5-5L5 21" />
    </svg>
  );
}

function WarnIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10" />
      <path d="M12 7v5M12 17h.01" />
    </svg>
  );
}

export default function CollageGrid({ collages, showGroup }: Props) {
  if (collages.length === 0) {
    return (
      <div style={{ marginTop: 32, color: "var(--text-muted)" }}>
        Коллажей пока нет. Создай первый.
      </div>
    );
  }

  return (
    <div className={s.grid}>
      {collages.map((c) => (
        <Link key={c.id} href={`/collages/${c.id}`} className={s.card}>
          <div className={s.thumb}>
            {c.first_photo_url ? (
              <img src={c.first_photo_url} alt="" loading="lazy" />
            ) : (
              <div className={s.empty}>
                <PhotoIcon />
              </div>
            )}
            {showGroup && c.group_name && (
              <span className={s.groupBadge}>{c.group_name}</span>
            )}
          </div>
          <div className={s.meta}>
            <div className={s.name}>
              {c.owner_name || c.owner_id}
            </div>
            <div className={s.art}>
              {c.owner_articles?.length ? c.owner_articles.join(" · ") : c.owner_id}
            </div>
            <div className={s.foot}>
              {c.photos_count > 0 ? (
                <span className={s.count}>
                  <PhotoIcon />
                  {c.photos_count} фото
                </span>
              ) : (
                <span className={`${s.count} ${s.countWarn}`}>
                  <WarnIcon />
                  нет фото
                </span>
              )}
            </div>
          </div>
        </Link>
      ))}
    </div>
  );
}

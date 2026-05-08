import type { CollageDetail } from "@/lib/types";
import s from "./OwnerCard.module.css";

interface Props {
  collage: CollageDetail;
  thumbUrl?: string | null;
}

export default function OwnerCard({ collage, thumbUrl }: Props) {
  return (
    <article className={s.card}>
      <div className={s.thumb}>
        {thumbUrl ? <img src={thumbUrl} alt="" /> : null}
      </div>
      <div className={s.body}>
        <div className={s.row}>
          <span className={s.id}>{collage.owner_id}</span>
          <span
            className={`${s.kind} ${
              collage.owner_kind === "smart_part" ? s.kindSmart : s.kindInstance
            }`}
          >
            {collage.owner_kind === "smart_part" ? "Smart part" : "Instance"}
          </span>
        </div>
        <div className={s.name}>
          {collage.owner_name ? `${collage.owner_name}.` : "Без названия."}
        </div>
        {collage.owner_articles.length > 0 && (
          <div className={s.articles}>
            {collage.owner_articles.map((a) => (
              <span key={a} className={s.chip}>
                {a}
              </span>
            ))}
          </div>
        )}
      </div>
    </article>
  );
}

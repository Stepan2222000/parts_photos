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
          {collage.owner_id ? (
            <>
              <span className={s.id}>
                {collage.owner_kind === "instance" ? `#${collage.owner_id}` : collage.owner_id}
              </span>
              <span
                className={`${s.kind} ${
                  collage.owner_kind === "smart_part" ? s.kindSmart : s.kindInstance
                }`}
              >
                {collage.owner_kind === "smart_part" ? "Smart part" : "Экземпляр"}
              </span>
            </>
          ) : (
            <span className={`${s.kind} ${s.kindSmart}`}>Без привязки</span>
          )}
          {collage.owner_kind === "instance" && collage.owner_condition === "defect" && (
            <span className={s.defect}>дефект</span>
          )}
          {collage.owner_kind === "instance" && collage.owner_condition === "personal" && (
            <span className={s.defect}>personal</span>
          )}
          {collage.owner_kind === "instance" && collage.owner_condition === "new" && (
            <span className={s.defect}>новое</span>
          )}
        </div>
        <div className={s.name}>
          {collage.title?.trim()
            ? `${collage.title.trim()}.`
            : collage.owner_name
              ? `${collage.owner_name}.`
              : "Без названия."}
        </div>
        {collage.title?.trim() && collage.owner_name && (
          <div style={{ color: "var(--text-muted)", fontSize: 13, marginTop: 2 }}>
            {collage.owner_name}
          </div>
        )}
        {collage.owner_articles.length > 0 && (
          <div className={s.articles}>
            {collage.owner_articles.map((a) => (
              <span key={a} className={s.chip}>
                {a}
              </span>
            ))}
          </div>
        )}
        {collage.owner_kind === "instance" && collage.owner_condition_note && (
          <div className={s.defectNote}>{collage.owner_condition_note}</div>
        )}
      </div>
    </article>
  );
}

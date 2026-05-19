import Shell from "@/components/shell/Shell";
import OwnerCard from "@/components/owners/OwnerCard";
import DraftNoteEditor from "@/components/collages/DraftNoteEditor";
import PhotosGrid from "@/components/photos/PhotosGrid";
import Uploader from "@/components/upload/Uploader";
import { api } from "@/lib/api";
import bannerS from "@/components/collages/DraftBanner.module.css";

interface Props {
  params: Promise<{ id: string }>;
}

function crumbLabel(note: string | null | undefined, max = 48): string {
  const t = (note || "").trim();
  if (!t) return "Черновик";
  return t.length > max ? `${t.slice(0, max)}…` : t;
}

export default async function CollagePage({ params }: Props) {
  const { id } = await params;
  const [groups, collage] = await Promise.all([
    api.groups.list(),
    api.collages.get(id),
  ]);

  const isDraft = collage.owner_kind === "draft";
  const firstPhotoUrl =
    collage.photos.find((p) => p.state === "uploaded")?.url ?? null;

  return (
    <Shell
      groups={groups}
      activeGroupId={collage.group_id}
      crumbs={[
        { label: "Photos" },
        { label: collage.group_name },
        {
          label: isDraft ? crumbLabel(collage.note) : collage.owner_id,
          here: true,
        },
      ]}
    >
      {isDraft ? (
        <>
          <div className={bannerS.banner}>
            <span className={bannerS.badge}>Черновик</span>
            Не привязан к item в учёте. Комментарий — для ручной разводки после съёмки.
          </div>
          <DraftNoteEditor collageId={collage.id} initialNote={collage.note || ""} />
        </>
      ) : (
        <OwnerCard collage={collage} thumbUrl={firstPhotoUrl} />
      )}

      <div
        style={{
          display: "flex",
          alignItems: "baseline",
          justifyContent: "space-between",
          margin: "36px 0 14px",
          gap: 12,
          flexWrap: "wrap",
        }}
      >
        <div style={{ display: "flex", alignItems: "baseline", gap: 14 }}>
          <h2 className="display display-sm">Photos.</h2>
          <span style={{ color: "var(--text-muted)", fontSize: 13.5 }}>
            {collage.photos.filter((p) => p.state === "uploaded").length} фото
          </span>
        </div>
      </div>

      <PhotosGrid
        collageId={collage.id}
        ownerId={collage.owner_id}
        photos={collage.photos}
        hideStudio={isDraft}
      />
      <Uploader collageId={collage.id} />
    </Shell>
  );
}

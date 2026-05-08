import Shell from "@/components/shell/Shell";
import OwnerCard from "@/components/owners/OwnerCard";
import PhotosGrid from "@/components/photos/PhotosGrid";
import Uploader from "@/components/upload/Uploader";
import { api } from "@/lib/api";

interface Props {
  params: Promise<{ id: string }>;
}

export default async function CollagePage({ params }: Props) {
  const { id } = await params;
  const [groups, collage] = await Promise.all([
    api.groups.list(),
    api.collages.get(id),
  ]);

  const firstPhotoUrl =
    collage.photos.find((p) => p.state === "uploaded")?.url ?? null;

  return (
    <Shell
      groups={groups}
      activeGroupId={collage.group_id}
      crumbs={[
        { label: "Photos" },
        { label: collage.group_name },
        { label: collage.owner_id, here: true },
      ]}
    >
      <OwnerCard collage={collage} thumbUrl={firstPhotoUrl} />

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

      <PhotosGrid collageId={collage.id} ownerId={collage.owner_id} photos={collage.photos} />
      <Uploader collageId={collage.id} />
    </Shell>
  );
}

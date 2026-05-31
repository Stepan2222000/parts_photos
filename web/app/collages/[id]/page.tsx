import Shell from "@/components/shell/Shell";
import OwnerCard from "@/components/owners/OwnerCard";
import PhotosGrid from "@/components/photos/PhotosGrid";
import Uploader from "@/components/upload/Uploader";
import { api } from "@/lib/api";
import { isVideo } from "@/lib/types";

interface Props {
  params: Promise<{ id: string }>;
}

export default async function CollagePage({ params }: Props) {
  const { id } = await params;
  const [groups, collage] = await Promise.all([
    api.groups.list(),
    api.collages.get(id),
  ]);

  const allowsVideo = groups.find((g) => g.id === collage.group_id)?.allows_video ?? false;
  const imageCount = collage.photos.filter(
    (p) => p.state === "uploaded" && !isVideo(p),
  ).length;

  const firstPhotoUrl =
    collage.photos.find((p) => p.state === "uploaded" && !isVideo(p))?.url ?? null;

  return (
    <Shell
      groups={groups}
      activeGroupId={collage.group_id}
      crumbs={[
        { label: "Photos" },
        { label: collage.group_name },
        {
          label:
            collage.title?.trim() ||
            (collage.owner_kind === "instance"
              ? `#${collage.owner_id}`
              : collage.owner_id) ||
            "Без названия",
          here: true,
        },
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
            {imageCount} фото
          </span>
        </div>
      </div>

      <PhotosGrid
        collageId={collage.id}
        groupId={collage.group_id}
        ownerId={collage.owner_id ?? collage.title?.trim() ?? collage.id}
        photos={collage.photos}
      />
      <Uploader collageId={collage.id} allowsVideo={allowsVideo} />
    </Shell>
  );
}

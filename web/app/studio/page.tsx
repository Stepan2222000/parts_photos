import Shell from "@/components/shell/Shell";
import { api } from "@/lib/api";
import StudioClient from "./StudioClient";

interface SP {
  // Quick-action from a collage: one photo (legacy ✨) or many (bulk upgrade).
  source_photo_id?: string;
  source_photo_ids?: string;
  // Collage to pull the source photo(s) from. `from_collage` is the new name;
  // `target_collage_id` is the legacy alias (never a transfer target — the
  // target is chosen on the results screen).
  from_collage?: string;
  target_collage_id?: string;
  batch?: string;
}

export default async function StudioPage({
  searchParams,
}: {
  searchParams: Promise<SP>;
}) {
  const sp = await searchParams;
  const groups = await api.groups.list();

  const sourcePhotoIds = sp.source_photo_ids
    ? sp.source_photo_ids.split(",").map((x) => x.trim()).filter(Boolean)
    : sp.source_photo_id
      ? [sp.source_photo_id]
      : [];

  return (
    <Shell
      groups={groups}
      crumbs={[{ label: "Photos" }, { label: "Studio", here: true }]}
    >
      <StudioClient
        initialSourcePhotoIds={sourcePhotoIds}
        initialSourceCollageId={sp.from_collage ?? sp.target_collage_id ?? null}
        initialBatchId={sp.batch ?? null}
      />
    </Shell>
  );
}

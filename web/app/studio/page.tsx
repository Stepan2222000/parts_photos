import Shell from "@/components/shell/Shell";
import { api } from "@/lib/api";
import StudioClient from "./StudioClient";

interface SP {
  source_photo_id?: string;
  // target_collage_id is accepted (legacy quick-action URL) but ignored —
  // the target now is chosen on the results screen.
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

  return (
    <Shell
      groups={groups}
      crumbs={[{ label: "Photos" }, { label: "Studio", here: true }]}
    >
      <StudioClient
        initialSourcePhotoId={sp.source_photo_id ?? null}
        initialSourceCollageId={sp.target_collage_id ?? null}
        initialBatchId={sp.batch ?? null}
      />
    </Shell>
  );
}

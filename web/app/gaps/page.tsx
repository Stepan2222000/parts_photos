import Shell from "@/components/shell/Shell";
import { api } from "@/lib/api";
import GapsClient from "./GapsClient";
import type { GapKind } from "@/lib/types";

interface Props {
  searchParams: Promise<{ kind?: GapKind; q?: string }>;
}

export default async function GapsPage({ searchParams }: Props) {
  const sp = await searchParams;
  const kind: GapKind = sp.kind ?? "reference";
  const q = sp.q?.trim() || "";

  const [groups, counts, rows] = await Promise.all([
    api.groups.list(),
    api.gaps.counts(),
    api.gaps.list(kind, { q: q || undefined }),
  ]);

  return (
    <Shell
      groups={groups}
      crumbs={[{ label: "Photos" }, { label: "Пробелы фото", here: true }]}
    >
      <h1 className="display display-md">Пробелы фото.</h1>
      <p
        style={{
          color: "var(--text-muted)",
          fontSize: 14,
          marginTop: 8,
          maxWidth: 640,
        }}
      >
        Где не хватает фото по тому, что есть в наличии. Заполняй из реальных
        фотографий или свободных коллажей — переносом или апгрейдом в Studio.
      </p>

      <GapsClient
        initialKind={kind}
        initialQ={q}
        initialCounts={counts}
        initialRows={rows}
      />
    </Shell>
  );
}

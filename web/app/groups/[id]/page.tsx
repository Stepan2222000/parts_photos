import Shell from "@/components/shell/Shell";
import CollageGrid from "@/components/collages/CollageGrid";
import NewCollageButton from "@/components/collages/NewCollageButton";
import { api } from "@/lib/api";

interface Props {
  params: Promise<{ id: string }>;
}

export default async function GroupPage({ params }: Props) {
  const { id } = await params;
  const [groups, collages] = await Promise.all([
    api.groups.list(),
    api.groups.listCollages(id),
  ]);
  const active = groups.find((g) => g.id === id);
  if (!active) {
    return <div style={{ padding: 24 }}>Группа не найдена</div>;
  }

  const photosCount = collages.reduce((acc, c) => acc + c.photos_count, 0);
  const emptyCount = collages.filter((c) => c.photos_count === 0).length;

  return (
    <Shell
      groups={groups}
      activeGroupId={id}
      crumbs={[{ label: "Photos" }, { label: active.name, here: true }]}
      topbarRight={<NewCollageButton groupId={id} />}
    >
      <h1 className="display display-md">{active.name}.</h1>
      {active.description && (
        <p style={{ color: "var(--text-muted)", fontSize: 14, marginTop: 8, maxWidth: 620 }}>
          {active.description}
        </p>
      )}

      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          gap: 18,
          marginTop: 22,
          alignItems: "baseline",
          color: "var(--text-muted)",
          fontSize: 13,
        }}
      >
        <span>
          <strong style={{ color: "var(--text-strong)", fontWeight: 500 }}>{collages.length}</strong> коллажей
        </span>
        <span style={{ color: "var(--text-vfaint)" }}>·</span>
        <span>
          <strong style={{ color: "var(--text-strong)", fontWeight: 500 }}>{photosCount}</strong> фото
        </span>
        <span style={{ color: "var(--text-vfaint)" }}>·</span>
        <span>
          <strong style={{ color: "var(--text-strong)", fontWeight: 500 }}>{emptyCount}</strong> без фото
        </span>
      </div>

      <CollageGrid collages={collages} />
    </Shell>
  );
}

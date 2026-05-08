import Shell from "@/components/shell/Shell";
import SearchClient from "./SearchClient";
import { api } from "@/lib/api";

type Filter = "all" | "empty" | "few";
type Sort = "updated" | "count" | "owner";

interface Props {
  searchParams: Promise<{
    q?: string;
    group_id?: string;
    filter?: Filter;
    sort?: Sort;
  }>;
}

export default async function PhotosSearchPage({ searchParams }: Props) {
  const sp = await searchParams;
  const q = sp.q?.trim() || "";
  const filter: Filter = sp.filter ?? "all";
  const sort: Sort = sp.sort ?? "updated";
  const groupId = sp.group_id || "";

  const groups = await api.groups.list();
  const initialResults = q
    ? await api.collages.search({
        q,
        group_id: groupId || undefined,
        filter,
        sort,
      })
    : [];

  return (
    <Shell
      groups={groups}
      crumbs={[{ label: "Photos" }, { label: "Search photos", here: true }]}
    >
      <h1 className="display display-md">Search photos.</h1>
      <p
        style={{
          color: "var(--text-muted)",
          fontSize: 14,
          marginTop: 8,
          maxWidth: 620,
        }}
      >
        Поиск по нашим коллажам — по smart-id, названию запчасти или артикулу. Результаты обновляются на лету.
      </p>

      <SearchClient
        groups={groups}
        initialQ={q}
        initialFilter={filter}
        initialSort={sort}
        initialGroupId={groupId}
        initialResults={initialResults}
      />
    </Shell>
  );
}

import type {
  Collage,
  CollageDetail,
  Group,
  OwnerSearchResult,
  Photo,
} from "./types";

const BASE =
  process.env.NEXT_PUBLIC_PHOTOS_API_BASE ||
  process.env.PHOTOS_API_BASE ||
  "http://localhost:8001";

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly path: string,
    readonly body: string,
  ) {
    super(`API ${status} on ${path}: ${body}`);
    this.name = "ApiError";
  }
}

async function req<T>(path: string, init?: RequestInit): Promise<T> {
  const r = await fetch(`${BASE}${path}`, {
    cache: "no-store",
    ...init,
    headers: { "content-type": "application/json", ...(init?.headers || {}) },
  });
  if (!r.ok) {
    throw new ApiError(r.status, path, await r.text());
  }
  if (r.status === 204) return undefined as unknown as T;
  return r.json();
}

export const api = {
  groups: {
    list: () => req<Group[]>("/groups"),
    create: (body: { name: string; description?: string; is_reference?: boolean }) =>
      req<Group>("/groups", { method: "POST", body: JSON.stringify(body) }),
    delete: (id: string) => req<void>(`/groups/${id}`, { method: "DELETE" }),
    reorder: (updates: { group_id: string; position: number }[]) =>
      req<void>("/groups/positions", {
        method: "PUT",
        body: JSON.stringify(updates),
      }),
    listCollages: (
      id: string,
      params: { q?: string; filter?: "all" | "empty" | "few"; sort?: "updated" | "count" | "owner" } = {},
    ) => {
      const u = new URLSearchParams();
      if (params.q) u.set("q", params.q);
      if (params.filter) u.set("filter", params.filter);
      if (params.sort) u.set("sort", params.sort);
      const qs = u.toString();
      return req<Collage[]>(`/groups/${id}/collages${qs ? `?${qs}` : ""}`);
    },
  },
  collages: {
    create: (body: { group_id: string; owner_kind: "smart_part" | "instance"; owner_id: string }) =>
      req<Collage>("/collages", { method: "POST", body: JSON.stringify(body) }),
    get: (id: string) => req<CollageDetail>(`/collages/${id}`),
    delete: (id: string) => req<void>(`/collages/${id}`, { method: "DELETE" }),
    reorder: (id: string, updates: { photo_id: string; position: number }[]) =>
      req<void>(`/collages/${id}/positions`, {
        method: "PUT",
        body: JSON.stringify(updates),
      }),
    search: (params: {
      q: string;
      group_id?: string;
      filter?: "all" | "empty" | "few";
      sort?: "updated" | "count" | "owner";
      limit?: number;
    }) => {
      const u = new URLSearchParams({ q: params.q });
      if (params.group_id) u.set("group_id", params.group_id);
      if (params.filter) u.set("filter", params.filter);
      if (params.sort) u.set("sort", params.sort);
      if (params.limit) u.set("limit", String(params.limit));
      return req<Collage[]>(`/collages/search?${u.toString()}`);
    },
  },
  photos: {
    upload: (
      collageId: string,
      file: File,
      onProgress?: (pct: number) => void,
    ): Promise<Photo> =>
      new Promise((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        const fd = new FormData();
        fd.append("file", file);
        const path = `/collages/${collageId}/photos`;
        xhr.open("POST", `${BASE}${path}`);
        if (onProgress) {
          xhr.upload.onprogress = (e) => {
            if (e.lengthComputable) onProgress((e.loaded / e.total) * 100);
          };
        }
        xhr.onload = () => {
          if (xhr.status >= 200 && xhr.status < 300) {
            resolve(JSON.parse(xhr.responseText) as Photo);
          } else {
            reject(new ApiError(xhr.status, path, xhr.responseText));
          }
        };
        xhr.onerror = () => reject(new Error("Network error during upload"));
        xhr.send(fd);
      }),
    delete: (id: string) => req<void>(`/photos/${id}`, { method: "DELETE" }),
  },
  owners: {
    search: (q: string, limit = 20) =>
      req<OwnerSearchResult[]>(`/owners/search?q=${encodeURIComponent(q)}&limit=${limit}`),
  },
};

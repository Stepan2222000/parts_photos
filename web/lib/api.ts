import type {
  Collage,
  CollageDetail,
  Group,
  ItemSearchResponse,
  LookupItem,
  LookupSmart,
  MoveTarget,
  OwnerSearchResult,
  Photo,
  StudioAsset,
  StudioBatch,
  StudioBatchDetail,
  StudioJob,
  StudioOptions,
  TargetGroup,
  TransferRules,
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
    moveTargets: (id: string) => req<MoveTarget[]>(`/groups/${id}/move-targets`),
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
    create: (body: {
      group_id: string;
      // owner is optional for the library group; required everywhere else.
      owner_kind?: "smart_part" | "instance";
      owner_id?: string;
      title?: string;
    }) => req<Collage>("/collages", { method: "POST", body: JSON.stringify(body) }),
    get: (id: string) => req<CollageDetail>(`/collages/${id}`),
    // Publication channels valid for THIS collage (routed by item condition).
    moveTargets: (id: string) => req<MoveTarget[]>(`/collages/${id}/move-targets`),
    delete: (id: string) => req<void>(`/collages/${id}`, { method: "DELETE" }),
    reorder: (id: string, updates: { photo_id: string; position: number }[]) =>
      req<void>(`/collages/${id}/positions`, {
        method: "PUT",
        body: JSON.stringify(updates),
      }),
    transfer: (collageId: string, targetGroupId: string, photoIds: string[]) =>
      req<Photo[]>(`/collages/${collageId}/transfer`, {
        method: "POST",
        body: JSON.stringify({ target_group_id: targetGroupId, photo_ids: photoIds }),
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
  studio: {
    listBackgrounds: () => req<StudioAsset[]>("/studio/backgrounds"),
    uploadBackground: (file: File) => uploadAsset("/studio/backgrounds", file),
    deleteBackground: (id: string) =>
      req<void>(`/studio/backgrounds/${id}`, { method: "DELETE" }),
    listWatermarks: () => req<StudioAsset[]>("/studio/watermarks"),
    uploadWatermark: (file: File) => uploadAsset("/studio/watermarks", file),
    deleteWatermark: (id: string) =>
      req<void>(`/studio/watermarks/${id}`, { method: "DELETE" }),

    listBatches: (limit = 50, offset = 0) =>
      req<StudioBatch[]>(`/studio/batches?limit=${limit}&offset=${offset}`),
    getBatch: (id: string) => req<StudioBatchDetail>(`/studio/batches/${id}`),
    deleteBatch: (id: string) =>
      req<void>(`/studio/batches/${id}`, { method: "DELETE" }),

    getJob: (id: string) => req<StudioJob>(`/studio/jobs/${id}`),

    targetGroups: () => req<TargetGroup[]>("/studio/target-groups"),

    transferRules: () => req<TransferRules>("/studio/transfer-rules"),

    transfers: (
      batchId: string,
      transfers: { job_id: string; group_id: string; item_id?: number | null; smart_part_id?: string | null }[],
    ) =>
      req<Photo[]>(`/studio/batches/${batchId}/transfers`, {
        method: "POST",
        body: JSON.stringify({ transfers }),
      }),

    lookupItems: (smartPartId: string, groupId: string) =>
      req<LookupItem[]>(
        `/studio/lookup/items?smart_part_id=${encodeURIComponent(smartPartId)}&group_id=${encodeURIComponent(groupId)}`,
      ),

    itemSearch: (q: string, groupId: string, limit = 30) =>
      req<ItemSearchResponse>(
        `/studio/lookup/item-search?q=${encodeURIComponent(q)}&group_id=${encodeURIComponent(groupId)}&limit=${limit}`,
      ),

    lookupSmart: (smartPartId: string, groupId: string) =>
      req<LookupSmart>(
        `/studio/lookup/smart?smart_part_id=${encodeURIComponent(smartPartId)}&group_id=${encodeURIComponent(groupId)}`,
      ),

    createBatch: async (input: {
      options: StudioOptions;
      name?: string;
      customPrompt?: string;
      backgroundId?: string;
      watermarkId?: string;
      sourcePhotoIds?: string[];
      files?: File[];
    }): Promise<StudioBatch> => {
      const fd = new FormData();
      fd.append("options", JSON.stringify(input.options));
      if (input.name) fd.append("name", input.name);
      if (input.customPrompt) fd.append("custom_prompt", input.customPrompt);
      if (input.backgroundId) fd.append("background_id", input.backgroundId);
      if (input.watermarkId) fd.append("watermark_id", input.watermarkId);
      if (input.sourcePhotoIds && input.sourcePhotoIds.length) {
        fd.append("source_photo_ids", input.sourcePhotoIds.join(","));
      }
      for (const f of input.files || []) fd.append("files", f);

      const r = await fetch(`${BASE}/studio/batches`, {
        method: "POST",
        body: fd,
        cache: "no-store",
      });
      if (!r.ok) throw new ApiError(r.status, "/studio/batches", await r.text());
      return r.json();
    },
  },
};

async function uploadAsset(path: string, file: File): Promise<StudioAsset> {
  const fd = new FormData();
  fd.append("file", file);
  const r = await fetch(`${BASE}${path}`, {
    method: "POST",
    body: fd,
    cache: "no-store",
  });
  if (!r.ok) throw new ApiError(r.status, path, await r.text());
  return r.json();
}

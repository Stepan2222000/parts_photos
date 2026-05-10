export type OwnerKind = "smart_part" | "instance";
export type PhotoState = "pending" | "uploaded" | "failed" | "deleted";

export interface Group {
  id: string;
  name: string;
  description: string | null;
  is_reference: boolean;
  position: number;
  created_at: string;
  updated_at: string;
  collages_count: number;
  photos_count: number;
}

export interface Collage {
  id: string;
  group_id: string;
  owner_kind: OwnerKind;
  owner_id: string;
  created_at: string;
  photos_count: number;
  first_photo_url: string | null;
  // optional augmented fields, not always present
  owner_name?: string | null;
  owner_articles?: string[];
  group_name?: string | null;
}

export interface Photo {
  id: string;
  collage_id: string;
  position: number;
  s3_key: string;
  url: string;
  mime: string;
  size_bytes: number;
  state: PhotoState;
  uploaded_at: string | null;
  created_at: string;
}

export interface CollageDetail {
  id: string;
  group_id: string;
  group_name: string;
  owner_kind: OwnerKind;
  owner_id: string;
  owner_name: string | null;
  owner_articles: string[];
  photos: Photo[];
}

export interface OwnerSearchResult {
  smart_id: string;
  name: string;
  articles: string[];
}

// ─── Studio ─────────────────────────────────────────────────────────────────

export type StudioOptionKey =
  | "replace_bg"
  | "improve_lighting"
  | "straighten_box"
  | "fix_part_microdefects"
  | "redo_labels"
  | "substitute_date"
  | "remove_extras"
  | "remove_others_watermark"
  | "add_watermark";

export type StudioOptions = Record<StudioOptionKey, boolean>;

export type StudioJobStatus = "queued" | "running" | "succeeded" | "failed";
export type StudioBatchStatus = "queued" | "running" | "done" | "partial" | "failed";

export interface StudioAsset {
  id: string;
  name: string;
  s3_key: string;
  url: string;
  width: number | null;
  height: number | null;
  size_bytes: number;
  uploaded_at: string;
}

export interface SuggestedTransfer {
  collage_id: string;
  group_id: string;
  owner_id: string;
  owner_name: string | null;
  matched_article: string;
}

export interface StudioJob {
  id: string;
  batch_id: string;
  source_kind: "upload" | "collage_photo";
  source_filename: string | null;
  source_s3_key: string;
  source_url: string;
  source_photo_id: string | null;
  status: StudioJobStatus;
  result_s3_key: string | null;
  result_url: string | null;
  log_tail: string | null;
  error: string | null;
  tokens_used: number | null;
  elapsed_seconds: number | null;
  started_at: string | null;
  finished_at: string | null;
  transferred_to_photo_id: string | null;
  suggested: SuggestedTransfer[];
  created_at: string;
}

export interface StudioBatch {
  id: string;
  name: string | null;
  options_json: StudioOptions;
  custom_prompt: string | null;
  background_id: string | null;
  watermark_id: string | null;
  target_collage_id: string | null;
  status: StudioBatchStatus;
  total: number;
  done: number;
  failed: number;
  created_at: string;
  finished_at: string | null;
}

export interface StudioBatchDetail extends StudioBatch {
  jobs: StudioJob[];
}

export type OwnerKind = "smart_part" | "instance";
export type ConditionFilter = "personal" | "defect" | "not_defect" | "any";
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
  // null when the group has no manual creation mode (not configured, or
  // studio_role=none like "Поступления").
  owner_kind: OwnerKind | null;
  condition_filter: ConditionFilter | null;
  // Whether this group accepts video uploads (only source photo groups do).
  allows_video: boolean;
  // Free-form library ("Свободные коллажи"): smart binding optional (a label),
  // collage carries a required free-text title.
  owner_optional: boolean;
  title_required: boolean;
}

export interface Collage {
  id: string;
  group_id: string;
  // null for unbound library collages (no smart link).
  owner_kind: OwnerKind | null;
  owner_id: string | null;
  title?: string | null;
  created_at: string;
  photos_count: number;
  first_photo_url: string | null;
  // optional augmented fields, not always present
  owner_name?: string | null;
  owner_articles?: string[];
  group_name?: string | null;
  owner_condition?: string | null;
  owner_condition_note?: string | null;
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

export function isVideo(photo: Pick<Photo, "mime">): boolean {
  return photo.mime.startsWith("video/");
}

export interface CollageDetail {
  id: string;
  group_id: string;
  group_name: string;
  owner_kind: OwnerKind | null;
  owner_id: string | null;
  title?: string | null;
  owner_name: string | null;
  owner_articles: string[];
  owner_condition?: string | null;
  owner_condition_note?: string | null;
  photos: Photo[];
}

export interface ItemSearchResult {
  item_id: number;
  smart_part_id: string;
  smart_part_name: string | null;
  article: string | null;
  condition: string;
  condition_note: string | null;
  status: string;
  in_stock: boolean;
  passes_filter: boolean;
  selectable: boolean;
  block_reason: string | null;
  existing_collage_id: string | null;
}

export interface ItemSearchResponse {
  parts_matched: number;
  results: ItemSearchResult[];
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
  | "fix_part_defects"
  | "clean_part_dirt"
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

export interface SuggestedItem {
  item_id: number;
  condition: string;
  condition_note: string | null;
  existing_collage_id: string | null;
}

export type GroupSuggestion =
  | { kind: "smart_part"; existing_collage_id: string | null }
  | { kind: "instance"; items: SuggestedItem[] };

export interface JobSuggestions {
  smart_part_id: string;
  smart_part_name: string | null;
  matched_article: string;
  source_kind: "filename" | "source_collage";
  /** keys are target-group UUIDs */
  by_group: Record<string, GroupSuggestion>;
}

export interface TargetGroup {
  id: string;
  name: string;
  owner_kind: "smart_part" | "instance";
  condition_filter: "personal" | "defect" | "not_defect" | "any";
}

export interface TransferRules {
  /** target_uuid → list of allowed source ids ("upload" or source group uuid) */
  allowed: Record<string, string[]>;
}

/** A publication channel a collage's raw photos may be physically moved into. */
export interface MoveTarget {
  id: string;
  name: string;
}

export interface LookupSmart {
  smart_part_id: string;
  existing_collage_id: string | null;
}

export interface StudioJob {
  id: string;
  batch_id: string;
  source_kind: "upload" | "collage_photo";
  source_filename: string | null;
  source_s3_key: string;
  source_url: string;
  source_photo_id: string | null;
  source_group_id: string | null;
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
  transferred_to_group_id: string | null;
  suggestions: JobSuggestions | null;
  created_at: string;
}

export interface StudioBatch {
  id: string;
  name: string | null;
  options_json: StudioOptions;
  custom_prompt: string | null;
  background_id: string | null;
  watermark_id: string | null;
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

export interface LookupItem {
  item_id: number;
  condition: string;
  condition_note: string | null;
  existing_collage_id: string | null;
}

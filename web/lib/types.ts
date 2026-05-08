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

from __future__ import annotations

from datetime import datetime
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, Field


OwnerKind = Literal["smart_part", "instance"]
ConditionFilter = Literal["personal", "defect", "not_defect", "not_new", "any"]


class Group(BaseModel):
    id: UUID
    name: str
    description: str | None
    is_reference: bool
    position: int = 0
    created_at: datetime
    updated_at: datetime
    collages_count: int = 0
    photos_count: int = 0
    # From GROUP_SETTINGS (studio/groups.py). Both null when the group has no
    # collage-creation mode (not in config, or studio_role == "none" like
    # "Поступления"). The frontend disables "New collage" in that case.
    owner_kind: OwnerKind | None = None
    condition_filter: ConditionFilter | None = None
    # Whether this group accepts video uploads (only the source photo groups do).
    allows_video: bool = False
    # Free-form library ("Свободные коллажи"): the smart binding is optional
    # (just a label) and the collage carries a required free-text title.
    # The frontend shows an optional smart-picker + a required title field.
    owner_optional: bool = False
    title_required: bool = False
    # Library only: owner may be EITHER a smart_part OR an instance, optional.
    # The frontend shows a binding-type switch (none / smart / item).
    owner_free: bool = False


class GroupPositionUpdate(BaseModel):
    group_id: UUID
    position: int


class GroupCreate(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    description: str | None = None
    is_reference: bool = False


class GroupPatch(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=200)
    description: str | None = None


class CollageCreate(BaseModel):
    group_id: UUID
    # Owner is optional only for the free-form library group; every other group
    # requires it (enforced in create_collage against GROUP_SETTINGS).
    owner_kind: OwnerKind | None = None
    owner_id: str | None = Field(default=None, min_length=1, max_length=200)
    # Required for the library group (title_required), ignored elsewhere.
    title: str | None = Field(default=None, min_length=1, max_length=200)


class MoveTarget(BaseModel):
    """A publication channel a collage's raw photos may be moved into."""
    id: UUID
    name: str


class CollageTransferRequest(BaseModel):
    target_group_id: UUID
    photo_ids: list[UUID] = Field(min_length=1)


class Collage(BaseModel):
    id: UUID
    group_id: UUID
    # null for unbound library collages (no smart link).
    owner_kind: OwnerKind | None = None
    owner_id: str | None = None
    title: str | None = None
    created_at: datetime
    photos_count: int = 0
    first_photo_url: str | None = None
    owner_name: str | None = None
    owner_articles: list[str] = []
    group_name: str | None = None
    # instance-only: state of the physical item this collage is bound to.
    owner_condition: str | None = None
    owner_condition_note: str | None = None


class CollageDetail(BaseModel):
    id: UUID
    group_id: UUID
    group_name: str
    owner_kind: OwnerKind | None = None
    owner_id: str | None = None
    title: str | None = None
    owner_name: str | None = None
    owner_articles: list[str] = []
    owner_condition: str | None = None
    owner_condition_note: str | None = None
    photos: list["Photo"] = []


class Photo(BaseModel):
    id: UUID
    collage_id: UUID
    position: int
    s3_key: str
    url: str
    mime: str
    size_bytes: int
    state: Literal["pending", "uploaded", "failed", "deleted"]
    uploaded_at: datetime | None
    created_at: datetime


class PositionUpdate(BaseModel):
    photo_id: UUID
    position: int


class OwnerSearchResult(BaseModel):
    smart_id: str
    name: str
    articles: list[str] = []


# ── Photo gaps (заполнение пробелов в публикационных каналах) ────────────────

GapKind = Literal["reference", "personal", "defect"]


class GapCounts(BaseModel):
    reference: int
    personal: int
    defect: int


class GapRow(BaseModel):
    """One missing-photo slot. `reference` is smart_part-level; `personal`/
    `defect` are instance-level. Availability counts say what can fill it."""
    kind: GapKind
    smart_part_id: str | None = None
    item_id: int | None = None
    name: str | None = None
    articles: list[str] = []
    condition: str | None = None
    condition_note: str | None = None
    in_stock_count: int = 1  # reference: how many in_stock new instances
    real_photos: int = 0      # pickable real photos available
    free_collages: int = 0    # library collages available
    # Target channel coordinates — pass straight to /gaps/fill (and Studio).
    target_group_id: UUID
    target_owner_kind: OwnerKind
    target_owner_id: str
    # Existing (empty) target collage to reuse, if any.
    target_collage_id: UUID | None = None


class GapSourceCollage(BaseModel):
    collage_id: UUID
    group_id: UUID
    group_name: str | None = None
    owner_kind: OwnerKind | None = None
    owner_id: str | None = None
    title: str | None = None
    item_id: int | None = None
    condition: str | None = None
    photos: list["Photo"] = []


class GapSources(BaseModel):
    real: list[GapSourceCollage] = []
    free: list[GapSourceCollage] = []


class GapFillRequest(BaseModel):
    target_group_id: UUID
    target_owner_kind: OwnerKind
    target_owner_id: str = Field(min_length=1, max_length=200)
    photo_ids: list[UUID] = Field(min_length=1)


CollageDetail.model_rebuild()
GapSourceCollage.model_rebuild()

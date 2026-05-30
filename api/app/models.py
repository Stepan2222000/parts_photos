from __future__ import annotations

from datetime import datetime
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, Field


OwnerKind = Literal["smart_part", "instance"]
ConditionFilter = Literal["personal", "defect", "not_defect", "any"]


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
    owner_kind: OwnerKind
    owner_id: str = Field(min_length=1, max_length=200)


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
    owner_kind: OwnerKind
    owner_id: str
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
    owner_kind: OwnerKind
    owner_id: str
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


CollageDetail.model_rebuild()

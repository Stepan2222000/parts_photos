from __future__ import annotations

from datetime import datetime
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, Field


OwnerKind = Literal["smart_part", "instance", "draft"]


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
    owner_id: str | None = Field(default=None, min_length=1, max_length=200)
    note: str | None = None


class CollagePatch(BaseModel):
    note: str = Field(min_length=1)


class Collage(BaseModel):
    id: UUID
    group_id: UUID
    owner_kind: OwnerKind
    owner_id: str
    note: str | None = None
    created_at: datetime
    photos_count: int = 0
    first_photo_url: str | None = None
    owner_name: str | None = None
    owner_articles: list[str] = []
    group_name: str | None = None


class CollageDetail(BaseModel):
    id: UUID
    group_id: UUID
    group_name: str
    owner_kind: OwnerKind
    owner_id: str
    note: str | None = None
    owner_name: str | None = None
    owner_articles: list[str] = []
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

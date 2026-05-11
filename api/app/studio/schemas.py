from __future__ import annotations

from datetime import datetime
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, Field

JobStatus = Literal["queued", "running", "succeeded", "failed"]
BatchStatus = Literal["queued", "running", "done", "partial", "failed"]
SourceKind = Literal["upload", "collage_photo"]


class StudioAsset(BaseModel):
    """Background or watermark library entry."""

    id: UUID
    name: str
    s3_key: str
    url: str
    width: int | None
    height: int | None
    size_bytes: int
    uploaded_at: datetime


class SuggestedItem(BaseModel):
    item_id: int
    defect: bool
    defect_note: str | None = None
    existing_collage_id: UUID | None = None


class JobSuggestions(BaseModel):
    smart_part_id: str
    smart_part_name: str | None
    matched_article: str
    items_by_group: dict[str, list[SuggestedItem]] = Field(default_factory=dict)


class StudioJob(BaseModel):
    id: UUID
    batch_id: UUID
    source_kind: SourceKind
    source_filename: str | None
    source_s3_key: str
    source_url: str
    source_photo_id: UUID | None
    status: JobStatus
    result_s3_key: str | None
    result_url: str | None
    log_tail: str | None
    error: str | None
    tokens_used: int | None
    elapsed_seconds: float | None
    started_at: datetime | None
    finished_at: datetime | None
    transferred_to_photo_id: UUID | None
    transferred_to_group_id: UUID | None = None
    suggestions: JobSuggestions | None = None
    created_at: datetime


class StudioBatch(BaseModel):
    id: UUID
    name: str | None
    options_json: dict
    custom_prompt: str | None
    background_id: UUID | None
    watermark_id: UUID | None
    status: BatchStatus
    total: int
    done: int
    failed: int
    created_at: datetime
    finished_at: datetime | None


class StudioBatchDetail(StudioBatch):
    jobs: list[StudioJob] = []


class TransferEntry(BaseModel):
    job_id: UUID
    group_id: UUID
    item_id: int


class TransferRequest(BaseModel):
    transfers: list[TransferEntry] = Field(min_length=1)


class LookupItem(BaseModel):
    item_id: int
    defect: bool
    defect_note: str | None = None
    existing_collage_id: UUID | None = None


class TargetGroup(BaseModel):
    id: UUID
    name: str
    defect_filter: Literal["with", "without", "any"]

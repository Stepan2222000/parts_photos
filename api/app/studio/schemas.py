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


class SuggestedTransfer(BaseModel):
    collage_id: UUID
    group_id: UUID
    owner_id: str
    owner_name: str | None
    matched_article: str


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
    suggested: list[SuggestedTransfer] = []
    created_at: datetime


class StudioBatch(BaseModel):
    id: UUID
    name: str | None
    options_json: dict
    custom_prompt: str | None
    background_id: UUID | None
    watermark_id: UUID | None
    target_collage_id: UUID | None
    status: BatchStatus
    total: int
    done: int
    failed: int
    created_at: datetime
    finished_at: datetime | None


class StudioBatchDetail(StudioBatch):
    jobs: list[StudioJob] = []


class TransferRequest(BaseModel):
    collage_id: UUID


class BulkTransferEntry(BaseModel):
    job_id: UUID
    collage_id: UUID


class BulkTransferRequest(BaseModel):
    transfers: list[BulkTransferEntry] = Field(min_length=1)

"""Catalog background management: coverage, batch generation, switching.

The photo set is `photos.bg_set = true`. For a chosen studio background the
batch endpoint enqueues one photo_bg_versions row per photo (skipping ones
already done); the studio worker process drains them at low concurrency and
survives provider cooldowns by rescheduling rows instead of failing them.
Switching the active background is a single background_config UPDATE — the
serving layer resolves photo URLs through app.bg.
"""
from __future__ import annotations

from uuid import UUID

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from ..db import pool
from ..minio_client import public_url
from ..studio.schemas import StudioAsset
from .studio import _row_to_asset

router = APIRouter(tags=["backgrounds"])

# Only actual images participate; videos never get background versions.
_SET_PREDICATE = (
    "p.bg_set AND p.state = 'uploaded' AND p.mime NOT LIKE 'video/%'"
)


# ---------------------------------------------------------------------------
# Models
# ---------------------------------------------------------------------------


class BackgroundCoverage(BaseModel):
    asset: StudioAsset
    done: int
    pending: int  # pending + running
    failed: int


class BackgroundsOverview(BaseModel):
    active_id: UUID | None
    set_total: int
    items: list[BackgroundCoverage]


class ActiveUpdate(BaseModel):
    background_id: UUID | None


class GenerateResult(BaseModel):
    enqueued: int
    rearmed_failed: int
    already_done: int


class BgPhotoState(BaseModel):
    photo_id: UUID
    collage_id: UUID
    collage_title: str | None
    standing: bool
    # version state for this background; 'missing' = no version row yet
    state: str
    attempts: int
    error: str | None
    thumb_url: str
    version_url: str | None


class PhotoBgFlags(BaseModel):
    in_set: bool | None = None
    standing: bool | None = None


class PhotoBgFlagsState(BaseModel):
    photo_id: UUID
    in_set: bool
    standing: bool


# ---------------------------------------------------------------------------
# Overview / switching
# ---------------------------------------------------------------------------


@router.get("/backgrounds/overview", response_model=BackgroundsOverview)
async def overview() -> BackgroundsOverview:
    async with pool().acquire() as conn:
        active_id = await conn.fetchval(
            "SELECT background_id FROM background_config WHERE id = 1"
        )
        set_total = await conn.fetchval(
            f"SELECT COUNT(*) FROM photos p WHERE {_SET_PREDICATE}"
        )
        rows = await conn.fetch(
            f"""
            SELECT b.id, b.name, b.s3_key, b.width, b.height, b.size_bytes,
                   b.uploaded_at,
                   COUNT(v.id) FILTER (WHERE v.state = 'done')   AS done,
                   COUNT(v.id) FILTER (WHERE v.state IN ('pending', 'running')) AS pending,
                   COUNT(v.id) FILTER (WHERE v.state = 'failed') AS failed
            FROM studio_backgrounds b
            LEFT JOIN photo_bg_versions v
                   ON v.background_id = b.id
                  AND v.photo_id IN (SELECT p.id FROM photos p WHERE {_SET_PREDICATE})
            WHERE b.deleted_at IS NULL
            GROUP BY b.id
            ORDER BY b.uploaded_at DESC
            """
        )
    return BackgroundsOverview(
        active_id=active_id,
        set_total=set_total,
        items=[
            BackgroundCoverage(
                asset=_row_to_asset(dict(r)),
                done=r["done"], pending=r["pending"], failed=r["failed"],
            )
            for r in rows
        ],
    )


@router.put("/backgrounds/active", response_model=BackgroundsOverview)
async def set_active(body: ActiveUpdate) -> BackgroundsOverview:
    async with pool().acquire() as conn:
        if body.background_id is not None:
            ok = await conn.fetchval(
                "SELECT 1 FROM studio_backgrounds WHERE id = $1 AND deleted_at IS NULL",
                body.background_id,
            )
            if not ok:
                raise HTTPException(404, "Background asset not found")
        await conn.execute(
            "UPDATE background_config SET background_id = $1, updated_at = now() WHERE id = 1",
            body.background_id,
        )
    return await overview()


# ---------------------------------------------------------------------------
# Generation
# ---------------------------------------------------------------------------


@router.post("/backgrounds/{background_id}/generate", response_model=GenerateResult)
async def generate_missing(background_id: UUID) -> GenerateResult:
    """Enqueue versions of `background_id` for every set photo that lacks one.
    Failed rows are re-armed; done/pending/running rows are left alone. The
    worker picks rows up on its own — this endpoint only queues."""
    async with pool().acquire() as conn:
        ok = await conn.fetchval(
            "SELECT 1 FROM studio_backgrounds WHERE id = $1 AND deleted_at IS NULL",
            background_id,
        )
        if not ok:
            raise HTTPException(404, "Background asset not found")

        async with conn.transaction():
            enqueued = await conn.fetchval(
                f"""
                WITH ins AS (
                    INSERT INTO photo_bg_versions (photo_id, background_id)
                    SELECT p.id, $1 FROM photos p
                    WHERE {_SET_PREDICATE}
                    ON CONFLICT (photo_id, background_id) DO NOTHING
                    RETURNING 1
                )
                SELECT COUNT(*) FROM ins
                """,
                background_id,
            )
            rearmed = await conn.fetchval(
                """
                WITH upd AS (
                    UPDATE photo_bg_versions
                       SET state = 'pending', attempts = 0, error = NULL,
                           next_retry_at = now(), updated_at = now()
                     WHERE background_id = $1 AND state = 'failed'
                    RETURNING 1
                )
                SELECT COUNT(*) FROM upd
                """,
                background_id,
            )
            done = await conn.fetchval(
                "SELECT COUNT(*) FROM photo_bg_versions WHERE background_id = $1 AND state = 'done'",
                background_id,
            )
    return GenerateResult(enqueued=enqueued, rearmed_failed=rearmed, already_done=done)


@router.post(
    "/backgrounds/{background_id}/photos/{photo_id}/generate",
    response_model=GenerateResult,
)
async def regenerate_one(background_id: UUID, photo_id: UUID) -> GenerateResult:
    """Force a fresh generation for one photo — works for failed AND done
    versions (redoing a bad-looking result)."""
    row = await pool().fetchrow(
        """
        INSERT INTO photo_bg_versions (photo_id, background_id)
        VALUES ($1, $2)
        ON CONFLICT (photo_id, background_id) DO UPDATE
           SET state = 'pending', attempts = 0, error = NULL,
               next_retry_at = now(), updated_at = now()
        RETURNING id
        """,
        photo_id, background_id,
    )
    if row is None:
        raise HTTPException(404, "Photo not found")
    return GenerateResult(enqueued=1, rearmed_failed=0, already_done=0)


@router.get("/backgrounds/{background_id}/photos", response_model=list[BgPhotoState])
async def photo_states(background_id: UUID) -> list[BgPhotoState]:
    """Per-photo detail for one background: every set photo with its version
    state (running / failed / pending / missing / done). Running and failed
    first — that is what the detail panel watches."""
    rows = await pool().fetch(
        f"""
        SELECT p.id AS photo_id, p.collage_id, p.bg_standing,
               p.s3_key, p.canonical_s3_key,
               c.title AS collage_title,
               COALESCE(v.state, 'missing') AS state,
               COALESCE(v.attempts, 0) AS attempts,
               v.error, v.s3_key AS version_key, v.updated_at
        FROM photos p
        JOIN photo_collages c ON c.id = p.collage_id
        LEFT JOIN photo_bg_versions v
               ON v.photo_id = p.id AND v.background_id = $1
        WHERE {_SET_PREDICATE}
        ORDER BY CASE COALESCE(v.state, 'missing')
                     WHEN 'running' THEN 0
                     WHEN 'failed'  THEN 1
                     WHEN 'pending' THEN 2
                     WHEN 'missing' THEN 3
                     ELSE 4
                 END,
                 v.updated_at DESC NULLS LAST
        """,
        background_id,
    )
    return [
        BgPhotoState(
            photo_id=r["photo_id"],
            collage_id=r["collage_id"],
            collage_title=r["collage_title"],
            standing=r["bg_standing"],
            state=r["state"],
            attempts=r["attempts"],
            error=r["error"],
            thumb_url=public_url(r["canonical_s3_key"] or r["s3_key"]),
            version_url=(
                public_url(r["version_key"])
                if r["state"] == "done" and r["version_key"]
                else None
            ),
        )
        for r in rows
    ]


# ---------------------------------------------------------------------------
# Per-photo flags
# ---------------------------------------------------------------------------


@router.put("/photos/{photo_id}/bg-flags", response_model=PhotoBgFlagsState)
async def set_photo_flags(photo_id: UUID, body: PhotoBgFlags) -> PhotoBgFlagsState:
    row = await pool().fetchrow(
        """
        UPDATE photos
           SET bg_set      = COALESCE($2, bg_set),
               bg_standing = COALESCE($3, bg_standing),
               -- freeze the generation source the moment a photo enters the set
               canonical_s3_key = CASE
                   WHEN COALESCE($2, bg_set) AND canonical_s3_key IS NULL THEN s3_key
                   ELSE canonical_s3_key
               END
         WHERE id = $1 AND state <> 'deleted'
        RETURNING id, bg_set, bg_standing
        """,
        photo_id, body.in_set, body.standing,
    )
    if row is None:
        raise HTTPException(404, "Photo not found")
    return PhotoBgFlagsState(
        photo_id=row["id"], in_set=row["bg_set"], standing=row["bg_standing"]
    )

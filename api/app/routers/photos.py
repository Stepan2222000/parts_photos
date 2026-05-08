from __future__ import annotations

import logging
from uuid import UUID, uuid4

from fastapi import APIRouter, HTTPException, UploadFile

from ..db import pool
from ..images import InvalidImage, to_jpeg
from ..minio_client import public_url, put_jpeg
from ..models import Photo, PositionUpdate

logger = logging.getLogger("photos.upload")
router = APIRouter(tags=["photos"])


@router.post("/collages/{collage_id}/photos", response_model=Photo, status_code=201)
async def upload_photo(collage_id: UUID, file: UploadFile) -> Photo:
    head = await pool().fetchrow(
        "SELECT group_id FROM photo_collages WHERE id = $1", collage_id
    )
    if head is None:
        raise HTTPException(404, "Collage not found")
    group_id: UUID = head["group_id"]

    raw = await file.read()
    if not raw:
        raise HTTPException(400, "Empty file")

    source_mime = file.content_type or ""
    try:
        jpeg = to_jpeg(raw, source_mime)
    except InvalidImage as e:
        logger.warning(
            "upload decode failed: name=%r mime=%r size=%d magic=%r err=%s",
            file.filename, source_mime, len(raw), raw[:16].hex(), e,
        )
        raise HTTPException(
            400,
            f"{e} | filename={file.filename!r} size={len(raw)} magic={raw[:16].hex()}",
        ) from e

    photo_id = uuid4()
    s3_key = f"groups/{group_id}/collages/{collage_id}/{photo_id}.jpg"

    async with pool().acquire() as conn:
        async with conn.transaction():
            # Serialize position-assignment per collage. Without this,
            # parallel uploads race: both read MAX(position)=N, both try
            # to INSERT N+1, and the second hits UNIQUE(collage_id,position).
            await conn.execute(
                "SELECT pg_advisory_xact_lock(hashtextextended($1::text, 0))",
                str(collage_id),
            )
            row = await conn.fetchrow(
                """
                INSERT INTO photos (id, collage_id, position, s3_key, mime, size_bytes, state)
                VALUES (
                    $1, $2,
                    -- Partial unique index covers only state<>'deleted', so we
                    -- compute MAX over the same predicate. Soft-deleted rows
                    -- don't block a new INSERT.
                    COALESCE((SELECT MAX(position) + 1 FROM photos
                              WHERE collage_id = $2 AND state <> 'deleted'), 1),
                    $3, 'image/jpeg', $4, 'pending'
                )
                RETURNING id, collage_id, position, s3_key, mime, size_bytes,
                          state, uploaded_at, created_at
                """,
                photo_id, collage_id, s3_key, len(jpeg),
            )

    try:
        put_jpeg(s3_key, jpeg)
    except Exception as e:
        await pool().execute(
            "UPDATE photos SET state = 'failed' WHERE id = $1", photo_id
        )
        raise HTTPException(500, f"MinIO upload failed: {e}") from e

    final = await pool().fetchrow(
        """
        UPDATE photos SET state = 'uploaded', uploaded_at = now()
        WHERE id = $1
        RETURNING id, collage_id, position, s3_key, mime, size_bytes,
                  state, uploaded_at, created_at
        """,
        photo_id,
    )
    return Photo(**dict(final), url=public_url(final["s3_key"]))


@router.delete("/photos/{photo_id}", status_code=204)
async def soft_delete_photo(photo_id: UUID) -> None:
    res = await pool().execute(
        """
        UPDATE photos SET state = 'deleted', deleted_at = now()
        WHERE id = $1 AND state <> 'deleted'
        """,
        photo_id,
    )
    if res.endswith(" 0"):
        raise HTTPException(404, "Photo not found or already deleted")


@router.post("/photos/{photo_id}/retry", response_model=Photo)
async def retry_failed_photo(photo_id: UUID) -> Photo:
    raise HTTPException(
        501,
        "Retry is not yet implemented — re-upload the file via POST /collages/{id}/photos",
    )


@router.put("/collages/{collage_id}/positions", status_code=204)
async def reorder_photos(collage_id: UUID, updates: list[PositionUpdate]) -> None:
    if not updates:
        raise HTTPException(400, "Empty positions list")

    ids = [u.photo_id for u in updates]
    positions = [u.position for u in updates]
    if len(set(positions)) != len(positions):
        raise HTTPException(400, "Duplicate positions in payload")

    async with pool().acquire() as conn:
        async with conn.transaction():
            # Same lock key as upload_photo. Ensures a concurrent upload can't
            # see the bumped (position+1000000) rows and pick a giant position
            # for itself.
            await conn.execute(
                "SELECT pg_advisory_xact_lock(hashtextextended($1::text, 0))",
                str(collage_id),
            )
            owned = await conn.fetchval(
                """
                SELECT COUNT(*) FROM photos
                WHERE collage_id = $1 AND id = ANY($2::uuid[])
                """,
                collage_id, ids,
            )
            if owned != len(ids):
                raise HTTPException(400, "Some photo_ids do not belong to this collage")

            # Reject if new alive photos appeared since the client read the list.
            # Without this, a concurrent upload during reorder leaves the new
            # photo stranded at a bumped position.
            alive = await conn.fetchval(
                """
                SELECT COUNT(*) FROM photos
                WHERE collage_id = $1 AND state <> 'deleted'
                """,
                collage_id,
            )
            if alive != len(ids):
                raise HTTPException(
                    409,
                    f"Stale reorder: collage has {alive} active photos but request lists {len(ids)}. "
                    f"Reload and try again.",
                )

            # Two-step shuffle: bump only the photos that participate in the
            # reorder (state<>'deleted'). Avoids both the CHECK (position > 0)
            # and the partial UNIQUE during swaps. Soft-deleted rows are
            # outside the partial index and don't need bumping.
            await conn.execute(
                """
                UPDATE photos SET position = position + 1000000
                WHERE collage_id = $1 AND state <> 'deleted'
                """,
                collage_id,
            )
            await conn.executemany(
                "UPDATE photos SET position = $2 WHERE id = $1",
                list(zip(ids, positions)),
            )

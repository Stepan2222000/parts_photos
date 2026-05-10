from __future__ import annotations

import json
from typing import Annotated
from uuid import UUID, uuid4

from fastapi import APIRouter, File, Form, HTTPException, UploadFile

from studio_core.options import OptionKey, coerce_options

from ..config import settings
from ..db import pool
from ..images import InvalidImage, _open_pil_from_bytes, ensure_codex_compatible
from ..minio_client import public_url
from ..models import Photo
from ..studio.schemas import (
    BulkTransferRequest,
    StudioAsset,
    StudioBatch,
    StudioBatchDetail,
    StudioJob,
    SuggestedTransfer,
    TransferRequest,
)
from ..studio.storage import (
    fetch_to,  # noqa: F401  — re-exported for the worker
    move_studio_to_photos,
    put_bytes,
    studio_url,
)

router = APIRouter(prefix="/studio", tags=["studio"])


def _decode_for_codex(
    raw: bytes, source_mime: str, filename: str, *, prefer_png: bool
) -> tuple[bytes, str, str, int, int]:
    """raw → (data, mime, ext, w, h), HTTP-400 on decode failure."""
    try:
        data, mime, ext = ensure_codex_compatible(
            raw, source_mime, prefer_png=prefer_png
        )
        with _open_pil_from_bytes(data) as img:
            w, h = img.size
    except InvalidImage as e:
        raise HTTPException(400, f"{filename}: {e}")
    return data, mime, ext, w, h


def _row_to_asset(r: dict) -> StudioAsset:
    return StudioAsset(
        id=r["id"],
        name=r["name"],
        s3_key=r["s3_key"],
        url=studio_url(r["s3_key"]),
        width=r["width"],
        height=r["height"],
        size_bytes=r["size_bytes"],
        uploaded_at=r["uploaded_at"],
    )


def _row_to_batch(r: dict) -> StudioBatch:
    options_json = r["options_json"]
    if isinstance(options_json, str):
        options_json = json.loads(options_json)
    return StudioBatch(
        id=r["id"],
        name=r["name"],
        options_json=options_json or {},
        custom_prompt=r["custom_prompt"],
        background_id=r["background_id"],
        watermark_id=r["watermark_id"],
        target_collage_id=r["target_collage_id"],
        status=r["status"],
        total=r["total"],
        done=r["done"],
        failed=r["failed"],
        created_at=r["created_at"],
        finished_at=r["finished_at"],
    )


def _row_to_job(r: dict, transferred_photo_s3_key: str | None = None) -> StudioJob:
    sj = r["suggested_collages_json"]
    if isinstance(sj, str):
        sj = json.loads(sj)
    suggested = [SuggestedTransfer(**s) for s in (sj or [])]

    if r["source_kind"] == "collage_photo":
        src_url = public_url(r["source_s3_key"])
    else:
        src_url = studio_url(r["source_s3_key"])

    # After transfer, the file lives in the photos bucket; build URL from the
    # linked photo. Otherwise from studio bucket while result still exists.
    if r["transferred_to_photo_id"] and transferred_photo_s3_key:
        result_url = public_url(transferred_photo_s3_key)
    elif r["result_s3_key"]:
        result_url = studio_url(r["result_s3_key"])
    else:
        result_url = None

    return StudioJob(
        id=r["id"],
        batch_id=r["batch_id"],
        source_kind=r["source_kind"],
        source_filename=r["source_filename"],
        source_s3_key=r["source_s3_key"],
        source_url=src_url,
        source_photo_id=r["source_photo_id"],
        status=r["status"],
        result_s3_key=r["result_s3_key"],
        result_url=result_url,
        log_tail=r.get("log_tail"),
        error=r["error"],
        tokens_used=r["tokens_used"],
        elapsed_seconds=r["elapsed_seconds"],
        started_at=r["started_at"],
        finished_at=r["finished_at"],
        transferred_to_photo_id=r["transferred_to_photo_id"],
        suggested=suggested,
        created_at=r["created_at"],
    )


# ---------------------------------------------------------------------------
# Backgrounds & Watermarks (shared shape, two endpoints each)
# ---------------------------------------------------------------------------


@router.get("/backgrounds", response_model=list[StudioAsset])
async def list_backgrounds() -> list[StudioAsset]:
    rows = await pool().fetch(
        "SELECT id, name, s3_key, width, height, size_bytes, uploaded_at "
        "FROM studio_backgrounds WHERE deleted_at IS NULL ORDER BY uploaded_at DESC"
    )
    return [_row_to_asset(dict(r), ASSET_KIND_BG) for r in rows]


@router.post("/backgrounds", response_model=StudioAsset, status_code=201)
async def upload_background(file: UploadFile) -> StudioAsset:
    return await _upload_asset(file, table="studio_backgrounds", prefix="backgrounds")


@router.delete("/backgrounds/{asset_id}", status_code=204)
async def delete_background(asset_id: UUID) -> None:
    await _soft_delete_asset(asset_id, table="studio_backgrounds")


@router.get("/watermarks", response_model=list[StudioAsset])
async def list_watermarks() -> list[StudioAsset]:
    rows = await pool().fetch(
        "SELECT id, name, s3_key, width, height, size_bytes, uploaded_at "
        "FROM studio_watermarks WHERE deleted_at IS NULL ORDER BY uploaded_at DESC"
    )
    return [_row_to_asset(dict(r), ASSET_KIND_WM) for r in rows]


@router.post("/watermarks", response_model=StudioAsset, status_code=201)
async def upload_watermark(file: UploadFile) -> StudioAsset:
    return await _upload_asset(file, table="studio_watermarks", prefix="watermarks")


@router.delete("/watermarks/{asset_id}", status_code=204)
async def delete_watermark(asset_id: UUID) -> None:
    await _soft_delete_asset(asset_id, table="studio_watermarks")


async def _upload_asset(file: UploadFile, *, table: str, prefix: str) -> StudioAsset:
    raw = await file.read()
    if not raw:
        raise HTTPException(400, "Empty file")
    if len(raw) > settings.studio_max_source_bytes:
        raise HTTPException(
            400,
            f"File too large: {len(raw)} bytes, max {settings.studio_max_source_bytes}",
        )
    # Watermarks keep alpha → PNG. Backgrounds are full-frame textures → JPEG.
    data, content_type, ext, w, h = _decode_for_codex(
        raw, file.content_type or "", file.filename or "asset",
        prefer_png=prefix == "watermarks",
    )
    asset_id = uuid4()
    s3_key = f"{prefix}/{asset_id}.{ext}"
    put_bytes(s3_key, data, content_type)
    row = await pool().fetchrow(
        f"""
        INSERT INTO {table} (id, name, s3_key, width, height, size_bytes)
        VALUES ($1, $2, $3, $4, $5, $6)
        RETURNING id, name, s3_key, width, height, size_bytes, uploaded_at
        """,
        asset_id,
        file.filename or "asset",
        s3_key,
        w,
        h,
        len(data),
    )
    return _row_to_asset(dict(row))


async def _soft_delete_asset(asset_id: UUID, *, table: str) -> None:
    res = await pool().execute(
        f"UPDATE {table} SET deleted_at = now() WHERE id = $1 AND deleted_at IS NULL",
        asset_id,
    )
    if res.endswith(" 0"):
        raise HTTPException(404, "Asset not found")


# ---------------------------------------------------------------------------
# Batches
# ---------------------------------------------------------------------------


@router.post("/batches", response_model=StudioBatch, status_code=201)
async def create_batch(
    options: Annotated[str, Form()],
    name: Annotated[str | None, Form()] = None,
    custom_prompt: Annotated[str | None, Form()] = None,
    background_id: Annotated[UUID | None, Form()] = None,
    watermark_id: Annotated[UUID | None, Form()] = None,
    target_collage_id: Annotated[UUID | None, Form()] = None,
    source_photo_ids: Annotated[str | None, Form()] = None,
    files: Annotated[list[UploadFile] | None, File()] = None,
) -> StudioBatch:
    """Create a new batch.

    `options` is a JSON object whose keys are OptionKey values and values are
    booleans. `source_photo_ids` is a comma-separated list of UUIDs for photos
    already in some collage. `files` is a list of fresh uploads.
    """
    try:
        opts_raw = json.loads(options)
        if not isinstance(opts_raw, dict):
            raise ValueError("options must be a JSON object")
    except (json.JSONDecodeError, ValueError) as e:
        raise HTTPException(400, f"Invalid options JSON: {e}")
    options_clean = {k.value: v for k, v in coerce_options(opts_raw).items()}

    if options_clean["replace_bg"] and background_id is None:
        raise HTTPException(400, "replace_bg is on but no background_id supplied")
    if options_clean["add_watermark"] and watermark_id is None:
        raise HTTPException(400, "add_watermark is on but no watermark_id supplied")

    photo_ids: list[UUID] = []
    if source_photo_ids:
        for raw_id in source_photo_ids.split(","):
            raw_id = raw_id.strip()
            if not raw_id:
                continue
            try:
                photo_ids.append(UUID(raw_id))
            except ValueError:
                raise HTTPException(400, f"Invalid photo UUID: {raw_id}")

    file_list = [f for f in (files or []) if f and f.filename]
    if not photo_ids and not file_list:
        raise HTTPException(400, "Batch needs at least one source (file or collage photo)")

    upload_payloads: list[tuple[str, str, str, bytes]] = []  # (filename, mime, ext, bytes)
    for f in file_list:
        raw = await f.read()
        if not raw:
            raise HTTPException(400, f"Empty file: {f.filename}")
        if len(raw) > settings.studio_max_source_bytes:
            raise HTTPException(
                400,
                f"{f.filename}: {len(raw)} bytes exceeds max "
                f"{settings.studio_max_source_bytes} (gpt-image-2 limit)",
            )
        data, mime, ext, _w, _h = _decode_for_codex(
            raw, f.content_type or "", f.filename, prefer_png=False
        )
        upload_payloads.append((f.filename, mime, ext, data))

    # validate referenced assets / collage exist
    async with pool().acquire() as conn:
        async with conn.transaction():
            if background_id is not None:
                ok = await conn.fetchval(
                    "SELECT 1 FROM studio_backgrounds WHERE id = $1 AND deleted_at IS NULL",
                    background_id,
                )
                if not ok:
                    raise HTTPException(404, "Background not found")
            if watermark_id is not None:
                ok = await conn.fetchval(
                    "SELECT 1 FROM studio_watermarks WHERE id = $1 AND deleted_at IS NULL",
                    watermark_id,
                )
                if not ok:
                    raise HTTPException(404, "Watermark not found")
            if target_collage_id is not None:
                ok = await conn.fetchval(
                    "SELECT 1 FROM photo_collages WHERE id = $1", target_collage_id
                )
                if not ok:
                    raise HTTPException(404, "Target collage not found")

            # Validate all referenced collage photos
            collage_photos: list[tuple[UUID, str, str | None]] = []  # (id, s3_key, filename)
            if photo_ids:
                rows = await conn.fetch(
                    """
                    SELECT id, s3_key
                    FROM photos
                    WHERE id = ANY($1::uuid[]) AND state = 'uploaded'
                    """,
                    photo_ids,
                )
                if len(rows) != len(photo_ids):
                    found = {r["id"] for r in rows}
                    missing = [str(i) for i in photo_ids if i not in found]
                    raise HTTPException(
                        404,
                        f"Photos not found or not uploaded: {', '.join(missing)}",
                    )
                for r in rows:
                    collage_photos.append((r["id"], r["s3_key"], None))

            # Insert batch
            batch_id = uuid4()
            total = len(upload_payloads) + len(collage_photos)
            batch_row = await conn.fetchrow(
                """
                INSERT INTO studio_batches
                  (id, name, options_json, custom_prompt, background_id,
                   watermark_id, target_collage_id, status, total)
                VALUES ($1, $2, $3, $4, $5, $6, $7, 'queued', $8)
                RETURNING id, name, options_json, custom_prompt, background_id,
                          watermark_id, target_collage_id, status, total, done,
                          failed, created_at, finished_at
                """,
                batch_id,
                name,
                json.dumps(options_clean),
                custom_prompt,
                background_id,
                watermark_id,
                target_collage_id,
                total,
            )

            # Upload + insert jobs for fresh files
            for filename, mime, ext, data in upload_payloads:
                job_id = uuid4()
                # ext from ensure_codex_compatible(): always one of jpg/png/webp,
                # never the original heic/etc.
                src_key = f"uploads/{batch_id}/{job_id}.{ext}"
                # synchronous put — we are already inside a TX but MinIO call
                # is independent of the DB transaction
                put_bytes(src_key, data, mime)
                await conn.execute(
                    """
                    INSERT INTO studio_jobs
                      (id, batch_id, source_kind, source_filename, source_s3_key)
                    VALUES ($1, $2, 'upload', $3, $4)
                    """,
                    job_id,
                    batch_id,
                    filename,
                    src_key,
                )

            # Insert jobs for collage-photo sources (no MinIO upload — we
            # reference the photos.s3_key directly from the photos bucket)
            for photo_id, s3_key, fname in collage_photos:
                await conn.execute(
                    """
                    INSERT INTO studio_jobs
                      (id, batch_id, source_kind, source_filename,
                       source_s3_key, source_photo_id)
                    VALUES ($1, $2, 'collage_photo', $3, $4, $5)
                    """,
                    uuid4(),
                    batch_id,
                    fname,
                    s3_key,
                    photo_id,
                )

    return _row_to_batch(dict(batch_row))


@router.get("/batches", response_model=list[StudioBatch])
async def list_batches(limit: int = 50, offset: int = 0) -> list[StudioBatch]:
    rows = await pool().fetch(
        """
        SELECT id, name, options_json, custom_prompt, background_id, watermark_id,
               target_collage_id, status, total, done, failed, created_at, finished_at
        FROM studio_batches
        ORDER BY created_at DESC
        LIMIT $1 OFFSET $2
        """,
        max(1, min(limit, 200)),
        max(0, offset),
    )
    return [_row_to_batch(dict(r)) for r in rows]


@router.get("/batches/{batch_id}", response_model=StudioBatchDetail)
async def get_batch(batch_id: UUID) -> StudioBatchDetail:
    async with pool().acquire() as conn:
        head = await conn.fetchrow(
            """
            SELECT id, name, options_json, custom_prompt, background_id, watermark_id,
                   target_collage_id, status, total, done, failed, created_at, finished_at
            FROM studio_batches WHERE id = $1
            """,
            batch_id,
        )
        if head is None:
            raise HTTPException(404, "Batch not found")
        # log_tail is intentionally omitted: it can be ~8KB per job and the
        # batch detail is polled every 2s by the UI. Use GET /jobs/{id} when
        # the user opens the per-job drawer to see logs.
        job_rows = await conn.fetch(
            """
            SELECT j.id, j.batch_id, j.source_kind, j.source_filename, j.source_s3_key,
                   j.source_photo_id, j.status, j.result_s3_key, j.error,
                   j.tokens_used, j.elapsed_seconds, j.started_at, j.finished_at,
                   j.transferred_to_photo_id, j.suggested_collages_json, j.created_at,
                   p.s3_key AS transferred_photo_s3_key
            FROM studio_jobs j
            LEFT JOIN photos p ON p.id = j.transferred_to_photo_id
            WHERE j.batch_id = $1
            ORDER BY j.created_at ASC
            """,
            batch_id,
        )
        base = _row_to_batch(dict(head))
        jobs: list[StudioJob] = []
        for r in job_rows:
            d = dict(r)
            transferred_key = d.pop("transferred_photo_s3_key", None)
            jobs.append(_row_to_job(d, transferred_key))
        return StudioBatchDetail(**base.model_dump(), jobs=jobs)


@router.delete("/batches/{batch_id}", status_code=204)
async def delete_batch(batch_id: UUID) -> None:
    """Delete a batch. Transferred photos in collages are kept (FK SET NULL)
    via the ON DELETE behaviour on studio_jobs → photos.studio_job_id.
    """
    res = await pool().execute("DELETE FROM studio_batches WHERE id = $1", batch_id)
    if res.endswith(" 0"):
        raise HTTPException(404, "Batch not found")


# ---------------------------------------------------------------------------
# Job-level transfer
# ---------------------------------------------------------------------------


@router.get("/jobs/{job_id}", response_model=StudioJob)
async def get_job(job_id: UUID) -> StudioJob:
    async with pool().acquire() as conn:
        row = await conn.fetchrow(
            """
            SELECT j.id, j.batch_id, j.source_kind, j.source_filename, j.source_s3_key,
                   j.source_photo_id, j.status, j.result_s3_key, j.log_tail, j.error,
                   j.tokens_used, j.elapsed_seconds, j.started_at, j.finished_at,
                   j.transferred_to_photo_id, j.suggested_collages_json, j.created_at,
                   p.s3_key AS transferred_photo_s3_key
            FROM studio_jobs j
            LEFT JOIN photos p ON p.id = j.transferred_to_photo_id
            WHERE j.id = $1
            """,
            job_id,
        )
        if row is None:
            raise HTTPException(404, "Job not found")
        d = dict(row)
        transferred_key = d.pop("transferred_photo_s3_key", None)
        return _row_to_job(d, transferred_key)


@router.post("/jobs/{job_id}/transfer", response_model=Photo, status_code=201)
async def transfer_job(job_id: UUID, body: TransferRequest) -> Photo:
    """Append the job result as a new photo in the target collage.

    The resulting photo references the same MinIO object key (no copy).
    """
    return await _do_transfer(job_id, body.collage_id)


@router.post("/batches/{batch_id}/transfer-suggested", response_model=list[Photo])
async def transfer_suggested(batch_id: UUID, body: BulkTransferRequest) -> list[Photo]:
    job_ids = [e.job_id for e in body.transfers]
    valid_rows = await pool().fetch(
        "SELECT id FROM studio_jobs WHERE batch_id = $1 AND id = ANY($2::uuid[])",
        batch_id,
        job_ids,
    )
    valid_ids = {r["id"] for r in valid_rows}
    missing = [str(j) for j in job_ids if j not in valid_ids]
    if missing:
        raise HTTPException(404, f"Jobs not in batch {batch_id}: {', '.join(missing)}")
    return [await _do_transfer(e.job_id, e.collage_id) for e in body.transfers]


async def _do_transfer(job_id: UUID, collage_id: UUID) -> Photo:
    async with pool().acquire() as conn:
        async with conn.transaction():
            await conn.execute(
                "SELECT pg_advisory_xact_lock(hashtextextended($1::text, 0))",
                str(collage_id),
            )
            job = await conn.fetchrow(
                """
                SELECT id, status, result_s3_key, result_size_bytes,
                       transferred_to_photo_id
                FROM studio_jobs WHERE id = $1
                """,
                job_id,
            )
            if job is None:
                raise HTTPException(404, "Job not found")
            # Check transferred BEFORE result_s3_key — after transfer
            # result_s3_key is NULL, which would mask the real reason.
            if job["transferred_to_photo_id"] is not None:
                raise HTTPException(409, "Job already transferred")
            if job["status"] != "succeeded":
                raise HTTPException(400, f"Job not succeeded ({job['status']})")
            if job["result_s3_key"] is None:
                raise HTTPException(400, "Job has no result image")

            collage = await conn.fetchrow(
                "SELECT id, group_id FROM photo_collages WHERE id = $1", collage_id
            )
            if collage is None:
                raise HTTPException(404, "Collage not found")

            photo_id = uuid4()
            new_key = (
                f"groups/{collage['group_id']}/collages/{collage_id}/{photo_id}.png"
            )
            try:
                move_studio_to_photos(job["result_s3_key"], new_key)
            except Exception as e:
                raise HTTPException(500, f"Failed to move object: {e}") from e

            row = await conn.fetchrow(
                """
                INSERT INTO photos
                  (id, collage_id, position, s3_key, mime, size_bytes, state,
                   uploaded_at, source, studio_job_id)
                VALUES (
                    $1, $2,
                    COALESCE((SELECT MAX(position) + 1 FROM photos
                              WHERE collage_id = $2 AND state <> 'deleted'), 1),
                    $3, 'image/png', $4, 'uploaded', now(), 'studio', $5
                )
                RETURNING id, collage_id, position, s3_key, mime, size_bytes,
                          state, uploaded_at, created_at
                """,
                photo_id,
                collage_id,
                new_key,
                job["result_size_bytes"] or 0,
                job_id,
            )
            await conn.execute(
                """
                UPDATE studio_jobs
                   SET transferred_to_photo_id = $1,
                       result_s3_key = NULL
                 WHERE id = $2
                """,
                photo_id,
                job_id,
            )
    photo_dict = dict(row)
    photo_dict["url"] = public_url(photo_dict["s3_key"])
    return Photo(**photo_dict)

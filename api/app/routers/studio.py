from __future__ import annotations

import json
from typing import Annotated
from uuid import UUID, uuid4

from fastapi import APIRouter, File, Form, HTTPException, Query, UploadFile

from studio_core.options import OptionKey, coerce_options

from ..config import settings
from ..db import pool
from ..images import InvalidImage, _open_pil_from_bytes, ensure_codex_compatible
from ..minio_client import public_url
from ..models import Photo
from ..studio import groups as gconfig
from ..studio.article_match_db import (
    items_for_part,
    smart_collage_for_part,
)
from ..studio.schemas import (
    GroupSuggestion,
    JobSuggestions,
    LookupItem,
    LookupSmart,
    StudioAsset,
    StudioBatch,
    StudioBatchDetail,
    StudioJob,
    SuggestedItem,
    TargetGroup,
    TransferRequest,
    TransferRules,
)
from ..studio.storage import (
    delete_photos_prefix,
    delete_studio_prefix,
    fetch_to,  # noqa: F401  — re-exported for the worker
    move_studio_to_photos,
    put_bytes,
    studio_url,
)

router = APIRouter(prefix="/studio", tags=["studio"])


# ---------------------------------------------------------------------------
# Decoders / row mappers
# ---------------------------------------------------------------------------


def _decode_for_codex(
    raw: bytes, source_mime: str, filename: str, *, prefer_png: bool
) -> tuple[bytes, str, str, int, int]:
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
        id=r["id"], name=r["name"], s3_key=r["s3_key"],
        url=studio_url(r["s3_key"]),
        width=r["width"], height=r["height"],
        size_bytes=r["size_bytes"], uploaded_at=r["uploaded_at"],
    )


def _row_to_batch(r: dict) -> StudioBatch:
    options_json = r["options_json"]
    if isinstance(options_json, str):
        options_json = json.loads(options_json)
    return StudioBatch(
        id=r["id"], name=r["name"],
        options_json=options_json or {},
        custom_prompt=r["custom_prompt"],
        background_id=r["background_id"], watermark_id=r["watermark_id"],
        status=r["status"], total=r["total"], done=r["done"], failed=r["failed"],
        created_at=r["created_at"], finished_at=r["finished_at"],
    )


def _parse_suggestions(raw) -> JobSuggestions | None:
    if raw is None:
        return None
    if isinstance(raw, str):
        raw = json.loads(raw)
    if not isinstance(raw, dict) or not raw.get("smart_part_id"):
        return None
    by_group = {}
    for gid, slot in (raw.get("by_group") or {}).items():
        if not isinstance(slot, dict):
            continue
        kind = slot.get("kind")
        if kind == "smart_part":
            by_group[gid] = GroupSuggestion(
                kind="smart_part",
                existing_collage_id=slot.get("existing_collage_id"),
            )
        elif kind == "instance":
            by_group[gid] = GroupSuggestion(
                kind="instance",
                items=[SuggestedItem(**it) for it in (slot.get("items") or [])],
            )
    return JobSuggestions(
        smart_part_id=raw["smart_part_id"],
        smart_part_name=raw.get("smart_part_name"),
        matched_article=raw.get("matched_article", ""),
        source_kind=raw.get("source_kind", "filename"),
        by_group=by_group,
    )


def _row_to_job(
    r: dict,
    transferred_photo_s3_key: str | None = None,
) -> StudioJob:
    suggestions = _parse_suggestions(r["suggested_collages_json"])

    if r["source_kind"] == "collage_photo":
        src_url = public_url(r["source_s3_key"])
    else:
        src_url = studio_url(r["source_s3_key"])

    if r["transferred_to_photo_id"] and transferred_photo_s3_key:
        result_url = public_url(transferred_photo_s3_key)
    elif r["result_s3_key"]:
        result_url = studio_url(r["result_s3_key"])
    else:
        result_url = None

    return StudioJob(
        id=r["id"], batch_id=r["batch_id"],
        source_kind=r["source_kind"], source_filename=r["source_filename"],
        source_s3_key=r["source_s3_key"], source_url=src_url,
        source_photo_id=r["source_photo_id"],
        source_group_id=r.get("source_group_id"),
        status=r["status"],
        result_s3_key=r["result_s3_key"], result_url=result_url,
        log_tail=r.get("log_tail"), error=r["error"],
        tokens_used=r["tokens_used"], elapsed_seconds=r["elapsed_seconds"],
        started_at=r["started_at"], finished_at=r["finished_at"],
        transferred_to_photo_id=r["transferred_to_photo_id"],
        transferred_to_group_id=r.get("transferred_to_group_id"),
        suggestions=suggestions,
        created_at=r["created_at"],
    )


# ---------------------------------------------------------------------------
# Target groups + transfer rules (config exposed to FE)
# ---------------------------------------------------------------------------


@router.get("/target-groups", response_model=list[TargetGroup])
async def list_target_groups() -> list[TargetGroup]:
    target_ids = gconfig.studio_targets()
    if not target_ids:
        return []
    rows = await pool().fetch(
        """
        SELECT id, name, position FROM photo_groups
        WHERE id = ANY($1::uuid[]) ORDER BY position ASC
        """,
        target_ids,
    )
    out = []
    for r in rows:
        cfg = gconfig.get(r["id"])
        if cfg is None:
            continue
        out.append(TargetGroup(
            id=r["id"], name=r["name"],
            owner_kind=cfg.owner_kind,
            defect_filter=cfg.defect_filter,
            accepts_defects=cfg.accepts_defects,
        ))
    return out


@router.get("/transfer-rules", response_model=TransferRules)
async def transfer_rules() -> TransferRules:
    return TransferRules(**gconfig.transfer_rules_json())


# ---------------------------------------------------------------------------
# Backgrounds / Watermarks
# ---------------------------------------------------------------------------


@router.get("/backgrounds", response_model=list[StudioAsset])
async def list_backgrounds() -> list[StudioAsset]:
    rows = await pool().fetch(
        "SELECT id, name, s3_key, width, height, size_bytes, uploaded_at "
        "FROM studio_backgrounds WHERE deleted_at IS NULL ORDER BY uploaded_at DESC"
    )
    return [_row_to_asset(dict(r)) for r in rows]


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
    return [_row_to_asset(dict(r)) for r in rows]


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
        asset_id, file.filename or "asset", s3_key, w, h, len(data),
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
    source_photo_ids: Annotated[str | None, Form()] = None,
    files: Annotated[list[UploadFile] | None, File()] = None,
) -> StudioBatch:
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

    upload_payloads: list[tuple[str, str, str, bytes]] = []
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

            collage_photos: list[tuple[UUID, str, str | None]] = []
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

            batch_id = uuid4()
            total = len(upload_payloads) + len(collage_photos)
            batch_row = await conn.fetchrow(
                """
                INSERT INTO studio_batches
                  (id, name, options_json, custom_prompt, background_id,
                   watermark_id, status, total)
                VALUES ($1, $2, $3, $4, $5, $6, 'queued', $7)
                RETURNING id, name, options_json, custom_prompt, background_id,
                          watermark_id, status, total, done, failed, created_at,
                          finished_at
                """,
                batch_id, name, json.dumps(options_clean), custom_prompt,
                background_id, watermark_id, total,
            )

            for filename, mime, ext, data in upload_payloads:
                job_id = uuid4()
                src_key = f"uploads/{batch_id}/{job_id}.{ext}"
                put_bytes(src_key, data, mime)
                await conn.execute(
                    """
                    INSERT INTO studio_jobs
                      (id, batch_id, source_kind, source_filename, source_s3_key)
                    VALUES ($1, $2, 'upload', $3, $4)
                    """,
                    job_id, batch_id, filename, src_key,
                )

            for photo_id, s3_key, fname in collage_photos:
                await conn.execute(
                    """
                    INSERT INTO studio_jobs
                      (id, batch_id, source_kind, source_filename,
                       source_s3_key, source_photo_id)
                    VALUES ($1, $2, 'collage_photo', $3, $4, $5)
                    """,
                    uuid4(), batch_id, fname, s3_key, photo_id,
                )

    return _row_to_batch(dict(batch_row))


@router.get("/batches", response_model=list[StudioBatch])
async def list_batches(limit: int = 50, offset: int = 0) -> list[StudioBatch]:
    rows = await pool().fetch(
        """
        SELECT id, name, options_json, custom_prompt, background_id, watermark_id,
               status, total, done, failed, created_at, finished_at
        FROM studio_batches
        ORDER BY created_at DESC
        LIMIT $1 OFFSET $2
        """,
        max(1, min(limit, 200)), max(0, offset),
    )
    return [_row_to_batch(dict(r)) for r in rows]


# Joins for source_group_id (the group the source photo lives in) and
# transferred_to_group_id (the group it landed in after transfer).
_JOB_SELECT = """
SELECT j.id, j.batch_id, j.source_kind, j.source_filename, j.source_s3_key,
       j.source_photo_id, j.status, j.result_s3_key, j.error,
       j.tokens_used, j.elapsed_seconds, j.started_at, j.finished_at,
       j.transferred_to_photo_id, j.suggested_collages_json, j.created_at,
       sp.collage_id AS source_collage_id,
       sc.group_id AS source_group_id,
       tp.s3_key AS transferred_photo_s3_key,
       tc.group_id AS transferred_to_group_id
FROM studio_jobs j
LEFT JOIN photos sp ON sp.id = j.source_photo_id
LEFT JOIN photo_collages sc ON sc.id = sp.collage_id
LEFT JOIN photos tp ON tp.id = j.transferred_to_photo_id
LEFT JOIN photo_collages tc ON tc.id = tp.collage_id
"""


@router.get("/batches/{batch_id}", response_model=StudioBatchDetail)
async def get_batch(batch_id: UUID) -> StudioBatchDetail:
    async with pool().acquire() as conn:
        head = await conn.fetchrow(
            """
            SELECT id, name, options_json, custom_prompt, background_id, watermark_id,
                   status, total, done, failed, created_at, finished_at
            FROM studio_batches WHERE id = $1
            """,
            batch_id,
        )
        if head is None:
            raise HTTPException(404, "Batch not found")
        job_rows = await conn.fetch(
            _JOB_SELECT + "WHERE j.batch_id = $1 ORDER BY j.created_at ASC",
            batch_id,
        )
        base = _row_to_batch(dict(head))
        jobs: list[StudioJob] = []
        for r in job_rows:
            d = dict(r)
            transferred_key = d.pop("transferred_photo_s3_key", None)
            d.pop("source_collage_id", None)
            jobs.append(_row_to_job(d, transferred_key))
        return StudioBatchDetail(**base.model_dump(), jobs=jobs)


@router.delete("/batches/{batch_id}", status_code=204)
async def delete_batch(batch_id: UUID) -> None:
    """Delete a batch + cascade jobs + nuke its files in the studio bucket.

    `uploads/{batch}/*` is always orphaned by the time we reach here (sources
    aren't moved on transfer). `results/{batch}/*` only contains files whose
    jobs were not transferred — `move_studio_to_photos` already removed the
    transferred ones during the transfer step.
    """
    res = await pool().execute("DELETE FROM studio_batches WHERE id = $1", batch_id)
    if res.endswith(" 0"):
        raise HTTPException(404, "Batch not found")
    delete_studio_prefix(f"uploads/{batch_id}/")
    delete_studio_prefix(f"results/{batch_id}/")


@router.get("/jobs/{job_id}", response_model=StudioJob)
async def get_job(job_id: UUID) -> StudioJob:
    async with pool().acquire() as conn:
        row = await conn.fetchrow(
            _JOB_SELECT.replace(
                "j.suggested_collages_json,",
                "j.suggested_collages_json, j.log_tail,",
            ) + "WHERE j.id = $1",
            job_id,
        )
        if row is None:
            raise HTTPException(404, "Job not found")
        d = dict(row)
        transferred_key = d.pop("transferred_photo_s3_key", None)
        d.pop("source_collage_id", None)
        return _row_to_job(d, transferred_key)


# ---------------------------------------------------------------------------
# Transfer + lookup
# ---------------------------------------------------------------------------


@router.post("/batches/{batch_id}/transfers", response_model=list[Photo])
async def transfer_batch(batch_id: UUID, body: TransferRequest) -> list[Photo]:
    job_ids = [e.job_id for e in body.transfers]
    valid_rows = await pool().fetch(
        "SELECT id FROM studio_jobs WHERE batch_id = $1 AND id = ANY($2::uuid[])",
        batch_id, job_ids,
    )
    valid_ids = {r["id"] for r in valid_rows}
    missing = [str(j) for j in job_ids if j not in valid_ids]
    if missing:
        raise HTTPException(404, f"Jobs not in batch {batch_id}: {', '.join(missing)}")

    out: list[Photo] = []
    for e in body.transfers:
        out.append(await _do_transfer(e.job_id, e.group_id, e.item_id))
    return out


@router.get("/lookup/items", response_model=list[LookupItem])
async def lookup_items(
    smart_part_id: str = Query(min_length=1),
    group_id: UUID = Query(...),
) -> list[LookupItem]:
    """Manual lookup for instance targets: list items of `smart_part_id` that
    pass the target group's `defect_filter`."""
    cfg = gconfig.get(group_id)
    if cfg is None or cfg.studio_role != "target":
        raise HTTPException(400, "group_id is not a Studio target group")
    if cfg.owner_kind != "instance":
        raise HTTPException(400, "this group is not item-based — use /lookup/smart")
    async with pool().acquire() as conn:
        rows = await items_for_part(smart_part_id, group_id, conn)
    return [LookupItem(**r) for r in rows]


@router.get("/lookup/smart", response_model=LookupSmart)
async def lookup_smart(
    smart_part_id: str = Query(min_length=1),
    group_id: UUID = Query(...),
) -> LookupSmart:
    """Manual lookup for smart_part targets: returns just the existing-collage-id
    slot (or null if it would be created)."""
    cfg = gconfig.get(group_id)
    if cfg is None or cfg.studio_role != "target":
        raise HTTPException(400, "group_id is not a Studio target group")
    if cfg.owner_kind != "smart_part":
        raise HTTPException(400, "this group is item-based — use /lookup/items")
    # Validate smart_part exists in smart catalog.
    async with pool().acquire() as conn:
        ok = await conn.fetchval(
            "SELECT 1 FROM smart_ext.parts WHERE id = $1", smart_part_id
        )
        if not ok:
            raise HTTPException(404, f"smart_part_id '{smart_part_id}' not in smart catalog")
        existing = await smart_collage_for_part(smart_part_id, group_id, conn)
    return LookupSmart(smart_part_id=smart_part_id, existing_collage_id=existing)


# ---------------------------------------------------------------------------
# Internals
# ---------------------------------------------------------------------------


async def _do_transfer(job_id: UUID, group_id: UUID, item_id: int | None) -> Photo:
    cfg = gconfig.get(group_id)
    if cfg is None or cfg.studio_role != "target":
        raise HTTPException(400, "group_id is not a Studio target group")

    async with pool().acquire() as conn:
        # Pull the job + source-group context we need for matrix gate.
        ctx = await conn.fetchrow(
            """
            SELECT j.id, j.status, j.result_s3_key, j.result_size_bytes,
                   j.transferred_to_photo_id, j.source_kind,
                   sc.group_id AS source_group_id
            FROM studio_jobs j
            LEFT JOIN photos sp ON sp.id = j.source_photo_id
            LEFT JOIN photo_collages sc ON sc.id = sp.collage_id
            WHERE j.id = $1
            """,
            job_id,
        )
        if ctx is None:
            raise HTTPException(404, "Job not found")
        if ctx["transferred_to_photo_id"] is not None:
            raise HTTPException(409, "Job already transferred")
        if ctx["status"] != "succeeded":
            raise HTTPException(400, f"Job not succeeded ({ctx['status']})")
        if ctx["result_s3_key"] is None:
            raise HTTPException(400, "Job has no result image")

        # Matrix check — uses source_group_id (None for fresh upload).
        if not gconfig.is_transfer_allowed(ctx["source_group_id"], group_id):
            raise HTTPException(
                400,
                "Transfer forbidden by source→target rules",
            )

        # Resolve owner_id depending on the target's owner_kind.
        if cfg.owner_kind == "instance":
            if item_id is None:
                raise HTTPException(400, "item_id required for instance target")
            item = await conn.fetchrow(
                "SELECT id, defect, status, smart_part_id FROM uchet_ext.items WHERE id = $1",
                item_id,
            )
            if item is None:
                raise HTTPException(404, f"item {item_id} not found in parts_uchet")
            if item["status"] != "in_stock":
                raise HTTPException(400, f"item {item_id} status={item['status']!r}, not in_stock")
            if cfg.defect_filter == "with" and not item["defect"]:
                raise HTTPException(400, f"item {item_id} is not defective; group requires defect=true")
            if cfg.defect_filter == "without" and item["defect"]:
                raise HTTPException(400, f"item {item_id} is defective; group requires defect=false")
            owner_id = str(item_id)
        else:
            # smart_part target: derive smart_part_id from job's source or its
            # suggestion. We don't take it from the request — the matching/
            # source already pinned it.
            sp_row = await conn.fetchrow(
                """
                SELECT j.suggested_collages_json,
                       sc.owner_kind AS src_owner_kind,
                       sc.owner_id   AS src_owner_id
                FROM studio_jobs j
                LEFT JOIN photos sp ON sp.id = j.source_photo_id
                LEFT JOIN photo_collages sc ON sc.id = sp.collage_id
                WHERE j.id = $1
                """,
                job_id,
            )
            smart_part_id = await _resolve_smart_for_smart_target(conn, sp_row)
            if smart_part_id is None:
                raise HTTPException(
                    400,
                    "Cannot resolve smart_part for this job — manual flow required",
                )
            owner_id = smart_part_id

        async with conn.transaction():
            lock_key = f"{group_id}:{owner_id}"
            await conn.execute(
                "SELECT pg_advisory_xact_lock(hashtextextended($1::text, 0))",
                lock_key,
            )

            collage = await conn.fetchrow(
                """
                SELECT id, group_id FROM photo_collages
                WHERE group_id = $1 AND owner_kind = $2 AND owner_id = $3
                """,
                group_id, cfg.owner_kind, owner_id,
            )
            if collage is None:
                collage = await conn.fetchrow(
                    """
                    INSERT INTO photo_collages (group_id, owner_kind, owner_id)
                    VALUES ($1, $2, $3)
                    RETURNING id, group_id
                    """,
                    group_id, cfg.owner_kind, owner_id,
                )
            collage_id = collage["id"]

            # Re-fetch result_s3_key under the same connection (could have
            # been nulled by a concurrent transfer attempt).
            job = await conn.fetchrow(
                "SELECT result_s3_key, result_size_bytes, transferred_to_photo_id "
                "FROM studio_jobs WHERE id = $1",
                job_id,
            )
            if job["transferred_to_photo_id"] is not None:
                raise HTTPException(409, "Job already transferred")
            if job["result_s3_key"] is None:
                raise HTTPException(400, "Job has no result image")

            photo_id = uuid4()
            new_key = f"groups/{collage['group_id']}/collages/{collage_id}/{photo_id}.png"
            try:
                move_studio_to_photos(job["result_s3_key"], new_key)
            except Exception as exc:
                raise HTTPException(500, f"Failed to move object: {exc}") from exc

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
                photo_id, collage_id, new_key,
                job["result_size_bytes"] or 0, job_id,
            )
            await conn.execute(
                """
                UPDATE studio_jobs
                   SET transferred_to_photo_id = $1,
                       result_s3_key = NULL
                 WHERE id = $2
                """,
                photo_id, job_id,
            )
    photo_dict = dict(row)
    photo_dict["url"] = public_url(photo_dict["s3_key"])
    return Photo(**photo_dict)


async def _resolve_smart_for_smart_target(conn, sp_row) -> str | None:
    """Find the smart_part_id for a smart_part-target transfer.

    Priority: source collage's owner (if collage_photo source), else the
    suggestion stored on the job. Returns None if neither is available.
    """
    if sp_row is None:
        return None
    if sp_row["src_owner_kind"] == "smart_part":
        return sp_row["src_owner_id"]
    if sp_row["src_owner_kind"] == "instance":
        try:
            item_id = int(sp_row["src_owner_id"])
        except ValueError:
            return None
        item = await conn.fetchrow(
            "SELECT smart_part_id FROM uchet_ext.items WHERE id = $1",
            item_id,
        )
        if item:
            return item["smart_part_id"]
    sug = sp_row["suggested_collages_json"]
    if isinstance(sug, str):
        sug = json.loads(sug)
    if isinstance(sug, dict):
        return sug.get("smart_part_id")
    return None

"""Watermark settings + on-the-fly photo compositing.

Settings model (migration_010):
  - `watermark_config` (single row) — which `studio_watermarks` asset is the
    active mark for the whole app;
  - `photo_groups.watermark_enabled` — per-channel toggle, meaningful for the
    Studio target channels (Эталонные / На публикацию / Avito 2-й аккаунт).

Serving: GET /photos/{id}/wm downloads the clean object from MinIO,
composites the active mark (see app.watermark) and returns a JPEG. If the
photo's channel toggle is off (stale URL) it redirects to the clean S3 URL —
nothing breaks when a flag is flipped.
"""
from __future__ import annotations

import asyncio
import io
from uuid import UUID

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import RedirectResponse, Response
from pydantic import BaseModel

from ..db import pool
from ..minio_client import client as minio, public_url
from ..studio import groups as gconfig
from ..studio.schemas import StudioAsset
from ..studio.storage import studio_bucket
from ..config import settings
from .. import watermark as wm
from .studio import _row_to_asset

router = APIRouter(tags=["watermark"])


# ---------------------------------------------------------------------------
# Config models
# ---------------------------------------------------------------------------


class WatermarkGroupState(BaseModel):
    id: UUID
    name: str
    enabled: bool


class WatermarkConfig(BaseModel):
    watermark: StudioAsset | None
    groups: list[WatermarkGroupState]


class WatermarkConfigUpdate(BaseModel):
    watermark_id: UUID | None


class WatermarkGroupUpdate(BaseModel):
    enabled: bool


# ---------------------------------------------------------------------------
# Config endpoints
# ---------------------------------------------------------------------------


async def _active_asset(conn) -> dict | None:
    return await conn.fetchrow(
        """
        SELECT w.id, w.name, w.s3_key, w.width, w.height, w.size_bytes, w.uploaded_at
        FROM watermark_config c
        JOIN studio_watermarks w ON w.id = c.watermark_id AND w.deleted_at IS NULL
        WHERE c.id = 1
        """
    )


@router.get("/watermark/config", response_model=WatermarkConfig)
async def get_config() -> WatermarkConfig:
    target_ids = gconfig.studio_targets()
    async with pool().acquire() as conn:
        asset = await _active_asset(conn)
        rows = await conn.fetch(
            """
            SELECT id, name, watermark_enabled FROM photo_groups
            WHERE id = ANY($1::uuid[]) ORDER BY position ASC
            """,
            target_ids,
        )
    return WatermarkConfig(
        watermark=_row_to_asset(dict(asset)) if asset else None,
        groups=[
            WatermarkGroupState(
                id=r["id"], name=r["name"], enabled=r["watermark_enabled"]
            )
            for r in rows
        ],
    )


@router.put("/watermark/config", response_model=WatermarkConfig)
async def set_config(body: WatermarkConfigUpdate) -> WatermarkConfig:
    async with pool().acquire() as conn:
        if body.watermark_id is not None:
            ok = await conn.fetchval(
                "SELECT 1 FROM studio_watermarks WHERE id = $1 AND deleted_at IS NULL",
                body.watermark_id,
            )
            if not ok:
                raise HTTPException(404, "Watermark asset not found")
        await conn.execute(
            "UPDATE watermark_config SET watermark_id = $1, updated_at = now() WHERE id = 1",
            body.watermark_id,
        )
    return await get_config()


@router.put("/watermark/groups/{group_id}", response_model=WatermarkGroupState)
async def toggle_group(group_id: UUID, body: WatermarkGroupUpdate) -> WatermarkGroupState:
    cfg = gconfig.get(group_id)
    if cfg is None or cfg.studio_role != "target":
        raise HTTPException(422, "watermark toggle is only for publication channels")
    row = await pool().fetchrow(
        """
        UPDATE photo_groups SET watermark_enabled = $2, updated_at = now()
        WHERE id = $1
        RETURNING id, name, watermark_enabled
        """,
        group_id, body.enabled,
    )
    if row is None:
        raise HTTPException(404, "Group not found")
    return WatermarkGroupState(id=row["id"], name=row["name"], enabled=row["watermark_enabled"])


# ---------------------------------------------------------------------------
# On-the-fly composite
# ---------------------------------------------------------------------------


def _get_object_bytes(bucket: str, s3_key: str) -> bytes:
    resp = minio().get_object(bucket, s3_key)
    try:
        return resp.read()
    finally:
        resp.close()
        resp.release_conn()


@router.get("/photos/{photo_id}/wm")
async def watermarked_photo(photo_id: UUID, request: Request) -> Response:
    row = await pool().fetchrow(
        """
        SELECT p.s3_key, p.mime, p.state, g.watermark_enabled,
               w.s3_key AS wm_key
        FROM photos p
        JOIN photo_collages c ON c.id = p.collage_id
        JOIN photo_groups g ON g.id = c.group_id
        LEFT JOIN watermark_config wc ON wc.id = 1
        LEFT JOIN studio_watermarks w
               ON w.id = wc.watermark_id AND w.deleted_at IS NULL
        WHERE p.id = $1
        """,
        photo_id,
    )
    if row is None or row["state"] == "deleted":
        raise HTTPException(404, "Photo not found")
    if (row["mime"] or "").startswith("video/"):
        raise HTTPException(400, "Watermark endpoint serves images only")

    # Flag off or no active mark — stale URL, hand back the clean object.
    if not row["watermark_enabled"] or row["wm_key"] is None:
        return RedirectResponse(public_url(row["s3_key"]), status_code=307)

    etag = wm.etag_for(row["s3_key"], row["wm_key"])
    if request.headers.get("if-none-match") == etag:
        return Response(status_code=304)

    wm_key = row["wm_key"]
    wm_bytes = await asyncio.to_thread(
        wm.cached_asset_bytes,
        wm_key,
        lambda: _get_object_bytes(studio_bucket(), wm_key),
    )
    base_bytes = await asyncio.to_thread(
        _get_object_bytes, settings.minio_bucket, row["s3_key"]
    )
    out = await asyncio.to_thread(wm.apply_watermark, base_bytes, wm_bytes)

    return Response(
        content=out,
        media_type="image/jpeg",
        headers={
            "ETag": etag,
            "Cache-Control": "public, max-age=300",
        },
    )

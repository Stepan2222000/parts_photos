"""Switchable catalog backgrounds: URL resolution helpers.

Photos flagged `photos.bg_set` may have one generated version per
studio_backgrounds asset (photo_bg_versions, object under
bg/{background_id}/{photo_id}.png in the main bucket). `background_config`
points at the active background; when a photo has a `done` version for it,
that object is served instead of photos.s3_key. Base photo rows are never
rewritten — switching backgrounds is a single config UPDATE and instantly
reversible.
"""
from __future__ import annotations

from uuid import UUID

from .db import pool


def version_key(background_id: UUID | str, photo_id: UUID | str) -> str:
    return f"bg/{background_id}/{photo_id}.png"


async def active_background_id() -> UUID | None:
    return await pool().fetchval(
        """
        SELECT c.background_id FROM background_config c
        JOIN studio_backgrounds b ON b.id = c.background_id AND b.deleted_at IS NULL
        WHERE c.id = 1
        """
    )


async def overrides_for(photo_ids: list[UUID]) -> dict[UUID, str]:
    """photo_id -> s3_key of its active-background version ('done' only).
    Photos without a version simply stay on their own s3_key — callers use
    `ov.get(photo_id, base_key)`."""
    ids = [i for i in photo_ids if i is not None]
    if not ids:
        return {}
    rows = await pool().fetch(
        """
        SELECT v.photo_id, v.s3_key
        FROM photo_bg_versions v
        JOIN background_config c ON c.id = 1 AND c.background_id = v.background_id
        JOIN studio_backgrounds b ON b.id = v.background_id AND b.deleted_at IS NULL
        WHERE v.state = 'done' AND v.s3_key IS NOT NULL
          AND v.photo_id = ANY($1::uuid[])
        """,
        ids,
    )
    return {r["photo_id"]: r["s3_key"] for r in rows}

from __future__ import annotations

from typing import Literal
from uuid import UUID

from fastapi import APIRouter, HTTPException, Query

from ..db import pool
from ..models import OwnerSearchResult
from ..studio import groups as gconfig

router = APIRouter(prefix="/owners", tags=["owners"])


@router.get("/search", response_model=list[OwnerSearchResult])
async def search_owners(
    q: str = Query(min_length=1, max_length=200),
    kind: Literal["smart_part"] = "smart_part",
    limit: int = Query(default=20, ge=1, le=100),
) -> list[OwnerSearchResult]:
    """Autocomplete by id / name / any article via postgres_fdw → smart_ext.parts.

    Real smart.parts schema (see sql/fdw_smart.sql):
        id        text   ('smart_NNNNNNNN')
        name      text
        articles  text[]
        is_draft  boolean   (we don't filter — admin needs both drafts and published)
    """
    pattern = f"%{q}%"
    try:
        rows = await pool().fetch(
            """
            SELECT id, name, articles
            FROM smart_ext.parts
            WHERE id ILIKE $1
               OR name ILIKE $1
               OR EXISTS (SELECT 1 FROM unnest(articles) a WHERE a ILIKE $1)
            ORDER BY
                (id = $2)::int DESC,
                name ASC
            LIMIT $3
            """,
            pattern, q, limit,
        )
    except Exception as e:
        raise HTTPException(
            500,
            f"FDW query failed — check sql/fdw_smart.sql is applied and remote schema matches: {e}",
        ) from e

    return [
        OwnerSearchResult(
            smart_id=r["id"],
            name=r["name"],
            articles=list(r["articles"] or []),
        )
        for r in rows
    ]


async def validate_owner_exists(
    kind: str, owner_id: str, group_id: UUID, strict: bool = True
) -> None:
    """Validate that `owner_id` is a real, eligible owner for `group_id`.

    No silent fallbacks — every failure is an explicit 422 with a reason. For
    `instance` eligibility uses the group's `condition_filter` and requires the
    item to be in stock — UNLESS `strict=False` (the free-form library), where an
    item binding is just a label, so we only check the item exists.
    """
    if kind == "smart_part":
        exists = await pool().fetchval(
            "SELECT 1 FROM smart_ext.parts WHERE id = $1", owner_id
        )
        if not exists:
            raise HTTPException(422, f"smart_id '{owner_id}' not found in smart.parts")
        return

    if kind == "instance":
        cfg = gconfig.get(group_id)
        if cfg is None:
            raise HTTPException(422, "group is not configured for collage creation")
        try:
            item_id = int(owner_id)
        except ValueError:
            raise HTTPException(
                422, f"instance owner_id must be an integer item id, got '{owner_id}'"
            )
        item = await pool().fetchrow(
            "SELECT id, condition, status FROM uchet_ext.items WHERE id = $1", item_id
        )
        if item is None:
            raise HTTPException(422, f"item {item_id} not found in parts_uchet")
        if not strict:
            return  # library: existence-only, the binding is just a label
        if item["status"] != "in_stock":
            raise HTTPException(
                422, f"item {item_id} status={item['status']!r}, not in_stock"
            )
        gconfig.assert_item_condition_allowed(item["condition"], group_id)
        return

    raise HTTPException(422, f"unknown owner_kind '{kind}'")

from __future__ import annotations

from typing import Literal

from fastapi import APIRouter, HTTPException, Query

from ..db import pool
from ..models import OwnerSearchResult

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


async def validate_owner_exists(kind: str, owner_id: str) -> None:
    """Validate owner exists in source DB. Raises 422 if not."""
    if kind != "smart_part":
        raise HTTPException(
            422, f"owner_kind '{kind}' is not yet wired to a source table"
        )
    exists = await pool().fetchval(
        "SELECT 1 FROM smart_ext.parts WHERE id = $1", owner_id
    )
    if not exists:
        raise HTTPException(422, f"smart_id '{owner_id}' not found in smart.parts")

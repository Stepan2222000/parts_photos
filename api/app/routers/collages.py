from __future__ import annotations

from typing import Literal
from uuid import UUID

from fastapi import APIRouter, HTTPException, Query

from ..db import pool
from ..minio_client import public_url
from ..models import Collage, CollageCreate, CollageDetail, Photo
from .owners import validate_owner_exists

router = APIRouter(tags=["collages"])

Filter = Literal["all", "empty", "few"]
Sort = Literal["updated", "count", "owner"]


async def _query_collages(
    group_id: UUID | None,
    q: str | None,
    filter: Filter,
    sort: Sort,
    limit: int,
) -> list[Collage]:
    where: list[str] = []
    params: list = []

    if group_id is not None:
        params.append(group_id)
        where.append(f"c.group_id = ${len(params)}")

    if q:
        params.append(f"%{q}%")
        i = len(params)
        where.append(
            f"(c.owner_id ILIKE ${i} "
            f"OR p_meta.name ILIKE ${i} "
            f"OR EXISTS (SELECT 1 FROM unnest(p_meta.articles) a WHERE a ILIKE ${i}))"
        )

    where_sql = f"WHERE {' AND '.join(where)}" if where else ""

    having = ""
    if filter == "empty":
        having = "HAVING COUNT(ph.id) FILTER (WHERE ph.state = 'uploaded') = 0"
    elif filter == "few":
        having = "HAVING COUNT(ph.id) FILTER (WHERE ph.state = 'uploaded') < 3"

    order = {
        "updated": "MAX(ph.uploaded_at) DESC NULLS LAST, c.created_at DESC",
        "count": "COUNT(ph.id) FILTER (WHERE ph.state = 'uploaded') DESC",
        "owner": "c.owner_id ASC",
    }[sort]

    params.append(limit)
    sql = f"""
        SELECT
            c.id, c.group_id, c.owner_kind, c.owner_id, c.created_at,
            g.name          AS group_name,
            p_meta.name     AS owner_name,
            p_meta.articles AS owner_articles,
            COUNT(ph.id) FILTER (WHERE ph.state = 'uploaded') AS photos_count,
            first_photo.s3_key AS first_key
        FROM photo_collages c
        JOIN photo_groups g ON g.id = c.group_id
        LEFT JOIN photos ph ON ph.collage_id = c.id
        LEFT JOIN smart_ext.parts p_meta
               ON c.owner_kind = 'smart_part' AND p_meta.id = c.owner_id
        LEFT JOIN LATERAL (
            SELECT s3_key FROM photos
            WHERE collage_id = c.id AND state = 'uploaded'
            ORDER BY position ASC
            LIMIT 1
        ) first_photo ON true
        {where_sql}
        GROUP BY c.id, g.name, p_meta.name, p_meta.articles, first_photo.s3_key
        {having}
        ORDER BY {order}
        LIMIT ${len(params)}
    """
    rows = await pool().fetch(sql, *params)

    return [
        Collage(
            id=r["id"],
            group_id=r["group_id"],
            owner_kind=r["owner_kind"],
            owner_id=r["owner_id"],
            created_at=r["created_at"],
            photos_count=r["photos_count"],
            first_photo_url=public_url(r["first_key"]) if r["first_key"] else None,
            owner_name=r["owner_name"],
            owner_articles=list(r["owner_articles"] or []),
            group_name=r["group_name"],
        )
        for r in rows
    ]


@router.get("/groups/{group_id}/collages", response_model=list[Collage])
async def list_collages(
    group_id: UUID,
    q: str | None = None,
    filter: Filter = "all",
    sort: Sort = "updated",
    limit: int = Query(default=200, ge=1, le=1000),
) -> list[Collage]:
    return await _query_collages(group_id, q, filter, sort, limit)


@router.get("/collages/search", response_model=list[Collage])
async def search_collages(
    q: str = Query(min_length=1, max_length=200),
    group_id: UUID | None = None,
    filter: Filter = "all",
    sort: Sort = "updated",
    limit: int = Query(default=60, ge=1, le=200),
) -> list[Collage]:
    return await _query_collages(group_id, q, filter, sort, limit)


@router.post("/collages", response_model=Collage, status_code=201)
async def create_collage(payload: CollageCreate) -> Collage:
    await validate_owner_exists(payload.owner_kind, payload.owner_id)

    try:
        row = await pool().fetchrow(
            """
            INSERT INTO photo_collages (group_id, owner_kind, owner_id)
            VALUES ($1, $2, $3)
            RETURNING id, group_id, owner_kind, owner_id, created_at
            """,
            payload.group_id, payload.owner_kind, payload.owner_id,
        )
    except Exception as e:
        raise HTTPException(
            409,
            f"Collage already exists for this (group, owner) pair: {e}",
        ) from e

    return Collage(**dict(row), photos_count=0, first_photo_url=None)


@router.get("/collages/{collage_id}", response_model=CollageDetail)
async def get_collage(collage_id: UUID) -> CollageDetail:
    head = await pool().fetchrow(
        """
        SELECT
            c.id, c.group_id, c.owner_kind, c.owner_id,
            g.name AS group_name,
            p_meta.name     AS owner_name,
            p_meta.articles AS owner_articles
        FROM photo_collages c
        JOIN photo_groups g ON g.id = c.group_id
        LEFT JOIN smart_ext.parts p_meta
               ON c.owner_kind = 'smart_part' AND p_meta.id = c.owner_id
        WHERE c.id = $1
        """,
        collage_id,
    )
    if head is None:
        raise HTTPException(404, "Collage not found")

    photo_rows = await pool().fetch(
        """
        SELECT id, collage_id, position, s3_key, mime, size_bytes,
               state, uploaded_at, created_at
        FROM photos
        WHERE collage_id = $1 AND state IN ('uploaded', 'failed')
        ORDER BY position ASC
        """,
        collage_id,
    )

    photos = [
        Photo(**dict(r), url=public_url(r["s3_key"])) for r in photo_rows
    ]
    return CollageDetail(
        id=head["id"],
        group_id=head["group_id"],
        group_name=head["group_name"],
        owner_kind=head["owner_kind"],
        owner_id=head["owner_id"],
        owner_name=head["owner_name"],
        owner_articles=list(head["owner_articles"] or []),
        photos=photos,
    )


@router.delete("/collages/{collage_id}", status_code=204)
async def delete_collage(collage_id: UUID) -> None:
    res = await pool().execute("DELETE FROM photo_collages WHERE id = $1", collage_id)
    if res.endswith(" 0"):
        raise HTTPException(404, "Collage not found")

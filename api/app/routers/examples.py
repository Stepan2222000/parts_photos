"""«Примеры с рынка» — positive-референсы реальных фото запчастей для VL-моделей.

Один пример = один коллаж в группе EXAMPLES_GROUP_ID. Привязка к smart живёт
ТОЛЬКО в smart_part_examples (owner_kind/owner_id у коллажей этой группы всегда
NULL) — единственный источник правды, без дублирования.

Контракт:
- POST   /examples                — создать пример (коллаж + связь, position=MAX+1);
- GET    /examples?smart_id=…     — примеры одного smart с фото (для моделей и UI);
- DELETE /examples/{example_id}   — удалить пример целиком (связь + коллаж + S3).

Фото загружаются существующим POST /collages/{collage_id}/photos.
Generic POST /collages в эту группу отклоняется (см. create_collage).
"""
from __future__ import annotations

from uuid import UUID

from fastapi import APIRouter, HTTPException, Query

from ..db import pool
from ..minio_client import public_url
from ..models import Example, ExampleCreate, Photo
from ..studio.groups import EXAMPLES_GROUP_ID
from ..studio.storage import delete_photos_prefix

router = APIRouter(prefix="/examples", tags=["examples"])


async def _attach_photos(examples: list[Example]) -> None:
    """Fill `photos` (uploaded, ordered by position) for a list of examples."""
    if not examples:
        return
    rows = await pool().fetch(
        """
        SELECT id, collage_id, position, s3_key, mime, size_bytes,
               state, uploaded_at, created_at
        FROM photos
        WHERE collage_id = ANY($1::uuid[]) AND state = 'uploaded'
        ORDER BY collage_id, position ASC
        """,
        [e.collage_id for e in examples],
    )
    by_collage: dict[UUID, list[Photo]] = {}
    for r in rows:
        by_collage.setdefault(r["collage_id"], []).append(
            Photo(**dict(r), url=public_url(r["s3_key"]))
        )
    for e in examples:
        e.photos = by_collage.get(e.collage_id, [])


@router.get("", response_model=list[Example])
async def list_examples(
    smart_id: str = Query(pattern=r"^smart_[0-9]{8}$"),
) -> list[Example]:
    """Примеры одного smart, упорядоченные по position, с фото.

    Основной read-контракт для моделей: smart_id → примеры → URL фото.
    """
    rows = await pool().fetch(
        """
        SELECT e.id, e.smart_part_id, e.collage_id, e.position, e.created_at,
               c.title
        FROM smart_part_examples e
        JOIN photo_collages c ON c.id = e.collage_id
        WHERE e.smart_part_id = $1
        ORDER BY e.position ASC
        """,
        smart_id,
    )
    part = await pool().fetchrow(
        "SELECT name, articles FROM smart_ext.parts WHERE id = $1", smart_id
    )
    examples = [
        Example(
            **dict(r),
            smart_part_name=part["name"] if part else None,
            smart_part_articles=list(part["articles"] or []) if part else [],
        )
        for r in rows
    ]
    await _attach_photos(examples)
    return examples


@router.post("", response_model=Example, status_code=201)
async def create_example(payload: ExampleCreate) -> Example:
    part = await pool().fetchrow(
        "SELECT name, articles FROM smart_ext.parts WHERE id = $1",
        payload.smart_part_id,
    )
    if part is None:
        raise HTTPException(
            422, f"smart_id '{payload.smart_part_id}' not found in smart.parts"
        )

    title = payload.title.strip() if payload.title else None

    async with pool().acquire() as conn:
        async with conn.transaction():
            # Serialize MAX(position)+1 per smart — same advisory-lock pattern
            # as photo uploads (parallel creates would race the UNIQUE).
            await conn.execute(
                "SELECT pg_advisory_xact_lock(hashtextextended($1::text, 0))",
                f"examples:{payload.smart_part_id}",
            )
            collage = await conn.fetchrow(
                """
                INSERT INTO photo_collages (group_id, owner_kind, owner_id, title)
                VALUES ($1, NULL, NULL, $2)
                RETURNING id
                """,
                EXAMPLES_GROUP_ID, title,
            )
            row = await conn.fetchrow(
                """
                INSERT INTO smart_part_examples (smart_part_id, collage_id, position)
                VALUES (
                    $1, $2,
                    COALESCE((SELECT MAX(position) + 1 FROM smart_part_examples
                              WHERE smart_part_id = $1), 1)
                )
                RETURNING id, smart_part_id, collage_id, position, created_at
                """,
                payload.smart_part_id, collage["id"],
            )

    return Example(
        **dict(row),
        title=title,
        smart_part_name=part["name"],
        smart_part_articles=list(part["articles"] or []),
    )


@router.delete("/{example_id}", status_code=204)
async def delete_example(example_id: UUID) -> None:
    """Удаляет пример целиком: связь, коллаж (FK CASCADE снимает связь) и
    файлы в MinIO. Коллаж-сирота остаться не должен."""
    link = await pool().fetchrow(
        "SELECT collage_id FROM smart_part_examples WHERE id = $1", example_id
    )
    if link is None:
        raise HTTPException(404, "Example not found")
    # DB cascade: deleting the collage drops both the link row and photo rows.
    await pool().execute(
        "DELETE FROM photo_collages WHERE id = $1", link["collage_id"]
    )
    delete_photos_prefix(
        f"groups/{EXAMPLES_GROUP_ID}/collages/{link['collage_id']}/"
    )

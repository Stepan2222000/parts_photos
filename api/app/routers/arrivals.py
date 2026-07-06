"""Arrivals («Поступления»): один коллаж на трек-номер.

Интеграционная точка для delivery (SPEC_INTAKE §6.2): при подтверждении
приёмки delivery-бэкенд вызывает PUT /arrivals/{tracking_number} (идемпотентный
get-or-create), затем грузит фото существующим POST /collages/{id}/photos.

Канал «Поступления» остаётся вне Studio (studio_role='none') и вне generic
POST /collages — единственный способ создать arrival-коллаж находится здесь.
Валидация трека — только формат: создателем выступает delivery, он и есть
источник истины по трекам; FDW в delivery ради проверки не заводим.
"""
from __future__ import annotations

import re

from fastapi import APIRouter, HTTPException

from ..db import pool
from ..minio_client import public_url
from ..models import Collage
from ..studio.groups import ARRIVALS_GROUP_ID

router = APIRouter(prefix="/arrivals", tags=["arrivals"])

# Трек: латиница/цифры и немного пунктуации, без пробелов. Верхний регистр —
# канонический (delivery хранит треки в верхнем регистре).
_TN_RE = re.compile(r"^[A-Z0-9][A-Z0-9._-]{3,63}$")


def _normalize_tn(tracking_number: str) -> str:
    tn = tracking_number.strip().upper()
    if not _TN_RE.match(tn):
        raise HTTPException(
            422,
            f"tracking_number {tracking_number!r} имеет неожиданный формат "
            "(ожидается 4–64 символа A-Z/0-9/._- без пробелов)",
        )
    return tn


@router.put("/{tracking_number}", response_model=Collage)
async def get_or_create_arrival_collage(tracking_number: str) -> Collage:
    """Идемпотентный get-or-create коллажа «Поступлений» для трека.

    Advisory-lock сериализует гонку create (тот же паттерн, что _place_photos);
    уникальность страхует и БД-индекс photo_collages_owner_unique.
    """
    tn = _normalize_tn(tracking_number)

    async with pool().acquire() as conn:
        async with conn.transaction():
            await conn.execute(
                "SELECT pg_advisory_xact_lock(hashtextextended($1::text, 0))",
                f"{ARRIVALS_GROUP_ID}:{tn}",
            )
            row = await conn.fetchrow(
                """
                SELECT id, group_id, owner_kind, owner_id, title, created_at
                FROM photo_collages
                WHERE group_id = $1 AND owner_kind = 'arrival' AND owner_id = $2
                """,
                ARRIVALS_GROUP_ID, tn,
            )
            if row is None:
                row = await conn.fetchrow(
                    """
                    INSERT INTO photo_collages (group_id, owner_kind, owner_id)
                    VALUES ($1, 'arrival', $2)
                    RETURNING id, group_id, owner_kind, owner_id, title, created_at
                    """,
                    ARRIVALS_GROUP_ID, tn,
                )

    photos = await pool().fetch(
        """
        SELECT COUNT(*) FILTER (WHERE state = 'uploaded') AS cnt,
               (SELECT s3_key FROM photos
                WHERE collage_id = $1 AND state = 'uploaded'
                  AND mime NOT LIKE 'video/%'
                ORDER BY position ASC LIMIT 1) AS first_key
        FROM photos WHERE collage_id = $1
        """,
        row["id"],
    )
    cnt, first_key = photos[0]["cnt"], photos[0]["first_key"]
    return Collage(
        **dict(row),
        photos_count=cnt,
        first_photo_url=public_url(first_key) if first_key else None,
    )

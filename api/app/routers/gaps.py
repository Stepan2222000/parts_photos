"""Photo gaps — fill missing publication photos from what is in stock.

Three categories (see docs/PHOTO_GAPS.md):
  - reference: in_stock `new` smart_parts without «Эталонные» photos;
  - personal / defect: in_stock items of that condition without «На публикацию»
    photos.

Filling reuses the shared `_place_photos` core (move/copy derived by
`is_direct_move_allowed`) and the existing matching helpers. No new schema
beyond `source='copy'` (migration_009).
"""
from __future__ import annotations

from uuid import UUID

from fastapi import APIRouter, HTTPException, Query

from ..db import pool
from ..minio_client import public_url
from ..models import (
    GapCounts,
    GapFillRequest,
    GapKind,
    GapRow,
    GapSourceCollage,
    GapSources,
    Photo,
)
from ..studio import groups as gconfig
from ..studio.storage import delete_photos_object
from .collages import _place_photos

router = APIRouter(tags=["gaps"])

REF = gconfig.REFERENCE_GROUP_ID
PUB = gconfig.PUBLICATION_GROUP_ID
REAL = gconfig.REAL_GROUP_ID
LIB = gconfig.LIBRARY_GROUP_ID

# A live (uploaded, non-video) photo exists in a collage of (group, owner).
_HAS_PHOTOS = """
EXISTS (SELECT 1 FROM photo_collages pc
        JOIN photos p ON p.collage_id = pc.id AND p.state = 'uploaded'
        WHERE pc.group_id = $g AND pc.owner_kind = $k AND pc.owner_id = $o)
"""


@router.get("/gaps/counts", response_model=GapCounts)
async def gaps_counts() -> GapCounts:
    ref = await pool().fetchval(
        """
        SELECT count(DISTINCT i.smart_part_id)
        FROM uchet_ext.items i
        WHERE i.status = 'in_stock' AND i.condition = 'new'
          AND NOT EXISTS (
            SELECT 1 FROM photo_collages pc
            JOIN photos p ON p.collage_id = pc.id AND p.state = 'uploaded'
            WHERE pc.group_id = $1 AND pc.owner_kind = 'smart_part'
              AND pc.owner_id = i.smart_part_id)
        """,
        REF,
    )

    async def _instance_count(cond: str) -> int:
        return await pool().fetchval(
            """
            SELECT count(*)
            FROM uchet_ext.items i
            WHERE i.status = 'in_stock' AND i.condition = $2
              AND NOT EXISTS (
                SELECT 1 FROM photo_collages pc
                JOIN photos p ON p.collage_id = pc.id AND p.state = 'uploaded'
                WHERE pc.group_id = $1 AND pc.owner_kind = 'instance'
                  AND pc.owner_id = i.id::text)
            """,
            PUB, cond,
        )

    return GapCounts(
        reference=ref or 0,
        personal=await _instance_count("personal"),
        defect=await _instance_count("defect"),
    )


@router.get("/gaps", response_model=list[GapRow])
async def list_gaps(
    kind: GapKind,
    q: str | None = None,
    limit: int = Query(default=200, ge=1, le=1000),
    offset: int = Query(default=0, ge=0),
) -> list[GapRow]:
    pattern = f"%{q}%" if q else None

    if kind == "reference":
        rows = await pool().fetch(
            """
            WITH gap_parts AS (
                SELECT DISTINCT i.smart_part_id
                FROM uchet_ext.items i
                WHERE i.status = 'in_stock' AND i.condition = 'new'
                  AND NOT EXISTS (
                    SELECT 1 FROM photo_collages pc
                    JOIN photos p ON p.collage_id = pc.id AND p.state = 'uploaded'
                    WHERE pc.group_id = $1 AND pc.owner_kind = 'smart_part'
                      AND pc.owner_id = i.smart_part_id)
            )
            SELECT gp.smart_part_id, sp.name, sp.articles,
              (SELECT count(*) FROM uchet_ext.items i2
                 WHERE i2.smart_part_id = gp.smart_part_id
                   AND i2.status = 'in_stock' AND i2.condition = 'new') AS in_stock_count,
              (SELECT count(*) FROM uchet_ext.items i2
                 JOIN photo_collages pc ON pc.group_id = $2 AND pc.owner_kind = 'instance'
                                       AND pc.owner_id = i2.id::text
                 JOIN photos p ON p.collage_id = pc.id AND p.state = 'uploaded'
                                AND p.mime NOT LIKE 'video/%'
                 WHERE i2.smart_part_id = gp.smart_part_id AND i2.status = 'in_stock'
                   AND i2.condition <> 'defect') AS real_photos,
              (SELECT count(DISTINCT pc.id) FROM photo_collages pc
                 JOIN photos p ON p.collage_id = pc.id AND p.state = 'uploaded'
                                AND p.mime NOT LIKE 'video/%'
                 WHERE pc.group_id = $3 AND pc.owner_kind = 'smart_part'
                   AND pc.owner_id = gp.smart_part_id) AS free_collages,
              (SELECT pc.id FROM photo_collages pc
                 WHERE pc.group_id = $1 AND pc.owner_kind = 'smart_part'
                   AND pc.owner_id = gp.smart_part_id LIMIT 1) AS target_collage_id
            FROM gap_parts gp
            LEFT JOIN smart_ext.parts sp ON sp.id = gp.smart_part_id
            WHERE ($4::text IS NULL
                   OR gp.smart_part_id ILIKE $4
                   OR sp.name ILIKE $4
                   OR EXISTS (SELECT 1 FROM unnest(sp.articles) a WHERE a ILIKE $4))
            ORDER BY real_photos DESC, sp.name NULLS LAST
            LIMIT $5 OFFSET $6
            """,
            REF, REAL, LIB, pattern, limit, offset,
        )
        return [
            GapRow(
                kind="reference",
                smart_part_id=r["smart_part_id"],
                name=r["name"],
                articles=list(r["articles"] or []),
                in_stock_count=r["in_stock_count"],
                real_photos=r["real_photos"],
                free_collages=r["free_collages"],
                target_group_id=REF,
                target_owner_kind="smart_part",
                target_owner_id=r["smart_part_id"],
                target_collage_id=r["target_collage_id"],
            )
            for r in rows
        ]

    cond = "personal" if kind == "personal" else "defect"
    rows = await pool().fetch(
        """
        SELECT i.id AS item_id, i.smart_part_id, i.condition, i.condition_note,
          sp.name, sp.articles,
          (SELECT count(*) FROM photo_collages pc
             JOIN photos p ON p.collage_id = pc.id AND p.state = 'uploaded'
                            AND p.mime NOT LIKE 'video/%'
             WHERE pc.group_id = $2 AND pc.owner_kind = 'instance'
               AND pc.owner_id = i.id::text) AS real_photos,
          (SELECT count(DISTINCT pc.id) FROM photo_collages pc
             JOIN photos p ON p.collage_id = pc.id AND p.state = 'uploaded'
                            AND p.mime NOT LIKE 'video/%'
             WHERE pc.group_id = $3 AND pc.owner_kind = 'smart_part'
               AND pc.owner_id = i.smart_part_id) AS free_collages,
          (SELECT pc.id FROM photo_collages pc
             WHERE pc.group_id = $1 AND pc.owner_kind = 'instance'
               AND pc.owner_id = i.id::text LIMIT 1) AS target_collage_id
        FROM uchet_ext.items i
        LEFT JOIN smart_ext.parts sp ON sp.id = i.smart_part_id
        WHERE i.status = 'in_stock' AND i.condition = $4
          AND NOT EXISTS (
            SELECT 1 FROM photo_collages pc
            JOIN photos p ON p.collage_id = pc.id AND p.state = 'uploaded'
            WHERE pc.group_id = $1 AND pc.owner_kind = 'instance'
              AND pc.owner_id = i.id::text)
          AND ($5::text IS NULL
               OR i.id::text ILIKE $5
               OR i.smart_part_id ILIKE $5
               OR sp.name ILIKE $5
               OR EXISTS (SELECT 1 FROM unnest(sp.articles) a WHERE a ILIKE $5))
        ORDER BY real_photos DESC, i.id ASC
        LIMIT $6 OFFSET $7
        """,
        PUB, REAL, LIB, cond, pattern, limit, offset,
    )
    return [
        GapRow(
            kind=kind,
            item_id=r["item_id"],
            smart_part_id=r["smart_part_id"],
            name=r["name"],
            articles=list(r["articles"] or []),
            condition=r["condition"],
            condition_note=r["condition_note"],
            real_photos=r["real_photos"],
            free_collages=r["free_collages"],
            target_group_id=PUB,
            target_owner_kind="instance",
            target_owner_id=str(r["item_id"]),
            target_collage_id=r["target_collage_id"],
        )
        for r in rows
    ]


async def _collages_with_photos(
    head_rows: list[dict],
) -> list[GapSourceCollage]:
    """Attach uploaded (non-video) photos to a list of source-collage heads."""
    if not head_rows:
        return []
    ids = [r["collage_id"] for r in head_rows]
    photo_rows = await pool().fetch(
        """
        SELECT id, collage_id, position, s3_key, mime, size_bytes,
               state, uploaded_at, created_at
        FROM photos
        WHERE collage_id = ANY($1::uuid[]) AND state = 'uploaded'
          AND mime NOT LIKE 'video/%'
        ORDER BY position ASC
        """,
        ids,
    )
    by_collage: dict[UUID, list[Photo]] = {}
    for p in photo_rows:
        by_collage.setdefault(p["collage_id"], []).append(
            Photo(**dict(p), url=public_url(p["s3_key"]))
        )
    out: list[GapSourceCollage] = []
    for r in head_rows:
        photos = by_collage.get(r["collage_id"], [])
        if not photos:
            continue  # empty source collage is not pickable
        out.append(
            GapSourceCollage(
                collage_id=r["collage_id"],
                group_id=r["group_id"],
                group_name=gconfig.GROUP_NAMES.get(r["group_id"]),
                owner_kind=r["owner_kind"],
                owner_id=r["owner_id"],
                title=r.get("title"),
                item_id=r.get("item_id"),
                condition=r.get("condition"),
                photos=photos,
            )
        )
    return out


@router.get("/gaps/sources", response_model=GapSources)
async def gap_sources(
    kind: GapKind,
    smart_part_id: str | None = None,
    item_id: int | None = None,
) -> GapSources:
    """Pickable source collages for a gap: real photos (auto) + library (manual).

    reference → real photos of all in_stock non-defect instances of the part;
    personal/defect → real photos of THIS item only. Library collages are by the
    item's smart_part in both cases.
    """
    if kind == "reference":
        if not smart_part_id:
            raise HTTPException(400, "smart_part_id required for reference gaps")
        sp = smart_part_id
        real_heads = await pool().fetch(
            """
            SELECT pc.id AS collage_id, pc.group_id, pc.owner_kind, pc.owner_id,
                   NULL::text AS title, i.id AS item_id, i.condition
            FROM uchet_ext.items i
            JOIN photo_collages pc ON pc.group_id = $1 AND pc.owner_kind = 'instance'
                                  AND pc.owner_id = i.id::text
            WHERE i.smart_part_id = $2 AND i.status = 'in_stock'
              AND i.condition <> 'defect'
            ORDER BY i.id ASC
            """,
            REAL, sp,
        )
    else:
        if item_id is None:
            raise HTTPException(400, "item_id required for personal/defect gaps")
        item = await pool().fetchrow(
            "SELECT id, smart_part_id, condition FROM uchet_ext.items WHERE id = $1",
            item_id,
        )
        if item is None:
            raise HTTPException(404, f"item {item_id} not found")
        sp = item["smart_part_id"]
        real_heads = await pool().fetch(
            """
            SELECT pc.id AS collage_id, pc.group_id, pc.owner_kind, pc.owner_id,
                   NULL::text AS title, $2::int AS item_id, $3::text AS condition
            FROM photo_collages pc
            WHERE pc.group_id = $1 AND pc.owner_kind = 'instance'
              AND pc.owner_id = $2::text
            """,
            REAL, item_id, item["condition"],
        )

    free_heads = []
    if sp:
        free_heads = await pool().fetch(
            """
            SELECT pc.id AS collage_id, pc.group_id, pc.owner_kind, pc.owner_id,
                   pc.title, NULL::int AS item_id, NULL::text AS condition
            FROM photo_collages pc
            WHERE pc.group_id = $1 AND pc.owner_kind = 'smart_part'
              AND pc.owner_id = $2
            ORDER BY pc.created_at ASC
            """,
            LIB, sp,
        )

    return GapSources(
        real=await _collages_with_photos([dict(r) for r in real_heads]),
        free=await _collages_with_photos([dict(r) for r in free_heads]),
    )


@router.post("/gaps/fill", response_model=list[Photo])
async def fill_gap(body: GapFillRequest) -> list[Photo]:
    """Place chosen photos into a gap's target channel.

    move vs copy is derived per photo inside `_place_photos`. Owner is validated
    here against the target channel (item in_stock + condition for instance
    targets; smart_part existence for reference). The chosen source photos may be
    anything (manual escape-hatch) — only the route/condition gates apply.
    """
    tgt_cfg = gconfig.get(body.target_group_id)
    if tgt_cfg is None or tgt_cfg.studio_role != "target":
        raise HTTPException(422, "target_group_id is not a publication target")
    if body.target_owner_kind != tgt_cfg.owner_kind:
        raise HTTPException(
            400,
            f"target group expects owner_kind={tgt_cfg.owner_kind!r}, "
            f"got {body.target_owner_kind!r}",
        )

    if tgt_cfg.owner_kind == "instance":
        try:
            item_id = int(body.target_owner_id)
        except (TypeError, ValueError):
            raise HTTPException(400, f"target_owner_id {body.target_owner_id!r} is not an item id")
        item = await pool().fetchrow(
            "SELECT id, condition, status FROM uchet_ext.items WHERE id = $1", item_id
        )
        if item is None:
            raise HTTPException(404, f"item {item_id} not found in parts_uchet")
        if item["status"] != "in_stock":
            raise HTTPException(400, f"item {item_id} status={item['status']!r}, not in_stock")
        gconfig.assert_item_condition_allowed(item["condition"], body.target_group_id)
    else:
        ok = await pool().fetchval(
            "SELECT 1 FROM smart_ext.parts WHERE id = $1", body.target_owner_id
        )
        if not ok:
            raise HTTPException(404, f"smart_part_id {body.target_owner_id!r} not in smart catalog")

    async with pool().acquire() as conn:
        async with conn.transaction():
            placed, old_keys = await _place_photos(
                conn,
                photo_ids=body.photo_ids,
                target_group_id=body.target_group_id,
                target_owner_kind=body.target_owner_kind,
                target_owner_id=body.target_owner_id,
            )

    for k in old_keys:
        delete_photos_object(k)

    return placed

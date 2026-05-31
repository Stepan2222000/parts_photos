from __future__ import annotations

from typing import Literal
from uuid import UUID

from fastapi import APIRouter, HTTPException, Query

from ..db import pool
from ..minio_client import public_url
from ..models import (
    Collage,
    CollageCreate,
    CollageDetail,
    CollageTransferRequest,
    MoveTarget,
    Photo,
)
from ..studio import groups as gconfig
from ..studio.storage import copy_within_photos, delete_photos_object
from .owners import validate_owner_exists

router = APIRouter(tags=["collages"])


async def _instance_owner_meta(owner_ids: list[str]) -> dict[str, dict]:
    """Resolve display meta for instance owners (item ids as text).

    Two batched FDW queries — items then parts — stitched in Python. We never
    join `uchet_ext.items` and `smart_ext.parts` in one SQL (different foreign
    servers → no join pushdown). Returns {owner_id: {name, articles, condition,
    condition_note}}.
    """
    int_ids: list[int] = []
    for oid in owner_ids:
        try:
            int_ids.append(int(oid))
        except (TypeError, ValueError):
            continue
    if not int_ids:
        return {}

    item_rows = await pool().fetch(
        "SELECT id, smart_part_id, condition, condition_note "
        "FROM uchet_ext.items WHERE id = ANY($1::int[])",
        int_ids,
    )
    smart_ids = list({r["smart_part_id"] for r in item_rows if r["smart_part_id"]})
    parts: dict[str, dict] = {}
    if smart_ids:
        part_rows = await pool().fetch(
            "SELECT id, name, articles FROM smart_ext.parts WHERE id = ANY($1::text[])",
            smart_ids,
        )
        parts = {
            r["id"]: {"name": r["name"], "articles": list(r["articles"] or [])}
            for r in part_rows
        }
    out: dict[str, dict] = {}
    for r in item_rows:
        p = parts.get(r["smart_part_id"], {})
        out[str(r["id"])] = {
            "name": p.get("name"),
            "articles": p.get("articles", []),
            "condition": r["condition"],
            "condition_note": r["condition_note"],
        }
    return out


async def _enrich_instances(collages: list[Collage]) -> None:
    """Fill name/articles/condition for instance collages in place."""
    inst_ids = [c.owner_id for c in collages if c.owner_kind == "instance"]
    if not inst_ids:
        return
    meta = await _instance_owner_meta(inst_ids)
    for c in collages:
        if c.owner_kind != "instance":
            continue
        m = meta.get(c.owner_id)
        if not m:
            continue
        c.owner_name = m["name"]
        c.owner_articles = m["articles"]
        c.owner_condition = m["condition"]
        c.owner_condition_note = m["condition_note"]

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
            f"OR c.title ILIKE ${i} "
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
            c.id, c.group_id, c.owner_kind, c.owner_id, c.title, c.created_at,
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
              AND mime NOT LIKE 'video/%'
            ORDER BY position ASC
            LIMIT 1
        ) first_photo ON true
        {where_sql}
        GROUP BY c.id, g.name, p_meta.name, p_meta.articles, first_photo.s3_key
        {having}
        -- c.title/c.owner_kind/c.owner_id are functionally dependent on c.id (PK),
        -- so they need no explicit GROUP BY entry.
        ORDER BY {order}
        LIMIT ${len(params)}
    """
    rows = await pool().fetch(sql, *params)

    collages = [
        Collage(
            id=r["id"],
            group_id=r["group_id"],
            owner_kind=r["owner_kind"],
            owner_id=r["owner_id"],
            title=r["title"],
            created_at=r["created_at"],
            photos_count=r["photos_count"],
            first_photo_url=public_url(r["first_key"]) if r["first_key"] else None,
            owner_name=r["owner_name"],
            owner_articles=list(r["owner_articles"] or []),
            group_name=r["group_name"],
        )
        for r in rows
    ]
    await _enrich_instances(collages)
    return collages


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
    # Enforce the group's configured owner_kind — no silent fallback. This is
    # what stops smart_part collages from landing in instance groups.
    cfg = gconfig.get(payload.group_id)
    if cfg is None or cfg.studio_role == "none":
        raise HTTPException(422, "group is not configured for collage creation")

    title = payload.title.strip() if payload.title else None
    if cfg.title_required and not title:
        raise HTTPException(422, "title is required for this group")

    owner_kind = payload.owner_kind
    owner_id = payload.owner_id
    if (cfg.owner_optional or cfg.owner_free) and not owner_id:
        # Library: binding is optional — an unbound collage is fine.
        owner_kind = None
        owner_id = None
    elif cfg.owner_free:
        # Library with a binding: owner may be EITHER a smart_part OR an instance,
        # validated existence-only (the binding is just a label).
        if owner_kind not in ("smart_part", "instance"):
            raise HTTPException(
                422, f"owner_kind must be 'smart_part' or 'instance', got {owner_kind!r}"
            )
        await validate_owner_exists(owner_kind, owner_id, payload.group_id, strict=False)
    else:
        # Every other group: owner is mandatory and must match the group's kind.
        if owner_kind != cfg.owner_kind:
            raise HTTPException(
                422,
                f"group expects owner_kind={cfg.owner_kind!r}, got {owner_kind!r}",
            )
        if not owner_id:
            raise HTTPException(422, "owner_id is required for this group")
        await validate_owner_exists(owner_kind, owner_id, payload.group_id)

    try:
        row = await pool().fetchrow(
            """
            INSERT INTO photo_collages (group_id, owner_kind, owner_id, title)
            VALUES ($1, $2, $3, $4)
            RETURNING id, group_id, owner_kind, owner_id, title, created_at
            """,
            payload.group_id, owner_kind, owner_id, title,
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
            c.id, c.group_id, c.owner_kind, c.owner_id, c.title,
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
        WHERE collage_id = $1
          AND (state IN ('uploaded', 'failed')
               OR (state = 'pending' AND mime LIKE 'video/%'))
        ORDER BY position ASC
        """,
        collage_id,
    )

    photos = [
        Photo(**dict(r), url=public_url(r["s3_key"])) for r in photo_rows
    ]
    detail = CollageDetail(
        id=head["id"],
        group_id=head["group_id"],
        group_name=head["group_name"],
        owner_kind=head["owner_kind"],
        owner_id=head["owner_id"],
        title=head["title"],
        owner_name=head["owner_name"],
        owner_articles=list(head["owner_articles"] or []),
        photos=photos,
    )
    if detail.owner_kind == "instance":
        meta = await _instance_owner_meta([detail.owner_id])
        m = meta.get(detail.owner_id)
        if m:
            detail.owner_name = m["name"]
            detail.owner_articles = m["articles"]
            detail.owner_condition = m["condition"]
            detail.owner_condition_note = m["condition_note"]
    return detail


@router.get("/collages/{collage_id}/move-targets", response_model=list[MoveTarget])
async def list_collage_move_targets(collage_id: UUID) -> list[MoveTarget]:
    """Publication channels this collage's raw photos may be physically moved
    into — narrowed to the ones the bound item's condition actually fits.
    personal/defect collages route to «На публикацию»; a new collage gets none
    (new is published only as a smart reference via «Эталонные»)."""
    head = await pool().fetchrow(
        "SELECT group_id, owner_kind, owner_id FROM photo_collages WHERE id = $1",
        collage_id,
    )
    if head is None:
        raise HTTPException(404, "Collage not found")

    candidates = gconfig.direct_move_targets(head["group_id"])
    if not candidates:
        return []

    # Instance collage: keep only targets whose condition_filter the item matches.
    if head["owner_kind"] == "instance" and head["owner_id"]:
        try:
            item_id = int(head["owner_id"])
        except (TypeError, ValueError):
            item_id = None
        cond = (
            await pool().fetchval(
                "SELECT condition FROM uchet_ext.items WHERE id = $1", item_id
            )
            if item_id is not None
            else None
        )
        if cond is not None:
            candidates = [
                t for t in candidates
                if (cfg := gconfig.get(t)) is not None
                and gconfig.condition_allowed(cond, cfg.condition_filter)
            ]

    if not candidates:
        return []
    rows = await pool().fetch(
        "SELECT id, name FROM photo_groups WHERE id = ANY($1::uuid[]) ORDER BY position ASC",
        candidates,
    )
    return [MoveTarget(id=r["id"], name=r["name"]) for r in rows]


@router.post("/collages/{collage_id}/transfer", response_model=list[Photo])
async def transfer_collage_photos(
    collage_id: UUID, payload: CollageTransferRequest
) -> list[Photo]:
    """Physically move raw photos from this collage into a publication channel.

    Move semantics (not copy): the same `photos` rows are repointed to the
    target collage, their objects relocated in MinIO, and nothing is left in the
    source. No Studio generation — this publishes the real photo as-is. Allowed
    routes are the strict pairs in `gconfig.DIRECT_MOVE_TARGETS`.
    """
    src = await pool().fetchrow(
        "SELECT id, group_id, owner_kind, owner_id FROM photo_collages WHERE id = $1",
        collage_id,
    )
    if src is None:
        raise HTTPException(404, "Collage not found")

    source_group_id: UUID = src["group_id"]
    target_group_id = payload.target_group_id
    if not gconfig.is_direct_move_allowed(source_group_id, target_group_id):
        raise HTTPException(
            400, "Move not allowed: this source→target pair is not a direct-move route"
        )

    tgt_cfg = gconfig.get(target_group_id)
    if tgt_cfg is None:  # defensive — mapping and config must agree
        raise HTTPException(400, "target group is not configured")
    if src["owner_kind"] != tgt_cfg.owner_kind:
        raise HTTPException(400, "owner_kind mismatch between source and target groups")

    owner_id: str = src["owner_id"]

    # Validate the bound physical item (our direct-move pairs are all instance).
    if tgt_cfg.owner_kind == "instance":
        try:
            item_id = int(owner_id)
        except (TypeError, ValueError):
            raise HTTPException(400, f"owner_id {owner_id!r} is not an item id")
        item = await pool().fetchrow(
            "SELECT id, condition, status FROM uchet_ext.items WHERE id = $1", item_id
        )
        if item is None:
            raise HTTPException(404, f"item {item_id} not found in parts_uchet")
        if item["status"] != "in_stock":
            raise HTTPException(
                400, f"item {item_id} status={item['status']!r}, not in_stock"
            )
        gconfig.assert_item_condition_allowed(item["condition"], target_group_id)

    # De-dup while preserving the requested order.
    photo_ids = list(dict.fromkeys(payload.photo_ids))

    moved: list[Photo] = []
    old_keys: list[str] = []

    async with pool().acquire() as conn:
        async with conn.transaction():
            # Lock the target (group, owner) slot — serializes find-or-create of
            # the target collage and the MAX(position)+1 assignment, the same
            # pattern uploads and Studio transfer use.
            await conn.execute(
                "SELECT pg_advisory_xact_lock(hashtextextended($1::text, 0))",
                f"{target_group_id}:{owner_id}",
            )

            # Re-read under the lock: the photos must still live in THIS collage
            # and be uploaded. Guards double-submit and concurrent moves.
            rows = await conn.fetch(
                """
                SELECT id, s3_key, mime FROM photos
                WHERE id = ANY($1::uuid[]) AND collage_id = $2 AND state = 'uploaded'
                """,
                photo_ids, collage_id,
            )
            by_id = {r["id"]: r for r in rows}
            missing = [str(p) for p in photo_ids if p not in by_id]
            if missing:
                raise HTTPException(
                    409,
                    "Photos not in this collage / not uploaded (already moved?): "
                    + ", ".join(missing),
                )
            videos = [str(r["id"]) for r in rows if (r["mime"] or "").startswith("video/")]
            if videos:
                raise HTTPException(
                    400, "Видео нельзя переносить на публикацию: " + ", ".join(videos)
                )

            target = await conn.fetchrow(
                """
                SELECT id, group_id FROM photo_collages
                WHERE group_id = $1 AND owner_kind = $2 AND owner_id = $3
                """,
                target_group_id, tgt_cfg.owner_kind, owner_id,
            )
            if target is None:
                target = await conn.fetchrow(
                    """
                    INSERT INTO photo_collages (group_id, owner_kind, owner_id)
                    VALUES ($1, $2, $3)
                    RETURNING id, group_id
                    """,
                    target_group_id, tgt_cfg.owner_kind, owner_id,
                )
            target_collage_id = target["id"]

            next_pos = await conn.fetchval(
                "SELECT COALESCE(MAX(position) + 1, 1) FROM photos "
                "WHERE collage_id = $1 AND state <> 'deleted'",
                target_collage_id,
            )

            for pid in photo_ids:
                old_key = by_id[pid]["s3_key"]
                tail = old_key.rsplit("/", 1)[-1]
                ext = tail.rsplit(".", 1)[-1] if "." in tail else "jpg"
                new_key = (
                    f"groups/{target['group_id']}/collages/{target_collage_id}/{pid}.{ext}"
                )
                # Copy first; the old object stays until after commit so a
                # rollback never strands a row pointing at a deleted object.
                try:
                    copy_within_photos(old_key, new_key)
                except Exception as exc:
                    raise HTTPException(500, f"Failed to copy object: {exc}") from exc

                row = await conn.fetchrow(
                    """
                    UPDATE photos
                       SET collage_id = $1, s3_key = $2, position = $3
                     WHERE id = $4
                    RETURNING id, collage_id, position, s3_key, mime, size_bytes,
                              state, uploaded_at, created_at
                    """,
                    target_collage_id, new_key, next_pos, pid,
                )
                next_pos += 1
                old_keys.append(old_key)
                moved.append(Photo(**dict(row), url=public_url(row["s3_key"])))

    # Rows now point at the new keys — drop the originals (best-effort).
    for k in old_keys:
        delete_photos_object(k)

    return moved


@router.delete("/collages/{collage_id}", status_code=204)
async def delete_collage(collage_id: UUID) -> None:
    head = await pool().fetchrow(
        "SELECT group_id FROM photo_collages WHERE id = $1", collage_id
    )
    if head is None:
        raise HTTPException(404, "Collage not found")
    await pool().execute("DELETE FROM photo_collages WHERE id = $1", collage_id)
    # Nuke MinIO files under this collage (DB cascade dropped the photo rows).
    from ..studio.storage import delete_photos_prefix
    delete_photos_prefix(f"groups/{head['group_id']}/collages/{collage_id}/")

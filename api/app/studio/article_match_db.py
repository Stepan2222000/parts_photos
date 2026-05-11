"""Article matching: filename → smart_part → items grouped by Studio target group.

Pipeline:
1. normalize filename stem
2. find smart_part in smart_ext.parts whose id or any article matches
3. fetch all in_stock items for that smart_part
4. for each Studio target group apply its defect_filter, look up existing
   instance collages

Returns the structure stored in studio_jobs.suggested_collages_json and used
by the new transfer/lookup endpoints.
"""
from __future__ import annotations

from typing import TYPE_CHECKING

from studio_core.article_match import normalize_filename_stem

from . import groups as gconfig

if TYPE_CHECKING:
    import asyncpg


_PART_QUERY = """
SELECT id, name, articles
FROM smart_ext.parts
WHERE regexp_replace(lower(id), '[^a-z0-9]+', '', 'g') = $1
   OR EXISTS (
       SELECT 1 FROM unnest(articles) a
       WHERE regexp_replace(lower(a), '[^a-z0-9]+', '', 'g') = $1
   )
LIMIT 1
"""

_ITEMS_QUERY = """
SELECT id, defect, defect_note
FROM uchet_ext.items
WHERE smart_part_id = $1 AND status = 'in_stock'
ORDER BY id ASC
"""

_EXISTING_COLLAGES_QUERY = """
SELECT group_id, owner_id, id
FROM photo_collages
WHERE owner_kind = 'instance'
  AND group_id = ANY($1::uuid[])
  AND owner_id = ANY($2::text[])
"""


async def find_matches(
    filename: str | None, conn: "asyncpg.Connection"
) -> dict | None:
    """Return suggestion structure for a job, or None if no match.

    Shape:
    {
      "smart_part_id": "smart_10000090",
      "smart_part_name": "Водяной насос",
      "matched_article": "ABC-123",
      "items_by_group": {
         "<group_uuid>": [
            {"item_id": 412, "defect": false, "defect_note": null,
             "existing_collage_id": "uuid|null"}
         ]
      }
    }
    """
    if not filename:
        return None
    norm = normalize_filename_stem(filename)
    if not norm:
        return None

    part = await conn.fetchrow(_PART_QUERY, norm)
    if part is None:
        return None

    smart_part_id = part["id"]
    matched = smart_part_id
    for a in (part["articles"] or []):
        from studio_core.article_match import normalize_article
        if normalize_article(a) == norm:
            matched = a
            break

    items = await conn.fetch(_ITEMS_QUERY, smart_part_id)
    if not items:
        return {
            "smart_part_id": smart_part_id,
            "smart_part_name": part["name"],
            "matched_article": matched,
            "items_by_group": {},
        }

    targets = gconfig.studio_targets()
    item_ids_text = [str(r["id"]) for r in items]

    existing_rows = await conn.fetch(
        _EXISTING_COLLAGES_QUERY, targets, item_ids_text
    )
    existing: dict[tuple[str, str], str] = {
        (str(r["group_id"]), r["owner_id"]): str(r["id"]) for r in existing_rows
    }

    items_by_group: dict[str, list[dict]] = {}
    for gid in targets:
        cfg = gconfig.get(gid)
        if cfg is None:
            continue
        bucket: list[dict] = []
        for r in items:
            if cfg.defect_filter == "with" and not r["defect"]:
                continue
            if cfg.defect_filter == "without" and r["defect"]:
                continue
            bucket.append({
                "item_id": r["id"],
                "defect": r["defect"],
                "defect_note": r["defect_note"],
                "existing_collage_id": existing.get((str(gid), str(r["id"]))),
            })
        items_by_group[str(gid)] = bucket

    return {
        "smart_part_id": smart_part_id,
        "smart_part_name": part["name"],
        "matched_article": matched,
        "items_by_group": items_by_group,
    }


async def items_for_part(
    smart_part_id: str, group_id, conn: "asyncpg.Connection"
) -> list[dict]:
    """Manual lookup: items for a chosen smart_part filtered by one target group's
    defect_filter. Used by GET /studio/lookup."""
    from uuid import UUID
    if not isinstance(group_id, UUID):
        group_id = UUID(str(group_id))
    cfg = gconfig.get(group_id)
    if cfg is None or cfg.studio_role != "target":
        return []
    items = await conn.fetch(_ITEMS_QUERY, smart_part_id)
    if not items:
        return []
    item_ids_text = [str(r["id"]) for r in items]
    existing_rows = await conn.fetch(
        _EXISTING_COLLAGES_QUERY, [group_id], item_ids_text
    )
    existing = {r["owner_id"]: str(r["id"]) for r in existing_rows}
    out: list[dict] = []
    for r in items:
        if cfg.defect_filter == "with" and not r["defect"]:
            continue
        if cfg.defect_filter == "without" and r["defect"]:
            continue
        out.append({
            "item_id": r["id"],
            "defect": r["defect"],
            "defect_note": r["defect_note"],
            "existing_collage_id": existing.get(str(r["id"])),
        })
    return out

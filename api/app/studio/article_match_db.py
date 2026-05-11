"""Article matching: filename or source-collage → smart_part → suggestions per
Studio target group.

Each target group is either smart_part-owned (Эталонные, Avito 2-й) or
instance-owned (Реальные/Дефектные на публикацию). Suggestions are shaped
accordingly:

  {
    "smart_part_id": "smart_10000094",
    "smart_part_name": "Подшипник…",
    "matched_article": "805079T",
    "source_kind": "filename" | "source_collage",
    "by_group": {
      "<group_uuid>": {"kind": "smart_part", "existing_collage_id": uuid|null},
      "<group_uuid>": {
        "kind": "instance",
        "items": [{"item_id": int, "defect": bool, "defect_note": str|null,
                   "existing_collage_id": uuid|null}]
      }
    }
  }
"""
from __future__ import annotations

from typing import TYPE_CHECKING
from uuid import UUID

from studio_core.article_match import normalize_article, normalize_filename_stem

from . import groups as gconfig

if TYPE_CHECKING:
    import asyncpg


_PART_BY_FILENAME = """
SELECT id, name, articles
FROM smart_ext.parts
WHERE regexp_replace(lower(id), '[^a-z0-9]+', '', 'g') = $1
   OR EXISTS (
       SELECT 1 FROM unnest(articles) a
       WHERE regexp_replace(lower(a), '[^a-z0-9]+', '', 'g') = $1
   )
LIMIT 1
"""

_PART_BY_ID = """
SELECT id, name, articles
FROM smart_ext.parts
WHERE id = $1
"""

_ITEM_BY_ID = "SELECT id, smart_part_id FROM uchet_ext.items WHERE id = $1"

_ITEMS_FOR_PART = """
SELECT id, defect, defect_note
FROM uchet_ext.items
WHERE smart_part_id = $1 AND status = 'in_stock'
ORDER BY id ASC
"""

_INSTANCE_COLLAGES = """
SELECT group_id, owner_id, id
FROM photo_collages
WHERE owner_kind = 'instance'
  AND group_id = ANY($1::uuid[])
  AND owner_id = ANY($2::text[])
"""

_SMART_COLLAGES = """
SELECT group_id, id
FROM photo_collages
WHERE owner_kind = 'smart_part'
  AND owner_id = $1
  AND group_id = ANY($2::uuid[])
"""


async def _resolve_smart_part_from_source(
    source_collage_id: UUID, conn: "asyncpg.Connection"
) -> tuple[str, str, str | None] | None:
    """For source_kind=collage_photo: derive smart_part_id from the source collage.

    Returns (smart_part_id, matched_label, smart_part_name) or None.
    """
    row = await conn.fetchrow(
        "SELECT owner_kind, owner_id FROM photo_collages WHERE id = $1",
        source_collage_id,
    )
    if row is None:
        return None
    if row["owner_kind"] == "smart_part":
        smart_id = row["owner_id"]
    elif row["owner_kind"] == "instance":
        try:
            item_id = int(row["owner_id"])
        except ValueError:
            return None
        item = await conn.fetchrow(_ITEM_BY_ID, item_id)
        if item is None:
            return None
        smart_id = item["smart_part_id"]
    else:
        return None
    part = await conn.fetchrow(_PART_BY_ID, smart_id)
    name = part["name"] if part else None
    return smart_id, smart_id, name


async def _build_by_group(
    smart_part_id: str, conn: "asyncpg.Connection"
) -> dict[str, dict]:
    """For each Studio target group, build its slot in the suggestion structure."""
    targets = gconfig.studio_targets()
    if not targets:
        return {}

    smart_targets = [g for g in targets if gconfig.GROUP_SETTINGS[g].owner_kind == "smart_part"]
    instance_targets = [g for g in targets if gconfig.GROUP_SETTINGS[g].owner_kind == "instance"]

    smart_existing: dict[str, str] = {}
    if smart_targets:
        rows = await conn.fetch(_SMART_COLLAGES, smart_part_id, smart_targets)
        smart_existing = {str(r["group_id"]): str(r["id"]) for r in rows}

    items: list = []
    if instance_targets:
        items = await conn.fetch(_ITEMS_FOR_PART, smart_part_id)

    instance_existing: dict[tuple[str, str], str] = {}
    if instance_targets and items:
        item_ids_text = [str(r["id"]) for r in items]
        rows = await conn.fetch(_INSTANCE_COLLAGES, instance_targets, item_ids_text)
        instance_existing = {(str(r["group_id"]), r["owner_id"]): str(r["id"]) for r in rows}

    by_group: dict[str, dict] = {}
    for gid in smart_targets:
        by_group[str(gid)] = {
            "kind": "smart_part",
            "existing_collage_id": smart_existing.get(str(gid)),
        }
    for gid in instance_targets:
        cfg = gconfig.GROUP_SETTINGS[gid]
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
                "existing_collage_id": instance_existing.get((str(gid), str(r["id"]))),
            })
        by_group[str(gid)] = {"kind": "instance", "items": bucket}
    return by_group


async def find_matches(
    filename: str | None,
    source_collage_id: UUID | None,
    conn: "asyncpg.Connection",
) -> dict | None:
    """Return suggestion structure for a job, or None if no smart_part resolved.

    For `source_collage_id` jobs (Studio source = collage_photo), the smart_part
    is inherited from the source collage. Otherwise we try to match the
    filename's normalized stem against smart.parts (id or any article).
    """
    smart_part_id: str | None = None
    smart_part_name: str | None = None
    matched: str = ""
    source_kind: str = "filename"

    if source_collage_id is not None:
        resolved = await _resolve_smart_part_from_source(source_collage_id, conn)
        if resolved is not None:
            smart_part_id, matched, smart_part_name = resolved
            source_kind = "source_collage"

    if smart_part_id is None and filename:
        norm = normalize_filename_stem(filename)
        if norm:
            part = await conn.fetchrow(_PART_BY_FILENAME, norm)
            if part is not None:
                smart_part_id = part["id"]
                smart_part_name = part["name"]
                matched = smart_part_id
                for a in (part["articles"] or []):
                    if normalize_article(a) == norm:
                        matched = a
                        break

    if smart_part_id is None:
        return None

    by_group = await _build_by_group(smart_part_id, conn)
    return {
        "smart_part_id": smart_part_id,
        "smart_part_name": smart_part_name,
        "matched_article": matched,
        "source_kind": source_kind,
        "by_group": by_group,
    }


async def items_for_part(
    smart_part_id: str, group_id: UUID, conn: "asyncpg.Connection"
) -> list[dict]:
    """Manual lookup endpoint helper. Returns the same per-group bucket the
    suggestion would have for the given (smart_part, group)."""
    cfg = gconfig.get(group_id)
    if cfg is None or cfg.studio_role != "target":
        return []
    if cfg.owner_kind == "smart_part":
        # No items for smart_part targets — caller decides what to do.
        return []
    items = await conn.fetch(_ITEMS_FOR_PART, smart_part_id)
    if not items:
        return []
    item_ids_text = [str(r["id"]) for r in items]
    rows = await conn.fetch(_INSTANCE_COLLAGES, [group_id], item_ids_text)
    existing = {r["owner_id"]: str(r["id"]) for r in rows}
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


async def smart_collage_for_part(
    smart_part_id: str, group_id: UUID, conn: "asyncpg.Connection"
) -> str | None:
    """Lookup endpoint helper for smart_part targets. Returns the existing
    collage id (str) or None if it would have to be created."""
    rows = await conn.fetch(_SMART_COLLAGES, smart_part_id, [group_id])
    return str(rows[0]["id"]) if rows else None

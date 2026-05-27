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
        "items": [{"item_id": int, "condition": str, "condition_note": str|null,
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
SELECT id, condition, condition_note
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
            if not gconfig.condition_allowed(r["condition"], cfg.condition_filter):
                continue
            bucket.append({
                "item_id": r["id"],
                "condition": r["condition"],
                "condition_note": r["condition_note"],
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
        if not gconfig.condition_allowed(r["condition"], cfg.condition_filter):
            continue
        out.append({
            "item_id": r["id"],
            "condition": r["condition"],
            "condition_note": r["condition_note"],
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


# ── Unified item search for the manual instance-collage picker ───────────────

_PARTS_BY_TEXT = """
SELECT id, name, articles
FROM smart_ext.parts
WHERE id ILIKE $1
   OR name ILIKE $1
   OR EXISTS (SELECT 1 FROM unnest(articles) a WHERE a ILIKE $1)
ORDER BY (id = $2)::int DESC, name ASC
LIMIT $3
"""

_PARTS_BY_IDS = (
    "SELECT id, name, articles FROM smart_ext.parts WHERE id = ANY($1::text[])"
)

_ITEMS_FOR_PARTS = """
SELECT id, smart_part_id, condition, condition_note, status
FROM uchet_ext.items
WHERE smart_part_id = ANY($1::text[]) AND status = 'in_stock'
"""

_ITEM_FULL_BY_ID = """
SELECT id, smart_part_id, condition, condition_note, status
FROM uchet_ext.items
WHERE id = $1
"""

_INSTANCE_COLLAGES_ONE_GROUP = """
SELECT owner_id, id
FROM photo_collages
WHERE owner_kind = 'instance' AND group_id = $1 AND owner_id = ANY($2::text[])
"""

_PART_LIMIT = 80
_ITEM_LIMIT = 30


def _best_article(q: str, articles: list[str]) -> str | None:
    if not articles:
        return None
    ql = q.lower().strip()
    for a in articles:
        if a.lower() == ql:
            return a
    for a in articles:
        if a.lower().startswith(ql):
            return a
    return articles[0]


def _rank(q: str, q_int: int | None, item_id: int, smart_id: str,
          name: str | None, articles: list[str]) -> int:
    """0=exact item id, 1=exact article, 2=prefix smart/name/article, 3=contains."""
    ql = q.lower().strip()
    if q_int is not None and item_id == q_int:
        return 0
    if any(a.lower() == ql for a in articles):
        return 1
    if (smart_id.lower().startswith(ql)
            or (name and name.lower().startswith(ql))
            or any(a.lower().startswith(ql) for a in articles)):
        return 2
    return 3


async def search_items(
    q: str, group_id: UUID, conn: "asyncpg.Connection", limit: int = _ITEM_LIMIT
) -> tuple[int, list[dict]]:
    """Unified item search for an instance group's manual picker.

    Returns (parts_matched, ranked_results). Two foreign servers are never
    joined in one SQL — items and parts are fetched separately and stitched.

    - text path (smart-id / name / article): only eligible items
      (in_stock + passes condition_filter) are returned;
    - id path (q is an integer): the exact item is always returned, flagged with
      `selectable`/`block_reason`, so the UI can show *why* it can't be picked.
    """
    cfg = gconfig.get(group_id)
    if cfg is None:
        return 0, []

    def passes(condition: str) -> bool:
        return gconfig.condition_allowed(condition, cfg.condition_filter)

    pattern = f"%{q}%"
    part_rows = await conn.fetch(_PARTS_BY_TEXT, pattern, q, _PART_LIMIT)
    part_map = {r["id"]: r for r in part_rows}
    parts_matched = len(part_map)

    text_items: list = []
    if part_map:
        text_items = await conn.fetch(_ITEMS_FOR_PARTS, list(part_map.keys()))

    q_int: int | None = None
    qs = q.strip()
    if qs.isdigit():
        try:
            q_int = int(qs)
        except ValueError:
            q_int = None

    id_item = None
    if q_int is not None:
        id_item = await conn.fetchrow(_ITEM_FULL_BY_ID, q_int)

    # Candidate set: eligible text items + the exact-id item (always).
    candidates: dict[int, dict] = {}
    for it in text_items:
        if passes(it["condition"]):
            candidates[it["id"]] = dict(it)
    if id_item is not None:
        candidates[id_item["id"]] = dict(id_item)

    if not candidates:
        return parts_matched, []

    # Pull smart meta for any candidate part not already loaded (the id item's).
    missing = {
        c["smart_part_id"] for c in candidates.values()
        if c["smart_part_id"] and c["smart_part_id"] not in part_map
    }
    if missing:
        for r in await conn.fetch(_PARTS_BY_IDS, list(missing)):
            part_map[r["id"]] = r

    item_ids_text = [str(i) for i in candidates]
    ex_rows = await conn.fetch(_INSTANCE_COLLAGES_ONE_GROUP, group_id, item_ids_text)
    existing = {r["owner_id"]: str(r["id"]) for r in ex_rows}

    results: list[dict] = []
    for iid, it in candidates.items():
        part = part_map.get(it["smart_part_id"])
        name = part["name"] if part else None
        articles = list(part["articles"] or []) if part else []
        in_stock = it["status"] == "in_stock"
        pf = passes(it["condition"])
        selectable = in_stock and pf
        block = None
        if not in_stock:
            block = "нет на складе"
        elif not pf:
            if cfg.condition_filter == "personal":
                block = "нужен personal"
            elif cfg.condition_filter == "defect":
                block = "нужен defect"
            elif cfg.condition_filter == "not_defect":
                block = "дефектные сюда нельзя"
            else:
                block = "состояние не подходит"
        results.append({
            "item_id": iid,
            "smart_part_id": it["smart_part_id"],
            "smart_part_name": name,
            "article": _best_article(q, articles),
            "condition": it["condition"],
            "condition_note": it["condition_note"],
            "status": it["status"],
            "in_stock": in_stock,
            "passes_filter": pf,
            "selectable": selectable,
            "block_reason": block,
            "existing_collage_id": existing.get(str(iid)),
            "_score": _rank(q, q_int, iid, it["smart_part_id"], name, articles),
        })

    results.sort(key=lambda r: (r["_score"], r["item_id"]))
    for r in results:
        r.pop("_score", None)
    return parts_matched, results[:limit]

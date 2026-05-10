"""DB-backed article matching: filename stem → list of matching collages."""
from __future__ import annotations

from typing import TYPE_CHECKING

from studio_core.article_match import normalize_article, normalize_filename_stem

if TYPE_CHECKING:
    import asyncpg

# Compares normalized stem against normalized owner_id and every normalized
# article in the joined smart_ext.parts row. Both sides go through the same
# regex, so dashes/spaces/case differences don't matter.
_MATCH_QUERY = """
SELECT
    c.id AS collage_id,
    c.group_id,
    c.owner_id,
    p_meta.name AS owner_name,
    p_meta.articles AS owner_articles
FROM photo_collages c
LEFT JOIN smart_ext.parts p_meta
       ON c.owner_kind = 'smart_part' AND p_meta.id = c.owner_id
WHERE
    regexp_replace(lower(c.owner_id), '[^a-z0-9]+', '', 'g') = $1
    OR (
        p_meta.articles IS NOT NULL
        AND EXISTS (
            SELECT 1 FROM unnest(p_meta.articles) a
            WHERE regexp_replace(lower(a), '[^a-z0-9]+', '', 'g') = $1
        )
    )
LIMIT 10
"""


async def find_matches(filename: str | None, conn: "asyncpg.Connection") -> list[dict]:
    if not filename:
        return []
    norm = normalize_filename_stem(filename)
    if not norm:
        return []
    rows = await conn.fetch(_MATCH_QUERY, norm)
    out: list[dict] = []
    for r in rows:
        articles = list(r["owner_articles"] or [])
        matched = next((a for a in articles if normalize_article(a) == norm), r["owner_id"])
        out.append(
            {
                "collage_id": str(r["collage_id"]),
                "group_id": str(r["group_id"]),
                "owner_id": r["owner_id"],
                "owner_name": r["owner_name"],
                "matched_article": matched,
            }
        )
    return out

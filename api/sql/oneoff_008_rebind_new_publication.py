"""One-off data re-bind (run manually, NOT part of the deploy SQL loop).

Context: «Реальные на публикацию» becomes «На публикацию» with condition_filter
'not_new' — new items may no longer live there. Two legacy new-item collages
were in that channel:

  - item #246 (collage 53586755…): already has a source collage AND an etalon →
    just delete this publication collage (+ its S3 objects).
  - item #222 (collage d1b35cac…): move its photos into a NEW «Эталонные»
    smart_part collage for smart_10000077 (no etalon existed), then delete the
    empty publication collage.

S3 objects are relocated (copy → repoint → delete old), mirroring the transfer
flow. Idempotent-ish: re-running after success is a no-op (collages already
gone). Run once with: api/.venv/bin/python -m api.sql.oneoff_008... — or paste
into a python -c against the app package. Requires .env (PG_DSN + MinIO).
"""
from __future__ import annotations

import asyncio

from app.db import init_pool, close_pool, pool
from app.studio.storage import (
    copy_within_photos,
    delete_photos_object,
    delete_photos_prefix,
)

PUB = "3cf67240-7597-451a-8ec1-fb097afdeb88"      # Реальные на публикацию → На публикацию
ETALON = "ae697d8d-e803-42c4-9982-ecefbf8a8cdf"   # Эталонные на публикацию
C246 = "53586755-1d56-4c62-85ab-cb399058f719"     # item #246 — delete
C222 = "d1b35cac-b363-4686-9f1f-04a96ebeb521"     # item #222 — move to etalon
SMART222 = "smart_10000077"


async def main() -> None:
    await init_pool()
    try:
        # --- #246: drop the redundant publication collage entirely ---
        if await pool().fetchval("SELECT 1 FROM photo_collages WHERE id=$1", C246):
            delete_photos_prefix(f"groups/{PUB}/collages/{C246}/")
            await pool().execute("DELETE FROM photo_collages WHERE id=$1", C246)
            print(f"#246: deleted publication collage {C246} + S3 prefix")
        else:
            print(f"#246: collage {C246} already gone — skip")

        # --- #222: move photos into a new «Эталонные» smart_part collage ---
        if await pool().fetchval("SELECT 1 FROM photo_collages WHERE id=$1", C222):
            old_keys: list[str] = []
            async with pool().acquire() as conn:
                async with conn.transaction():
                    # Find-or-create (the unique index is partial, so ON CONFLICT
                    # inference doesn't apply — a plain lookup-then-insert is used).
                    et = await conn.fetchrow(
                        "SELECT id FROM photo_collages "
                        "WHERE group_id=$1 AND owner_kind='smart_part' AND owner_id=$2",
                        ETALON, SMART222,
                    )
                    if et is None:
                        et = await conn.fetchrow(
                            "INSERT INTO photo_collages (group_id, owner_kind, owner_id) "
                            "VALUES ($1, 'smart_part', $2) RETURNING id",
                            ETALON, SMART222,
                        )
                    eid = et["id"]
                    pos = await conn.fetchval(
                        "SELECT COALESCE(MAX(position), 0) FROM photos "
                        "WHERE collage_id=$1 AND state<>'deleted'",
                        eid,
                    )
                    photos = await conn.fetch(
                        "SELECT id, s3_key FROM photos WHERE collage_id=$1 "
                        "AND state='uploaded' ORDER BY position",
                        C222,
                    )
                    for p in photos:
                        pos += 1
                        ext = p["s3_key"].rsplit(".", 1)[-1]
                        new_key = f"groups/{ETALON}/collages/{eid}/{p['id']}.{ext}"
                        copy_within_photos(p["s3_key"], new_key)  # copy first
                        await conn.execute(
                            "UPDATE photos SET collage_id=$1, s3_key=$2, position=$3 WHERE id=$4",
                            eid, new_key, pos, p["id"],
                        )
                        old_keys.append(p["s3_key"])
                    # the publication collage is now empty of uploaded photos
                    await conn.execute("DELETE FROM photo_collages WHERE id=$1", C222)
            for k in old_keys:
                delete_photos_object(k)
            print(f"#222: moved {len(old_keys)} photos to etalon {eid} (smart_10000077), "
                  f"deleted publication collage {C222}")
        else:
            print(f"#222: collage {C222} already gone — skip")
    finally:
        await close_pool()


if __name__ == "__main__":
    asyncio.run(main())

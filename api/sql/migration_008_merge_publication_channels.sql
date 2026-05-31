-- Merge the publication channels into one.
--
-- «Реальные на публикацию» becomes the single publication channel «На
-- публикацию», accepting personal AND defect items (config-as-code:
-- condition_filter='not_new' in studio/groups.py) — but NOT new (new is
-- published only as a smart reference via «Эталонные»). The dedicated
-- «Дефектные на публикацию» channel is retired (it was empty).
--
-- Two legacy new-item collages that lived in the channel were re-bound first by
-- a one-off data script (api/sql/oneoff_008_rebind_new_publication.py): item
-- #246 deleted, item #222 moved into a new «Эталонные» collage. After that the
-- channel held only personal items, consistent with not_new.
--
-- Apply order: after migration_007_merge_defect_into_real.sql.

BEGIN;

-- Rename the channel (DB name is what the UI shows).
UPDATE photo_groups
SET name = 'На публикацию', updated_at = now()
WHERE id = '3cf67240-7597-451a-8ec1-fb097afdeb88'
  AND name <> 'На публикацию';

-- Retire the empty defect publication channel. Guarded: if anything was created
-- there in the meantime, the DELETE is a no-op (no silent cascade).
DELETE FROM photo_groups
WHERE id = 'a1790194-efa0-4dda-bed4-d8bc15b3b624'
  AND NOT EXISTS (
      SELECT 1 FROM photo_collages
      WHERE group_id = 'a1790194-efa0-4dda-bed4-d8bc15b3b624'
  );

COMMIT;

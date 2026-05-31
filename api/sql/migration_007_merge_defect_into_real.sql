-- Merge the defect source group into «Реальные фотографии».
--
-- «Реальные фотографии» now accepts ANY item condition (config-as-code:
-- condition_filter='any' in studio/groups.py); defect/personal/new are told
-- apart by badges in the UI, not by living in separate groups. The dedicated
-- «Дефектные фотографии» source group is therefore retired.
--
-- The «Дефектные на публикацию» *channel* stays — defect collages in «Реальные
-- фотографии» direct-move there (routing by item condition).
--
-- Verified empty (0 collages) before writing this. The guard makes the DELETE a
-- no-op if anything was created in the meantime, so a stray collage is never
-- silently cascaded away — it would just keep the group around (creation
-- already disabled once it leaves GROUP_SETTINGS).
--
-- Apply order: after migration_006_library_collages.sql.

BEGIN;

DELETE FROM photo_groups
WHERE id = 'edce2987-daae-4339-8330-8cb96ad912bf'
  AND NOT EXISTS (
      SELECT 1 FROM photo_collages
      WHERE group_id = 'edce2987-daae-4339-8330-8cb96ad912bf'
  );

COMMIT;

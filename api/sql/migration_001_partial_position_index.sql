-- migration_001: replace UNIQUE(collage_id, position) with a partial index
-- that ignores soft-deleted rows. Without this:
--   - reorder bumps must include deleted rows (else conflict on bump-back)
--   - new uploads can't reuse positions vacated by soft-delete
--   - reorder may strand deleted rows at huge bump-positions
-- Re-runnable via DO block.

DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'photos_collage_id_position_key'
          AND conrelid = 'photos'::regclass
    ) THEN
        ALTER TABLE photos DROP CONSTRAINT photos_collage_id_position_key;
    END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS photos_collage_position_active_key
    ON photos (collage_id, position)
    WHERE state <> 'deleted';

-- Run on main after exporting draft data. Deletes draft rows, restores owner_kind check.
-- Optional: DROP COLUMN note if no longer needed.

DELETE FROM photo_collages WHERE owner_kind = 'draft';

ALTER TABLE photo_collages DROP CONSTRAINT IF EXISTS photo_collages_owner_kind_check;
ALTER TABLE photo_collages ADD CONSTRAINT photo_collages_owner_kind_check
  CHECK (owner_kind = ANY (ARRAY['smart_part'::text, 'instance'::text, 'arrival'::text]));

-- ALTER TABLE photo_collages DROP COLUMN IF EXISTS note;

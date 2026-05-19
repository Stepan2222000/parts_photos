-- Temporary draft collages: free-form note, no item/smart validation.
-- Revert via migration_007 after one-day data collection.

ALTER TABLE photo_collages ADD COLUMN IF NOT EXISTS note text;

ALTER TABLE photo_collages DROP CONSTRAINT IF EXISTS photo_collages_owner_kind_check;
ALTER TABLE photo_collages ADD CONSTRAINT photo_collages_owner_kind_check
  CHECK (owner_kind = ANY (ARRAY['smart_part'::text, 'instance'::text, 'arrival'::text, 'draft'::text]));

COMMENT ON COLUMN photo_collages.note IS 'Free-form label for draft collages (owner_kind=draft); editable until linked to instance';

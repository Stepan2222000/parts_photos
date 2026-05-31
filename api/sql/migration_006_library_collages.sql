-- Studio: free-form collage library bound *optionally* to a smart_part.
--
-- Unlike every other group, the library ("Свободные коллажи") allows MANY
-- collages per smart (and unbound collages with no owner at all). The smart
-- link here is just a label — "what part is this" — not an identity. Each
-- collage instead carries a free-text `title`.
--
-- Apply order: after migration_005_photos_for_publication_condition.sql.
-- Validated against the live schema under a rolled-back transaction before
-- committing this file (null-owner insert, multi-collage-per-smart, and that
-- uniqueness stays enforced in every other group).

BEGIN;

-- The library group. Its UUID is config-as-code (studio/groups.py knows it):
-- a fixed id so GROUP_SETTINGS can reference it. Rename freely from the UI.
INSERT INTO photo_groups (id, name, position)
VALUES (
    '0a7fbbdf-e605-48f1-a320-ca2094a0f32c',
    'Свободные коллажи',
    COALESCE((SELECT MAX(position) + 1 FROM photo_groups), 1)
)
ON CONFLICT (id) DO NOTHING;

-- Optional free-text label. Primary identifier for library collages; NULL for
-- all the owner-identified collages in every other group.
ALTER TABLE photo_collages ADD COLUMN IF NOT EXISTS title text;

-- Owner becomes optional — a library collage may have no smart binding.
-- Every other group still always sets owner_kind/owner_id (enforced by the API).
ALTER TABLE photo_collages ALTER COLUMN owner_kind DROP NOT NULL;
ALTER TABLE photo_collages ALTER COLUMN owner_id   DROP NOT NULL;

-- "One collage per (group, owner)" stays for every group EXCEPT the library.
-- Replace the full UNIQUE constraint with a partial unique index that skips the
-- library group, so it can hold many collages for the same (or no) smart.
ALTER TABLE photo_collages
    DROP CONSTRAINT IF EXISTS photo_collages_group_id_owner_kind_owner_id_key;
CREATE UNIQUE INDEX IF NOT EXISTS photo_collages_owner_unique
    ON photo_collages (group_id, owner_kind, owner_id)
    WHERE group_id <> '0a7fbbdf-e605-48f1-a320-ca2094a0f32c';

COMMIT;

-- Add `position` to photo_groups so the user can reorder channels in the sidebar.
-- Backfill keeps the existing visual order: reference first, then alphabetical.

ALTER TABLE photo_groups
    ADD COLUMN IF NOT EXISTS position int;

WITH ordered AS (
    SELECT id,
           row_number() OVER (ORDER BY is_reference DESC, name ASC) AS rn
    FROM photo_groups
)
UPDATE photo_groups g
SET position = ordered.rn
FROM ordered
WHERE g.id = ordered.id
  AND g.position IS NULL;

ALTER TABLE photo_groups
    ALTER COLUMN position SET NOT NULL,
    ALTER COLUMN position SET DEFAULT 0;

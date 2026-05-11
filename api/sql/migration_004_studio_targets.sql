-- Studio targets reorg: Эталонные becomes a writable target (Studio writes
-- through it), so its read-only flag is dropped. Idempotent.

BEGIN;

UPDATE photo_groups
SET is_reference = false
WHERE id = 'ae697d8d-e803-42c4-9982-ecefbf8a8cdf';

COMMIT;

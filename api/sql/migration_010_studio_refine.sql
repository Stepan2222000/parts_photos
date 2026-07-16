-- Studio refine: iterate on an already generated result with a follow-up
-- prompt (+ optional user reference image). A refine is a child studio_job
-- whose source is the parent's result image.
-- Apply order: after migration_009_photos_source_copy.sql.

BEGIN;

ALTER TABLE studio_jobs
    ADD COLUMN IF NOT EXISTS parent_job_id     uuid REFERENCES studio_jobs(id) ON DELETE CASCADE,
    ADD COLUMN IF NOT EXISTS refine_prompt     text,
    ADD COLUMN IF NOT EXISTS refine_ref_s3_key text;

CREATE INDEX IF NOT EXISTS studio_jobs_parent_idx
    ON studio_jobs(parent_job_id) WHERE parent_job_id IS NOT NULL;

-- New source_kind value for refine jobs.
ALTER TABLE studio_jobs DROP CONSTRAINT IF EXISTS studio_jobs_source_kind_check;
ALTER TABLE studio_jobs ADD CONSTRAINT studio_jobs_source_kind_check
    CHECK (source_kind IN ('upload','collage_photo','refine'));

-- Rollup counts only root jobs: batch total is fixed at creation, so refine
-- versions must not inflate done/failed or flip a finished batch's status.
CREATE OR REPLACE FUNCTION studio_batches_rollup() RETURNS trigger AS $$
DECLARE
    cur record;
    new_status text;
BEGIN
    SELECT
        b.id, b.total,
        COUNT(*) FILTER (WHERE j.status = 'succeeded') AS done_count,
        COUNT(*) FILTER (WHERE j.status = 'failed')    AS failed_count,
        COUNT(*) FILTER (WHERE j.status = 'queued')    AS queued_count,
        COUNT(*) FILTER (WHERE j.status = 'running')   AS running_count
    INTO cur
    FROM studio_batches b
    LEFT JOIN studio_jobs j ON j.batch_id = b.id AND j.parent_job_id IS NULL
    WHERE b.id = COALESCE(NEW.batch_id, OLD.batch_id)
    GROUP BY b.id, b.total;

    IF cur.id IS NULL THEN
        RETURN NEW;
    END IF;

    -- decide aggregate status
    IF cur.queued_count = 0 AND cur.running_count = 0 THEN
        IF cur.failed_count > 0 AND cur.done_count > 0 THEN
            new_status := 'partial';
        ELSIF cur.failed_count > 0 AND cur.done_count = 0 THEN
            new_status := 'failed';
        ELSE
            new_status := 'done';
        END IF;
        UPDATE studio_batches
            SET done = cur.done_count,
                failed = cur.failed_count,
                status = new_status,
                finished_at = COALESCE(finished_at, now())
            WHERE id = cur.id;
    ELSIF cur.running_count > 0 THEN
        UPDATE studio_batches
            SET done = cur.done_count,
                failed = cur.failed_count,
                status = 'running'
            WHERE id = cur.id;
    ELSE
        UPDATE studio_batches
            SET done = cur.done_count,
                failed = cur.failed_count
            WHERE id = cur.id;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

COMMIT;

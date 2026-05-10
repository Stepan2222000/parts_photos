-- Studio: shared library tables, batch + job queue, photo extensions.
-- Apply order: after migration_002_groups_position.sql.

BEGIN;

-- ---------------------------------------------------------------------------
-- Backgrounds library (used by replace_bg option). One MinIO object per row.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS studio_backgrounds (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    name        text NOT NULL,
    s3_key      text NOT NULL UNIQUE,
    width       int,
    height      int,
    size_bytes  int NOT NULL,
    uploaded_at timestamptz NOT NULL DEFAULT now(),
    deleted_at  timestamptz
);
CREATE INDEX IF NOT EXISTS studio_backgrounds_alive_idx
    ON studio_backgrounds (uploaded_at DESC) WHERE deleted_at IS NULL;

-- ---------------------------------------------------------------------------
-- Watermarks library (PNGs, ideally with alpha). Same shape as backgrounds.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS studio_watermarks (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    name        text NOT NULL,
    s3_key      text NOT NULL UNIQUE,
    width       int,
    height      int,
    size_bytes  int NOT NULL,
    uploaded_at timestamptz NOT NULL DEFAULT now(),
    deleted_at  timestamptz
);
CREATE INDEX IF NOT EXISTS studio_watermarks_alive_idx
    ON studio_watermarks (uploaded_at DESC) WHERE deleted_at IS NULL;

-- ---------------------------------------------------------------------------
-- Batch: a single user-initiated run with one set of options.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS studio_batches (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    name            text,
    options_json    jsonb NOT NULL,
    custom_prompt   text,
    background_id   uuid REFERENCES studio_backgrounds(id) ON DELETE SET NULL,
    watermark_id    uuid REFERENCES studio_watermarks(id) ON DELETE SET NULL,
    target_collage_id uuid REFERENCES photo_collages(id) ON DELETE SET NULL,
    status          text NOT NULL DEFAULT 'queued'
        CHECK (status IN ('queued','running','done','partial','failed')),
    total           int NOT NULL DEFAULT 0,
    done            int NOT NULL DEFAULT 0,
    failed          int NOT NULL DEFAULT 0,
    created_at      timestamptz NOT NULL DEFAULT now(),
    finished_at     timestamptz
);
CREATE INDEX IF NOT EXISTS studio_batches_recent_idx
    ON studio_batches (created_at DESC);

-- ---------------------------------------------------------------------------
-- Job: one image to process. Multiple per batch.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS studio_jobs (
    id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    batch_id                 uuid NOT NULL REFERENCES studio_batches(id) ON DELETE CASCADE,
    source_kind              text NOT NULL
        CHECK (source_kind IN ('upload','collage_photo')),
    source_filename          text,
    source_s3_key            text NOT NULL,
    source_photo_id          uuid REFERENCES photos(id) ON DELETE SET NULL,
    status                   text NOT NULL DEFAULT 'queued'
        CHECK (status IN ('queued','running','succeeded','failed')),
    result_s3_key            text,
    result_size_bytes        int,
    log_tail                 text,
    error                    text,
    tokens_used              int,
    elapsed_seconds          real,
    started_at               timestamptz,
    finished_at              timestamptz,
    transferred_to_photo_id  uuid REFERENCES photos(id) ON DELETE SET NULL,
    suggested_collages_json  jsonb,
    -- For workers using FOR UPDATE SKIP LOCKED — quick claim heartbeat
    claimed_at               timestamptz,
    created_at               timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS studio_jobs_batch_idx ON studio_jobs(batch_id);
CREATE INDEX IF NOT EXISTS studio_jobs_queued_idx
    ON studio_jobs(created_at) WHERE status = 'queued';
CREATE INDEX IF NOT EXISTS studio_jobs_running_idx
    ON studio_jobs(started_at) WHERE status = 'running';
CREATE INDEX IF NOT EXISTS studio_jobs_filename_idx
    ON studio_jobs(source_filename) WHERE source_filename IS NOT NULL;

-- ---------------------------------------------------------------------------
-- photos: link rows that came from Studio + revert support
-- ---------------------------------------------------------------------------
ALTER TABLE photos
    ADD COLUMN IF NOT EXISTS source            text NOT NULL DEFAULT 'upload'
        CHECK (source IN ('upload','studio')),
    ADD COLUMN IF NOT EXISTS studio_job_id     uuid REFERENCES studio_jobs(id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS previous_s3_key   text;

CREATE INDEX IF NOT EXISTS photos_studio_job_idx
    ON photos(studio_job_id) WHERE studio_job_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- Trigger: roll up batch.done/failed/status from job updates.
-- ---------------------------------------------------------------------------
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
    LEFT JOIN studio_jobs j ON j.batch_id = b.id
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

DROP TRIGGER IF EXISTS studio_jobs_rollup_trg ON studio_jobs;
CREATE TRIGGER studio_jobs_rollup_trg
    AFTER INSERT OR UPDATE OF status OR DELETE
    ON studio_jobs
    FOR EACH ROW EXECUTE FUNCTION studio_batches_rollup();

COMMIT;

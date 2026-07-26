-- Catalog-wide switchable backgrounds.
-- Apply order: after migration_011_watermark.sql.
--
-- Model: photos flagged `bg_set` form the "background set". For every
-- studio_backgrounds asset a photo may have one generated version
-- (photo_bg_versions row, object stored in the main bucket under
-- bg/{background_id}/{photo_id}.png). A single-row background_config points
-- at the active background; photo URLs resolve to the active version when it
-- exists, otherwise to photos.s3_key. Switching backgrounds = one UPDATE of
-- the config row; nothing in storage moves.
--
-- `canonical_s3_key` is the frozen generation source for the photo: every
-- background version is generated from it (never chained from another
-- version, so quality does not degrade across backgrounds).

ALTER TABLE photos
    ADD COLUMN IF NOT EXISTS bg_set boolean NOT NULL DEFAULT false,
    ADD COLUMN IF NOT EXISTS bg_standing boolean NOT NULL DEFAULT false,
    ADD COLUMN IF NOT EXISTS canonical_s3_key text;

CREATE TABLE IF NOT EXISTS photo_bg_versions (
    id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    photo_id      uuid NOT NULL REFERENCES photos(id) ON DELETE CASCADE,
    background_id uuid NOT NULL REFERENCES studio_backgrounds(id) ON DELETE CASCADE,
    state         text NOT NULL DEFAULT 'pending'
                  CHECK (state IN ('pending', 'running', 'done', 'failed')),
    s3_key        text,
    mime          text,
    size_bytes    bigint,
    error         text,
    attempts      int NOT NULL DEFAULT 0,
    next_retry_at timestamptz NOT NULL DEFAULT now(),
    created_at    timestamptz NOT NULL DEFAULT now(),
    updated_at    timestamptz NOT NULL DEFAULT now(),
    UNIQUE (photo_id, background_id)
);

CREATE INDEX IF NOT EXISTS photo_bg_versions_claim_idx
    ON photo_bg_versions (next_retry_at)
    WHERE state IN ('pending', 'running');

CREATE INDEX IF NOT EXISTS photo_bg_versions_bg_idx
    ON photo_bg_versions (background_id, state);

-- Single-row config: which background the whole catalog is showing.
CREATE TABLE IF NOT EXISTS background_config (
    id            smallint PRIMARY KEY DEFAULT 1 CHECK (id = 1),
    background_id uuid REFERENCES studio_backgrounds(id) ON DELETE SET NULL,
    updated_at    timestamptz NOT NULL DEFAULT now()
);

INSERT INTO background_config (id) VALUES (1) ON CONFLICT (id) DO NOTHING;

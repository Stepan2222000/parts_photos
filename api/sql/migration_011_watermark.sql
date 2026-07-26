-- Watermark-on-view: per-channel toggle + single default asset.
-- Apply order: after migration_010_studio_refine.sql.
--
-- The watermark is NEVER baked into stored objects. S3 keeps clean photos;
-- when a channel's flag is on, the API serves photo URLs through
-- GET /photos/{id}/wm which composites the configured watermark on the fly
-- (PIL, center, ~40% width, ~55% opacity). Turning the flag off instantly
-- restores clean URLs — nothing to undo in storage.

ALTER TABLE photo_groups
    ADD COLUMN IF NOT EXISTS watermark_enabled boolean NOT NULL DEFAULT false;

-- Single-row config: which studio_watermarks asset is applied everywhere.
CREATE TABLE IF NOT EXISTS watermark_config (
    id           smallint PRIMARY KEY DEFAULT 1 CHECK (id = 1),
    watermark_id uuid REFERENCES studio_watermarks(id) ON DELETE SET NULL,
    updated_at   timestamptz NOT NULL DEFAULT now()
);

INSERT INTO watermark_config (id) VALUES (1) ON CONFLICT (id) DO NOTHING;

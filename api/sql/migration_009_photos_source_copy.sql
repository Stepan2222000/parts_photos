-- Allow photos.source = 'copy'.
--
-- The «Пробелы фото» (gaps) feature fills publication channels from existing
-- raw/library photos. For routes that KEEP the source (Реальные→Эталонные,
-- Свободные→*), a new photos row is inserted as a copy (object duplicated in
-- MinIO, original untouched). We tag those rows source='copy' (and stash the
-- origin in previous_s3_key) for provenance — distinct from 'upload' (raw
-- shot) and 'studio' (AI result). Move routes (Реальные→На публикацию) repoint
-- the existing row and keep its original source, so they need no new value.
--
-- Apply order: after migration_008_merge_publication_channels.sql.

BEGIN;

ALTER TABLE photos DROP CONSTRAINT IF EXISTS photos_source_check;
ALTER TABLE photos
    ADD CONSTRAINT photos_source_check
    CHECK (source IN ('upload', 'studio', 'copy'));

COMMIT;

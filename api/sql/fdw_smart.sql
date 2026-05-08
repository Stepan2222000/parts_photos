-- postgres_fdw setup: read-only access from parts_photos to smart.parts
-- for owner-validation and autocomplete in photos_admin.
--
-- Run once after creating the parts_photos DB. Re-runnable (IF NOT EXISTS).

CREATE EXTENSION IF NOT EXISTS postgres_fdw;

-- Drop the legacy stub schema if it was created earlier for local testing.
DROP SCHEMA IF EXISTS smart_ext CASCADE;

-- Foreign server pointing at the real smart DB on 2.26.53.128:5402.
DROP SERVER IF EXISTS smart_server CASCADE;
CREATE SERVER smart_server
    FOREIGN DATA WRAPPER postgres_fdw
    OPTIONS (host '2.26.53.128', port '5402', dbname 'smart');

-- Each local user that queries the foreign table needs a mapping. Both the
-- API (which connects as `admin`) and ad-hoc psql sessions go through this.
CREATE USER MAPPING FOR admin
    SERVER smart_server
    OPTIONS (user 'admin', password 'Password123');

CREATE SCHEMA smart_ext;

-- Manual CREATE FOREIGN TABLE with only the columns we need. IMPORT FOREIGN
-- SCHEMA fails because the remote table uses a custom enum (brand_enum) that
-- doesn't exist locally. We don't need brands/etc for owner search anyway.
CREATE FOREIGN TABLE smart_ext.parts (
    id        text,
    name      text,
    articles  text[],
    is_draft  boolean
) SERVER smart_server
  OPTIONS (schema_name 'public', table_name 'parts');

ANALYZE smart_ext.parts;

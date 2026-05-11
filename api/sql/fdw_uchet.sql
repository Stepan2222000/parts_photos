-- postgres_fdw setup: read-only access from parts_photos to parts_uchet.items
-- for Studio target-group lookups (item-level collages, defect filter).
--
-- Run once after creating the parts_photos DB. Re-runnable (IF NOT EXISTS / DROP IF EXISTS).
-- Mirrors fdw_smart.sql exactly — same wrapper, same auth, separate schema.

CREATE EXTENSION IF NOT EXISTS postgres_fdw;

-- Foreign server pointing at the real parts_uchet DB on 2.26.53.128:5403.
DROP SERVER IF EXISTS uchet_server CASCADE;
CREATE SERVER uchet_server
    FOREIGN DATA WRAPPER postgres_fdw
    OPTIONS (host '2.26.53.128', port '5403', dbname 'parts_uchet');

CREATE USER MAPPING FOR admin
    SERVER uchet_server
    OPTIONS (user 'admin', password 'Password123');

CREATE SCHEMA IF NOT EXISTS uchet_ext;

-- Only the columns Studio actually needs. status is item_status_enum on the
-- remote side — we declare it as text here, postgres_fdw converts on read
-- and pushdown for `status = 'in_stock'` still works (text equality is
-- built-in immutable).
CREATE FOREIGN TABLE uchet_ext.items (
    id            integer,
    smart_part_id text,
    defect        boolean,
    defect_note   text,
    status        text,
    note          text
) SERVER uchet_server
  OPTIONS (schema_name 'public', table_name 'items');

ANALYZE uchet_ext.items;

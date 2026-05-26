-- postgres_fdw setup: read-only access from parts_photos to parts_uchet.items
-- for Studio target-group lookups (item-level collages, condition filter).
--
-- Run once after creating the parts_photos DB. Re-runnable (IF NOT EXISTS / DROP IF EXISTS).
-- Mirrors fdw_smart.sql exactly — same wrapper, same auth, separate schema.

CREATE EXTENSION IF NOT EXISTS postgres_fdw;

-- Foreign server pointing at the real parts_uchet DB on 194.164.245.107:5403.
DROP SERVER IF EXISTS uchet_server CASCADE;
CREATE SERVER uchet_server
    FOREIGN DATA WRAPPER postgres_fdw
    OPTIONS (host '194.164.245.107', port '5403', dbname 'parts_uchet');

CREATE USER MAPPING FOR admin
    SERVER uchet_server
    OPTIONS (user 'admin', password 'Password123');

CREATE SCHEMA IF NOT EXISTS uchet_ext;

-- Only the columns Studio actually needs. status and condition are remote
-- enums (item_status_enum / item_condition_enum) — we declare them as text
-- here, postgres_fdw converts on read and pushdown for `status = 'in_stock'`
-- / `condition = 'personal'` still works (text equality is built-in immutable).
CREATE FOREIGN TABLE uchet_ext.items (
    id             integer,
    smart_part_id  text,
    condition      text,
    condition_note text,
    status         text,
    note           text
) SERVER uchet_server
  OPTIONS (schema_name 'public', table_name 'items');

ANALYZE uchet_ext.items;

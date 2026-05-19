# Draft mode (one-day capture)

Temporary branch: `feature/draft-collages-with-notes`.

## Scope

Only these groups use draft collages:

- **Реальные фотографии** — `721bf726-cdda-4ca8-bf22-f345ca0f677b`
- **Дефектные фотографии** — `edce2987-daae-4339-8330-8cb96ad912bf`

Create collage → required comment → upload photos. Search by comment. Edit comment on collage page. No item/smart validation. Studio hidden for draft photos.

## Deploy

### Временный деплой с feature-ветки (без merge в main)

1. Push ветку `feature/draft-collages-with-notes` на GitHub.
2. GitHub → **Actions** → **build & deploy** → **Run workflow**.
3. В поле **deploy_branch** укажи `feature/draft-collages-with-notes` → Run.
4. Образы и файлы на сервере (`/root/parts_photos_app`) возьмутся с этой ветки; миграции прогонятся с неё же.

Автодеплой по push в `main` не меняется. После съёмки запусти workflow с `deploy_branch = main`.

### Локально

1. Migrations: `psql $PG_DSN -f api/sql/migration_006_draft_collages.sql` (на проде уже накатана).
2. `cd api && python run.py` + `cd web && npm run dev`

## Backups before migrate

- `db_dumps/parts_photos_20260519_150406.sql`
- `db_dumps/parts_uchet_20260519_items.sql`

## After the shoot

1. Export data manually (SQL, UI, MinIO) as you prefer.
2. Resolve conflicts and link collages to real `items` outside this mode.
3. Switch back to `main`.
4. Run `api/sql/migration_007_revert_draft.sql` on production **after** deleting or archiving draft rows.

## Revert schema

`migration_007_revert_draft.sql` deletes all `owner_kind = 'draft'` rows and removes `draft` from the CHECK constraint. The `note` column is kept by default (uncomment DROP in 007 if you want it removed).

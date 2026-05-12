# Studio — заметки по деплою

Studio — модуль генерации/редактирования фото запчастей через `codex exec` +
gpt-image-2 на ChatGPT-подписке. Состоит из:

- `studio_core/` — общий Python-пакет (промпт-сборщик, codex runner, article matching)
- `api/app/routers/studio.py` + `api/app/studio/` — API эндпоинты + worker
- `web/app/studio/` + `web/components/studio/` — фронтенд

## Что нужно сделать на сервере один раз

1. **Авторизовать codex под ChatGPT Pro:**

   ```sh
   ssh root@194.164.245.107
   npm i -g @openai/codex     # если ещё не стоит
   codex login                # → выбрать "Sign in with ChatGPT", открыть URL в браузере
   ls -la /root/.codex/auth.json   # должен появиться (~4KB)
   ```

   Этот файл монтируется в контейнер `studio-worker` через volume
   `/root/.codex:/root/.codex` (определено в `docker-compose.yml`).
   codex периодически рефрешит токен внутри файла — поэтому RW, не RO.

2. **Создать MinIO bucket для Studio:**

   API сам создаст `parts-photos-studio` при первом старте через
   `ensure_studio_bucket()` в `lifespan`. Проверить:

   ```sh
   docker exec parts_photos_api python -c "from app.studio.storage import ensure_bucket; ensure_bucket()"
   ```

3. **Применить миграцию `003_studio.sql`:**

   GH Actions deploy job уже автоматически прогоняет все
   `api/sql/migration_*.sql` через `docker exec parts_photos psql`. Проверить:

   ```sh
   docker exec parts_photos psql -U admin -d parts_photos -c "\dt studio_*"
   ```

   Должно показать `studio_backgrounds`, `studio_batches`, `studio_jobs`,
   `studio_watermarks`.

## Параметры воркера

`docker-compose.yml` сервис `studio-worker`:

| ENV | Default | Назначение |
|---|---|---|
| `STUDIO_MIN_WORKERS` | 2 | Минимум параллельных codex-процессов |
| `STUDIO_MAX_WORKERS` | 10 | Максимум — потолок 100, дальше код игнорирует |
| `STUDIO_LOG_LEVEL` | INFO | Логи воркера |
| `STUDIO_MINIO_BUCKET` | parts-photos-studio | Bucket для uploads/results/backgrounds/watermarks |
| `STUDIO_MINIO_PUBLIC_BASE` | derived | Публичный URL префикс для отдачи картинок |

Адаптивная конкурентность: воркер начинает с `(min+max)/2`, при ошибках
429/usage-limit понижает на 1 + 30с backoff, после 50 успехов подряд
поднимает на 1.

## Что включает Studio API

```
GET  /studio/backgrounds          POST … (multipart file)   DELETE …/{id}
GET  /studio/watermarks           POST … (multipart file)   DELETE …/{id}

POST /studio/batches              # multipart с files[]+options JSON+опции
GET  /studio/batches              # последние 50
GET  /studio/batches/{id}         # детально (для polling прогресса)
DEL  /studio/batches/{id}

GET  /studio/jobs/{id}
POST /studio/jobs/{id}/transfer            # body: {collage_id}
POST /studio/batches/{id}/transfer-suggested   # bulk
```

## Smoke-test после деплоя

```sh
# 1. поднять
docker compose pull && docker compose up -d
docker compose logs --tail=50 studio-worker

# 2. проверить API
curl -s http://194.164.245.107:3200/studio/backgrounds | jq
curl -s http://194.164.245.107:3200/studio/batches | jq

# 3. фронт
open http://194.164.245.107:3100/studio
# → Studio в сайдбаре, страница откроется
# → загрузить фон, загрузить файл, включить replace_bg, нажать Generate
# → progress bar тикает, через ~2 мин — результат
```

## Локальная разработка studio_core

```sh
pip install -e ./studio_core
pytest studio_core/tests -v
```

## Проверенные вещи

- `studio_core` 14/14 unit-тестов прошли (промпт-сборка + article match)
- `run_codex` на ChatGPT-подписке — реальный generation за ~2 мин (35-67k токенов на job)
- Параллельные codex exec работают (без 429 на этой подписке)
- Output reliably находится в `~/.codex/generated_images/<session>/ig_*.png`
- TypeScript проходит без ошибок (Next.js 15 + React 19)

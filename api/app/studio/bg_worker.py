"""Background-version generation, drained by the studio worker process.

A job = one photo_bg_versions row in state 'pending' whose next_retry_at has
passed. The generation source is the photo's frozen canonical_s3_key (never a
previously generated version — quality must not degrade across backgrounds).
The background is passed as a plate reference; photos flagged `bg_standing`
get a synthesized floor+wall corner reference built from the same plate.

Provider cooldowns (503 / auth_unavailable / connection drops / timeouts) do
NOT fail a job: the row is rescheduled with a growing delay, so a batch just
waits the cooldown out and resumes on its own. A row only goes 'failed' after
MAX_ATTEMPTS, and those surface in the panel's «не получилось» list.
"""
from __future__ import annotations

import asyncio
import io
import logging
from pathlib import Path
from uuid import UUID

import asyncpg
from openai import AsyncOpenAI, RateLimitError
from PIL import Image, ImageDraw, ImageEnhance

from studio_core import build_prompt, run_codex, size_for
from studio_core.codex_runner import CodexError

from ..bg import version_key
from ..config import settings
from ..db import pool
from ..minio_client import client as minio, put_object
from .storage import fetch_to, put_bytes, studio_bucket

logger = logging.getLogger("studio.bg_worker")

# The single-account image gateway chokes above ~2 concurrent edits.
MAX_CONCURRENCY = 2
MAX_ATTEMPTS = 30
RETRY_BASE_SECONDS = 90
RETRY_CAP_SECONDS = 600

# Pilot-validated geometry instructions (pilot_cream, July 2026).
GEOM_FLAT = (
    "Про фон (Изображение 2 — мраморная плита-референс): запчасть/упаковка лежит, поэтому фон — "
    "единая ровная поверхность из референса до самых краёв кадра. Строго без линии горизонта, "
    "без стены, без края стола и без плавного загиба плоскости вверх вдали.\n"
    "Старый фон замени ЦЕЛИКОМ, включая всё, что к нему относится: логотипы и надписи, "
    "напечатанные на старом фоне/заднике (это НЕ заводская маркировка товара), бумагу или "
    "плёнку-подложку ПОД товаром, руки, посторонние предметы. Сохраняй только сам товар и его "
    "собственную упаковку — товар лежит прямо на новой мраморной поверхности."
)
GEOM_CORNER = (
    "Изображение 2 — готовая фоновая сцена: пол и задняя стена из одного материала, разделённые "
    "чёткой прямой горизонтальной линией стыка. Помести запчасть/упаковку на пол этой сцены "
    "(у стены), сохранив геометрию сцены РОВНО как в референсе: линия стыка остаётся такой же "
    "чёткой и прямой, пол горизонтальный, стена вертикальная. Никакого плавного загиба пола в "
    "стену, никакой «бесконечной» изогнутой циклорамы. Согласуй свет и добавь мягкую контактную "
    "тень под запчастью на полу.\n"
    "Старый фон замени ЦЕЛИКОМ, включая всё, что к нему относится: логотипы и надписи, "
    "напечатанные на старом фоне/заднике (это НЕ заводская маркировка товара), бумагу или "
    "плёнку-подложку ПОД товаром, руки, посторонние предметы. Сохраняй только сам товар и его "
    "собственную упаковку."
)


def _strip_c2pa(png: bytes) -> bytes:
    """Same as worker._strip_c2pa (kept local to avoid an import cycle)."""
    with Image.open(io.BytesIO(png)) as im:
        if im.mode not in ("RGB", "RGBA"):
            im = im.convert("RGB")
        out = io.BytesIO()
        im.save(out, format="PNG", optimize=True)
        return out.getvalue()


# ---------------------------------------------------------------------------
# Corner reference: synthesized floor+wall scene from the flat plate
# ---------------------------------------------------------------------------


def corner_ref_key(background_id: UUID | str) -> str:
    return f"backgrounds/{background_id}_corner.png"


def _build_corner_ref(plate_bytes: bytes, side: int = 1024) -> bytes:
    """Wall (top, slightly darkened) + perspective floor (bottom) + a crisp
    seam with soft ambient occlusion. Prompt-only corners don't work — the
    model needs to SEE the seam (validated in the marble runs)."""
    with Image.open(io.BytesIO(plate_bytes)) as im:
        plate = im.convert("RGB")
    W = H = side
    wall_h = int(H * 0.42)
    floor_h = H - wall_h

    wall = plate.crop((0, 0, plate.width, int(plate.height * 0.5)))
    wall = wall.resize((W, wall_h), Image.LANCZOS)
    wall = ImageEnhance.Brightness(wall).enhance(0.93)

    floor_src = plate.crop((0, int(plate.height * 0.35), plate.width, plate.height))
    inset = int(plate.width * 0.18)
    floor = floor_src.transform(
        (W, floor_h), Image.QUAD,
        (inset, 0, plate.width - inset, 0,
         plate.width, floor_src.height, 0, floor_src.height),
        Image.BICUBIC,
    )
    floor = ImageEnhance.Brightness(floor).enhance(1.04)

    ref = Image.new("RGB", (W, H))
    ref.paste(wall, (0, 0))
    ref.paste(floor, (0, wall_h))
    d = ImageDraw.Draw(ref, "RGBA")
    d.line([(0, wall_h), (W, wall_h)], fill=(70, 60, 50, 160), width=3)
    for i in range(28):  # AO fading down from the seam
        a = int(60 * (1 - i / 28))
        d.line([(0, wall_h + 3 + i), (W, wall_h + 3 + i)], fill=(60, 50, 40, a))
    for i in range(10):  # and a shorter fade up the wall
        a = int(35 * (1 - i / 10))
        d.line([(0, wall_h - 1 - i), (W, wall_h - 1 - i)], fill=(60, 50, 40, a))

    out = io.BytesIO()
    ref.save(out, format="PNG", optimize=True)
    return out.getvalue()


def _ensure_corner_ref_sync(background_id: UUID, bg_key: str) -> str:
    """Idempotently materialize the corner reference next to the plate in the
    studio bucket; returns its key."""
    key = corner_ref_key(background_id)
    try:
        minio().stat_object(studio_bucket(), key)
        return key
    except Exception:
        pass
    resp = minio().get_object(studio_bucket(), bg_key)
    try:
        plate_bytes = resp.read()
    finally:
        resp.close()
        resp.release_conn()
    put_bytes(key, _build_corner_ref(plate_bytes), "image/png")
    logger.info("built corner ref %s", key)
    return key


# ---------------------------------------------------------------------------
# Claim / lifecycle
# ---------------------------------------------------------------------------


async def claim_one(conn: asyncpg.Connection) -> dict | None:
    async with conn.transaction():
        row = await conn.fetchrow(
            """
            SELECT v.id, v.photo_id, v.background_id, v.attempts,
                   COALESCE(p.canonical_s3_key, p.s3_key) AS source_key,
                   p.bg_standing,
                   b.s3_key AS bg_key
            FROM photo_bg_versions v
            JOIN photos p ON p.id = v.photo_id AND p.state = 'uploaded'
            JOIN studio_backgrounds b ON b.id = v.background_id AND b.deleted_at IS NULL
            WHERE v.state = 'pending' AND v.next_retry_at <= now()
            ORDER BY v.created_at ASC
            FOR UPDATE OF v SKIP LOCKED
            LIMIT 1
            """,
        )
        if row is None:
            return None
        await conn.execute(
            "UPDATE photo_bg_versions SET state = 'running', updated_at = now() WHERE id = $1",
            row["id"],
        )
        return dict(row)


async def _reschedule(row_id: UUID, attempts: int, error: str) -> None:
    """Transient failure: back to pending with a growing delay, or failed
    once the attempt budget is spent."""
    attempts += 1
    if attempts >= MAX_ATTEMPTS:
        await pool().execute(
            """
            UPDATE photo_bg_versions
               SET state = 'failed', attempts = $2, error = $3, updated_at = now()
             WHERE id = $1
            """,
            row_id, attempts, error[:2000],
        )
        return
    delay = min(RETRY_BASE_SECONDS * attempts, RETRY_CAP_SECONDS)
    await pool().execute(
        """
        UPDATE photo_bg_versions
           SET state = 'pending', attempts = $2, error = $3,
               next_retry_at = now() + make_interval(secs => $4), updated_at = now()
         WHERE id = $1
        """,
        row_id, attempts, error[:2000], float(delay),
    )


async def _fail(row_id: UUID, error: str) -> None:
    await pool().execute(
        """
        UPDATE photo_bg_versions
           SET state = 'failed', error = $2, updated_at = now()
         WHERE id = $1
        """,
        row_id, error[:2000],
    )


# ---------------------------------------------------------------------------
# Job execution
# ---------------------------------------------------------------------------


async def run_one(job: dict, work_dir: Path, client: AsyncOpenAI) -> bool:
    row_id: UUID = job["id"]
    job_dir = work_dir / f"bg_{row_id}"
    job_dir.mkdir(parents=True, exist_ok=True)
    try:
        ref_key = job["bg_key"]
        if job["bg_standing"]:
            ref_key = await asyncio.to_thread(
                _ensure_corner_ref_sync, job["background_id"], job["bg_key"]
            )

        src_path = job_dir / f"source{Path(job['source_key']).suffix or '.img'}"
        ref_path = job_dir / f"background{Path(ref_key).suffix}"
        await asyncio.gather(
            asyncio.to_thread(
                fetch_to, job["source_key"], src_path, bucket=settings.minio_bucket
            ),
            asyncio.to_thread(fetch_to, ref_key, ref_path),
        )

        prompt = build_prompt(
            {"replace_bg": True},
            has_background=True,
            custom_prompt=GEOM_CORNER if job["bg_standing"] else GEOM_FLAT,
        )
        with Image.open(src_path) as src_img:
            size = size_for(*src_img.size)

        result = await run_codex(
            client,
            prompt,
            [src_path, ref_path],
            model=settings.studio_image_model,
            size=size,
            quality=settings.studio_image_quality,
            timeout_seconds=settings.studio_image_timeout_seconds,
        )
        result_bytes = await asyncio.to_thread(_strip_c2pa, result.image)

        result_key = version_key(job["background_id"], job["photo_id"])
        await asyncio.to_thread(
            put_object, settings.minio_bucket, result_key, result_bytes, "image/png"
        )
        await pool().execute(
            """
            UPDATE photo_bg_versions
               SET state = 'done', s3_key = $2, mime = 'image/png',
                   size_bytes = $3, error = NULL, updated_at = now()
             WHERE id = $1
            """,
            row_id, result_key, len(result_bytes),
        )
        logger.info(
            "bg version done: photo=%s bg=%s (%.0fs)",
            job["photo_id"], job["background_id"], result.elapsed_seconds,
        )
        return True

    except RateLimitError as e:
        await _reschedule(row_id, job["attempts"], f"rate limited: {e}")
        return False
    except CodexError as e:
        msg = str(e)
        # Asset gone = permanent; everything else on this flaky single-account
        # gateway (503, auth_unavailable, timeouts, resets) is worth retrying.
        if "deleted" in msg:
            await _fail(row_id, msg)
        else:
            await _reschedule(row_id, job["attempts"], msg)
        return False
    except Exception as e:
        logger.exception("bg job %s crashed", row_id)
        await _reschedule(row_id, job["attempts"], repr(e))
        return False
    finally:
        import shutil

        shutil.rmtree(job_dir, ignore_errors=True)


async def recover_stuck(max_age_minutes: int = 30) -> None:
    """Rows left 'running' by a crashed/restarted worker go back to pending."""
    n = await pool().fetchval(
        """
        WITH upd AS (
            UPDATE photo_bg_versions
               SET state = 'pending', next_retry_at = now(), updated_at = now()
             WHERE state = 'running'
               AND updated_at < now() - make_interval(mins => $1)
            RETURNING 1
        )
        SELECT COUNT(*) FROM upd
        """,
        max_age_minutes,
    )
    if n:
        logger.warning("recovered %d stuck bg jobs", n)

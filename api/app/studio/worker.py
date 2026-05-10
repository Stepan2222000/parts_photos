"""Studio worker: drains queued studio_jobs and runs codex exec per job.

Run as a separate process (`python -m app.studio.worker`).
Concurrency is adaptive: starts in the middle of [STUDIO_MIN_WORKERS,
STUDIO_MAX_WORKERS], shrinks by one with a 30s sleep on rate-limit errors,
grows by one after 50 successes in a row.
"""
from __future__ import annotations

import asyncio
import json
import logging
import os
import shutil
import signal
import tempfile
from pathlib import Path
from uuid import UUID

import asyncpg

from studio_core import build_prompt, run_codex
from studio_core.codex_runner import GENERATED_DIR, CodexError
from studio_core.options import OptionKey

from ..config import settings
from ..db import close_pool, init_pool, pool
from .article_match_db import find_matches
from .storage import fetch_to, put_bytes, studio_bucket

logger = logging.getLogger("studio.worker")

POLL_INTERVAL_SECONDS = 2.0
LOG_TAIL_FLUSH_SECONDS = 3.0
SUCCESSES_BEFORE_GROW = 50
RATE_LIMIT_BACKOFF_SECONDS = 30


# ---------------------------------------------------------------------------
# Adaptive pool state
# ---------------------------------------------------------------------------


class AdaptivePool:
    def __init__(self, lo: int, hi: int) -> None:
        self.hi = max(1, hi)
        self.lo = max(1, min(lo, self.hi))
        self.target = max(self.lo, (self.lo + self.hi) // 2)
        self._active = 0
        self._success_streak = 0
        self._cv = asyncio.Condition()

    async def acquire(self) -> None:
        async with self._cv:
            while self._active >= self.target:
                await self._cv.wait()
            self._active += 1

    async def release(self) -> None:
        async with self._cv:
            self._active -= 1
            self._cv.notify_all()

    async def report_success(self) -> None:
        async with self._cv:
            self._success_streak += 1
            if self._success_streak >= SUCCESSES_BEFORE_GROW and self.target < self.hi:
                self.target += 1
                self._success_streak = 0
                logger.info("scaling up worker concurrency to %d", self.target)
                self._cv.notify_all()

    async def report_rate_limit(self) -> int:
        async with self._cv:
            self._success_streak = 0
            if self.target > self.lo:
                self.target -= 1
                logger.warning("scaling down worker concurrency to %d (rate limit)", self.target)
            return self.target

    @property
    def active(self) -> int:
        return self._active


# ---------------------------------------------------------------------------
# Job claim & lifecycle
# ---------------------------------------------------------------------------


async def claim_one(conn: asyncpg.Connection) -> dict | None:
    """Atomically claim a queued job."""
    async with conn.transaction():
        row = await conn.fetchrow(
            """
            SELECT j.id, j.batch_id, j.source_kind, j.source_filename,
                   j.source_s3_key, j.source_photo_id,
                   b.options_json, b.custom_prompt, b.background_id,
                   b.watermark_id, b.target_collage_id
            FROM studio_jobs j
            JOIN studio_batches b ON b.id = j.batch_id
            WHERE j.status = 'queued'
            ORDER BY j.created_at ASC
            FOR UPDATE OF j SKIP LOCKED
            LIMIT 1
            """
        )
        if row is None:
            return None
        await conn.execute(
            "UPDATE studio_jobs SET status = 'running', started_at = now(), claimed_at = now() WHERE id = $1",
            row["id"],
        )
        return dict(row)


async def fail_job(job_id: UUID, error: str, log_tail: str = "") -> None:
    await pool().execute(
        """
        UPDATE studio_jobs
           SET status = 'failed', error = $2, log_tail = $3, finished_at = now()
         WHERE id = $1
        """,
        job_id,
        error[:4000],
        log_tail[:8000],
    )


async def succeed_job(
    job_id: UUID,
    *,
    result_s3_key: str,
    result_size_bytes: int,
    log_tail: str,
    tokens_used: int | None,
    elapsed_seconds: float,
    suggestions: list[dict],
) -> None:
    await pool().execute(
        """
        UPDATE studio_jobs
           SET status = 'succeeded',
               result_s3_key = $2,
               result_size_bytes = $3,
               log_tail = $4,
               tokens_used = $5,
               elapsed_seconds = $6,
               finished_at = now(),
               suggested_collages_json = $7
         WHERE id = $1
        """,
        job_id,
        result_s3_key,
        result_size_bytes,
        log_tail[:8000],
        tokens_used,
        elapsed_seconds,
        json.dumps(suggestions),
    )


# ---------------------------------------------------------------------------
# Per-job execution
# ---------------------------------------------------------------------------


_ASSET_TABLES = {"background": "studio_backgrounds", "watermark": "studio_watermarks"}


async def _resolve_asset_keys(
    background_id: UUID | None, watermark_id: UUID | None
) -> tuple[str | None, str | None]:
    """Single round-trip lookup for (bg_key, wm_key)."""
    rows = await pool().fetch(
        """
        SELECT id, s3_key FROM studio_backgrounds
         WHERE id = ANY($1::uuid[]) AND deleted_at IS NULL
        UNION ALL
        SELECT id, s3_key FROM studio_watermarks
         WHERE id = ANY($2::uuid[]) AND deleted_at IS NULL
        """,
        [background_id] if background_id else [],
        [watermark_id] if watermark_id else [],
    )
    by_id = {r["id"]: r["s3_key"] for r in rows}
    return (
        by_id.get(background_id) if background_id else None,
        by_id.get(watermark_id) if watermark_id else None,
    )


async def run_one_job(job: dict, work_dir: Path, ad_pool: AdaptivePool) -> bool:
    """Run a single job. Returns True on success, False on failure."""
    job_id: UUID = job["id"]
    options = job["options_json"] or {}
    if isinstance(options, str):
        options = json.loads(options)
    background_id = job["background_id"]
    watermark_id = job["watermark_id"]

    has_bg = bool(options.get(OptionKey.REPLACE_BG.value)) and background_id is not None
    has_wm = bool(options.get(OptionKey.ADD_WATERMARK.value)) and watermark_id is not None

    job_dir = work_dir / str(job_id)
    job_dir.mkdir(parents=True, exist_ok=True)
    sess_dir_to_clean: Path | None = None
    try:
        bg_key, wm_key = await _resolve_asset_keys(
            background_id if has_bg else None,
            watermark_id if has_wm else None,
        )
        if has_bg and bg_key is None:
            raise CodexError("background asset deleted before job ran")
        if has_wm and wm_key is None:
            raise CodexError("watermark asset deleted before job ran")

        src_path = job_dir / f"source{Path(job['source_s3_key']).suffix}"
        src_bucket = (
            settings.minio_bucket
            if job["source_kind"] == "collage_photo"
            else studio_bucket()
        )

        downloads = [
            asyncio.to_thread(fetch_to, job["source_s3_key"], src_path, bucket=src_bucket),
        ]
        bg_path = wm_path = None
        if has_bg:
            bg_path = job_dir / f"background{Path(bg_key).suffix}"
            downloads.append(asyncio.to_thread(fetch_to, bg_key, bg_path))
        if has_wm:
            wm_path = job_dir / f"watermark{Path(wm_key).suffix}"
            downloads.append(asyncio.to_thread(fetch_to, wm_key, wm_path))
        await asyncio.gather(*downloads)

        refs: list[Path] = [src_path]
        if bg_path: refs.append(bg_path)
        if wm_path: refs.append(wm_path)

        prompt = build_prompt(
            options,
            has_background=has_bg,
            has_watermark=has_wm,
            custom_prompt=job["custom_prompt"],
        )

        last_flush = {"text": "", "ts": 0.0}

        async def progress(tail: str) -> None:
            now = asyncio.get_event_loop().time()
            if tail == last_flush["text"]: return  # no-op: same content
            if now - last_flush["ts"] < LOG_TAIL_FLUSH_SECONDS: return
            last_flush["text"] = tail
            last_flush["ts"] = now
            try:
                await pool().execute(
                    "UPDATE studio_jobs SET log_tail = $2 WHERE id = $1",
                    job_id, tail[:8000],
                )
            except Exception:
                logger.exception("failed to flush log tail for job %s", job_id)

        result = await run_codex(
            prompt, refs,
            log_callback=progress,
            timeout_seconds=settings.studio_codex_timeout_seconds,
        )
        sess_dir_to_clean = GENERATED_DIR / result.session_id

        result_bytes = result.image_path.read_bytes()
        result_key = f"results/{job['batch_id']}/{job_id}.png"
        await asyncio.to_thread(put_bytes, result_key, result_bytes, "image/png")

        suggestions: list[dict] = []
        if job["source_filename"]:
            async with pool().acquire() as conn:
                suggestions = await find_matches(job["source_filename"], conn)

        await succeed_job(
            job_id,
            result_s3_key=result_key,
            result_size_bytes=len(result_bytes),
            log_tail=result.log_tail,
            tokens_used=result.tokens_used,
            elapsed_seconds=result.elapsed_seconds,
            suggestions=suggestions,
        )
        await ad_pool.report_success()
        return True

    except CodexError as e:
        if e.rate_limited:
            await ad_pool.report_rate_limit()
            await asyncio.sleep(RATE_LIMIT_BACKOFF_SECONDS)
        await fail_job(job_id, str(e), e.log_tail)
        return False
    except Exception as e:
        logger.exception("worker job %s crashed", job_id)
        await fail_job(job_id, repr(e))
        return False
    finally:
        shutil.rmtree(job_dir, ignore_errors=True)
        # codex leaves the generated PNG in ~/.codex/generated_images/<sess>/;
        # without cleanup that dir grows unbounded.
        if sess_dir_to_clean is not None:
            shutil.rmtree(sess_dir_to_clean, ignore_errors=True)


# ---------------------------------------------------------------------------
# Main loop
# ---------------------------------------------------------------------------


async def main_loop() -> None:
    await init_pool()
    work_root = Path(tempfile.mkdtemp(prefix="studio_worker_"))
    ad_pool = AdaptivePool(settings.studio_min_workers, settings.studio_max_workers)
    logger.info(
        "studio worker up: bucket=%s concurrency=%d (range %d..%d) work_root=%s",
        studio_bucket(),
        ad_pool.target,
        ad_pool.lo,
        ad_pool.hi,
        work_root,
    )

    stop = asyncio.Event()

    def _signal_handler() -> None:
        logger.info("shutdown signal received")
        stop.set()

    loop = asyncio.get_running_loop()
    for sig in (signal.SIGTERM, signal.SIGINT):
        try:
            loop.add_signal_handler(sig, _signal_handler)
        except NotImplementedError:
            pass

    in_flight: set[asyncio.Task] = set()

    try:
        while not stop.is_set():
            # Try to launch as many jobs as the adaptive pool allows
            launched_any = False
            while ad_pool.active < ad_pool.target and not stop.is_set():
                async with pool().acquire() as conn:
                    job = await claim_one(conn)
                if job is None:
                    break
                await ad_pool.acquire()
                t = asyncio.create_task(_wrap_job(job, work_root, ad_pool))
                in_flight.add(t)
                t.add_done_callback(in_flight.discard)
                launched_any = True

            if not launched_any:
                try:
                    await asyncio.wait_for(stop.wait(), timeout=POLL_INTERVAL_SECONDS)
                except asyncio.TimeoutError:
                    pass

        if in_flight:
            logger.info("waiting for %d in-flight jobs to finish...", len(in_flight))
            await asyncio.gather(*in_flight, return_exceptions=True)
    finally:
        await close_pool()
        shutil.rmtree(work_root, ignore_errors=True)
        logger.info("studio worker stopped")


async def _wrap_job(job: dict, work_root: Path, ad_pool: AdaptivePool) -> None:
    try:
        await run_one_job(job, work_root, ad_pool)
    finally:
        await ad_pool.release()


def run() -> None:
    logging.basicConfig(
        level=os.environ.get("STUDIO_LOG_LEVEL", "INFO"),
        format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
    )
    asyncio.run(main_loop())


if __name__ == "__main__":
    run()

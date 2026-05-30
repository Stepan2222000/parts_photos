"""Video upload support: detection + background transcode to web-playable mp4.

Only the source photo groups (Реальные/Дефектные фотографии) accept video —
the upload router enforces that via `studio.groups.allows_video`.

Pipeline (background, per uploaded video):
  1. The upload request stores the ORIGINAL bytes at `<photo_id>.src` in the
     photos bucket and inserts a `photos` row in state='pending'.
  2. `transcode_video(photo_id)` downloads the original, normalizes it to
     mp4 (H.264 video, AAC audio, `+faststart` so the moov atom is at the front
     and the browser can start playback before the whole file arrives), uploads
     the result at `<photo_id>.mp4`, flips the row to state='uploaded', and drops
     the original.
  3. On any failure the row goes to state='failed' and both temp/result objects
     are cleaned up — we never leave a non-playable original masquerading as a
     finished video.

If video is already H.264 we copy the stream (cheap remux) and only relocate the
moov atom; otherwise we re-encode. Resolution is never changed (originals are
kept full-size, same as photos).

Transcoding runs as in-process asyncio tasks (ffmpeg is a subprocess, so it does
not block the event loop), capped by a semaphore. On startup `reconcile_pending`
re-launches any transcode that an earlier process crashed mid-way — the original
is still in the bucket, so it can always be retried.
"""
from __future__ import annotations

import asyncio
import logging
import os
import tempfile
from uuid import UUID

from .config import settings
from .db import pool
from .minio_client import put_file
from .studio.storage import delete_photos_object, fetch_to

logger = logging.getLogger("photos.video")

# Detected by content-type prefix `video/` or by extension (some browsers send a
# generic content-type for .mov/.mkv).
VIDEO_EXTS = {
    ".mp4", ".mov", ".m4v", ".webm", ".avi", ".mkv", ".3gp", ".3g2",
    ".mpg", ".mpeg", ".ts", ".mts", ".m2ts", ".wmv", ".flv", ".hevc",
}

_sem: asyncio.Semaphore | None = None
# Hold strong refs to in-flight tasks so the event loop doesn't GC them.
_tasks: set[asyncio.Task] = set()


def is_video_upload(content_type: str | None, filename: str | None) -> bool:
    if content_type and content_type.lower().startswith("video/"):
        return True
    ext = os.path.splitext(filename or "")[1].lower()
    return ext in VIDEO_EXTS


def orig_key_for(final_key: str) -> str:
    """Temp key holding the pre-transcode original (sibling of the result)."""
    base = final_key[:-4] if final_key.endswith(".mp4") else final_key
    return base + ".src"


def _sem_acquire() -> asyncio.Semaphore:
    global _sem
    if _sem is None:
        _sem = asyncio.Semaphore(max(1, settings.video_transcode_concurrency))
    return _sem


def schedule_transcode(photo_id: UUID) -> None:
    """Fire-and-forget a background transcode for an already-inserted pending
    video row."""
    task = asyncio.create_task(_run(photo_id))
    _tasks.add(task)
    task.add_done_callback(_tasks.discard)


async def _run(photo_id: UUID) -> None:
    async with _sem_acquire():
        try:
            await transcode_video(photo_id)
        except Exception:
            logger.exception("transcode crashed for photo %s", photo_id)
            await _mark_failed(photo_id)


async def _probe_codec(path: str, stream: str) -> str | None:
    """ffprobe the codec_name of the first video ('v:0') or audio ('a:0')
    stream. Returns None when the stream is absent."""
    proc = await asyncio.create_subprocess_exec(
        settings.ffprobe_bin, "-v", "error",
        "-select_streams", stream,
        "-show_entries", "stream=codec_name",
        "-of", "csv=p=0",
        path,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
    )
    out, _ = await proc.communicate()
    name = out.decode("utf-8", "replace").strip()
    return name or None


async def transcode_video(photo_id: UUID) -> None:
    row = await pool().fetchrow(
        "SELECT s3_key, state FROM photos WHERE id = $1", photo_id
    )
    if row is None:
        logger.warning("transcode: photo %s gone", photo_id)
        return
    if row["state"] != "pending":
        # Already finished or failed by another run; nothing to do.
        return

    final_key: str = row["s3_key"]
    orig_key = orig_key_for(final_key)

    with tempfile.TemporaryDirectory(prefix="vid_") as tmp:
        src = os.path.join(tmp, "src")
        out = os.path.join(tmp, "out.mp4")

        await asyncio.to_thread(
            fetch_to, orig_key, src, bucket=settings.minio_bucket
        )

        vcodec = await _probe_codec(src, "v:0")
        if vcodec is None:
            raise RuntimeError("no video stream in upload")
        acodec = await _probe_codec(src, "a:0")

        args = [
            settings.ffmpeg_bin, "-hide_banner", "-loglevel", "error",
            "-nostdin", "-y", "-i", src,
            "-map", "0:v:0", "-map", "0:a:0?",
        ]
        # Video: copy when already H.264, else re-encode. No resize.
        if vcodec == "h264":
            args += ["-c:v", "copy"]
        else:
            args += ["-c:v", "libx264", "-pix_fmt", "yuv420p",
                     "-crf", "20", "-preset", "medium"]
        # Audio: drop if none, copy when already AAC, else re-encode.
        if acodec is None:
            args += ["-an"]
        elif acodec == "aac":
            args += ["-c:a", "copy"]
        else:
            args += ["-c:a", "aac", "-b:a", "160k"]
        args += ["-movflags", "+faststart", "-f", "mp4", out]

        proc = await asyncio.create_subprocess_exec(
            *args,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        _, err = await proc.communicate()
        if proc.returncode != 0:
            tail = err.decode("utf-8", "replace").strip()[-2000:]
            raise RuntimeError(f"ffmpeg failed (rc={proc.returncode}): {tail}")

        size = os.path.getsize(out)
        await asyncio.to_thread(
            put_file, settings.minio_bucket, final_key, out, "video/mp4"
        )

    updated = await pool().execute(
        """
        UPDATE photos
           SET state = 'uploaded', size_bytes = $2, mime = 'video/mp4',
               uploaded_at = now()
         WHERE id = $1 AND state = 'pending'
        """,
        photo_id, size,
    )
    if updated.endswith(" 0"):
        # Row vanished (deleted) mid-transcode — drop the result we just wrote.
        await asyncio.to_thread(delete_photos_object, final_key)
    await asyncio.to_thread(delete_photos_object, orig_key)
    logger.info("transcoded video %s (%d bytes)", photo_id, size)


async def _mark_failed(photo_id: UUID) -> None:
    try:
        row = await pool().fetchrow(
            "SELECT s3_key FROM photos WHERE id = $1 AND state = 'pending'",
            photo_id,
        )
        if row is None:
            return
        await pool().execute(
            "UPDATE photos SET state = 'failed' WHERE id = $1 AND state = 'pending'",
            photo_id,
        )
        # Clean up: the original is unusable to us, the result was never written.
        await asyncio.to_thread(delete_photos_object, orig_key_for(row["s3_key"]))
    except Exception:
        logger.exception("failed to mark video %s failed", photo_id)


async def reconcile_pending() -> None:
    """Re-launch transcodes left pending by a crashed/restarted process."""
    rows = await pool().fetch(
        "SELECT id FROM photos WHERE state = 'pending' AND mime LIKE 'video/%'"
    )
    for r in rows:
        logger.info("reconcile: re-launching transcode for %s", r["id"])
        schedule_transcode(r["id"])

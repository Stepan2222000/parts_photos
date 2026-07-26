"""Watermark-on-view: mechanical PIL compositing + URL routing helpers.

Clean photos always stay in S3. When a publication channel has
`photo_groups.watermark_enabled = true` AND `watermark_config.watermark_id`
is set, the API hands out photo URLs that point at GET /photos/{id}/wm —
that endpoint composites the watermark on the fly. Toggling the flag off
instantly restores direct S3 URLs; nothing is ever baked into storage.

The placement parameters are the ones validated in the marble/ARCTIC pilot
(June 2026): centered, ~40% of the photo width, ~55% opacity, with a soft
white halo behind the mark so dark logos stay readable on dark parts.
"""
from __future__ import annotations

import hashlib
import io
import threading
from uuid import UUID

from PIL import Image, ImageFilter

from .config import settings
from .db import pool
from .minio_client import public_url

# Pilot-validated placement constants (arctic_test, place()).
WIDTH_FRAC = 0.40
OPACITY = 0.55
HALO = 0.45

_JPEG_QUALITY = 92


def apply_watermark(base_bytes: bytes, wm_bytes: bytes) -> bytes:
    """Composite the watermark onto a photo. Returns JPEG bytes.

    Port of the pilot `place()`: resize the mark to WIDTH_FRAC of the photo
    width, drop its alpha to OPACITY, add a blurred white halo (HALO strength)
    underneath, alpha-composite in the center.
    """
    with Image.open(io.BytesIO(base_bytes)) as im:
        base = im.convert("RGBA")
    with Image.open(io.BytesIO(wm_bytes)) as im:
        wm = im.convert("RGBA")

    W, H = base.size
    tw = max(1, int(W * WIDTH_FRAC))
    th = max(1, int(tw * wm.height / wm.width))
    mark = wm.resize((tw, th), Image.LANCZOS)
    alpha = mark.split()[3].point(lambda v: int(v * OPACITY))
    mark.putalpha(alpha)
    pos = ((W - tw) // 2, (H - th) // 2)

    if HALO:
        m = Image.new("L", base.size, 0)
        m.paste(alpha, pos)
        m = m.filter(ImageFilter.GaussianBlur(max(1, tw * 0.05)))
        halo_layer = Image.new("RGBA", base.size, (255, 255, 255, 0))
        halo_layer.putalpha(m.point(lambda v: int(v * HALO)))
        base = Image.alpha_composite(base, halo_layer)

    layer = Image.new("RGBA", base.size, (0, 0, 0, 0))
    layer.paste(mark, pos, mark)
    out = Image.alpha_composite(base, layer).convert("RGB")

    buf = io.BytesIO()
    out.save(buf, format="JPEG", quality=_JPEG_QUALITY)
    return buf.getvalue()


# ---------------------------------------------------------------------------
# Watermark asset bytes cache (tiny: one active asset, invalidated by s3_key)
# ---------------------------------------------------------------------------

_asset_lock = threading.Lock()
_asset_cache: dict[str, bytes] = {}  # s3_key -> bytes


def cached_asset_bytes(s3_key: str, fetch) -> bytes:
    """Return watermark bytes for `s3_key`, fetching via `fetch()` on miss.
    Keeps only the most recent asset — config points at a single mark."""
    with _asset_lock:
        if s3_key in _asset_cache:
            return _asset_cache[s3_key]
    data = fetch()
    with _asset_lock:
        _asset_cache.clear()
        _asset_cache[s3_key] = data
    return data


# ---------------------------------------------------------------------------
# URL helpers
# ---------------------------------------------------------------------------


async def wm_active() -> bool:
    """True when a live watermark asset is configured — the global gate for
    handing out proxy URLs. Per-channel flags are checked by callers."""
    return bool(
        await pool().fetchval(
            """
            SELECT 1 FROM watermark_config c
            JOIN studio_watermarks w ON w.id = c.watermark_id AND w.deleted_at IS NULL
            WHERE c.id = 1
            """
        )
    )


def api_base() -> str:
    base = settings.api_public_base.strip().rstrip("/")
    return base or f"http://localhost:{settings.api_port}"


def wm_url(photo_id: UUID | str) -> str:
    return f"{api_base()}/photos/{photo_id}/wm"


def photo_url(
    photo_id: UUID | str,
    s3_key: str,
    mime: str | None,
    *,
    wm_enabled: bool,
) -> str:
    """URL for a photo: the watermark proxy when the channel flag is on (and
    the global asset is configured), otherwise the direct public S3 URL.
    Videos always go direct."""
    if wm_enabled and not (mime or "").startswith("video/"):
        return wm_url(photo_id)
    return public_url(s3_key)


def etag_for(s3_key: str, wm_key: str) -> str:
    return '"' + hashlib.md5(f"{s3_key}|{wm_key}".encode()).hexdigest() + '"'

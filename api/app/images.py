from __future__ import annotations

import io

from PIL import Image, UnidentifiedImageError
from pillow_heif import register_heif_opener

register_heif_opener()


class InvalidImage(Exception):
    """Raised when bytes can't be decoded as an image. Caller maps to HTTP 400."""


def _open_pil_from_bytes(raw: bytes) -> Image.Image:
    """Decode raw bytes into a Pillow Image (already loaded). Raises InvalidImage."""
    try:
        img = Image.open(io.BytesIO(raw))
        img.load()
        return img
    except (UnidentifiedImageError, OSError, SyntaxError) as e:
        raise InvalidImage(f"could not decode image: {e}") from e


def to_jpeg(raw: bytes, source_mime: str) -> bytes:
    """Decode raw bytes (jpeg/png/heic/etc.), re-encode as JPEG.

    No resize — original resolution is preserved per project requirement.
    Pass-through for already-JPEG inputs to skip lossy re-encoding.

    Raises InvalidImage with an explicit message on garbage / corrupt files.
    """
    if source_mime == "image/jpeg":
        # Cheap sanity check: must at least open as an image.
        try:
            with Image.open(io.BytesIO(raw)) as probe:
                probe.verify()
        except (UnidentifiedImageError, OSError, SyntaxError) as e:
            raise InvalidImage(f"file claims image/jpeg but failed to decode: {e}") from e
        return raw

    try:
        with Image.open(io.BytesIO(raw)) as img:
            if img.mode != "RGB":
                img = img.convert("RGB")
            out = io.BytesIO()
            img.save(out, format="JPEG", quality=90, optimize=True)
            return out.getvalue()
    except (UnidentifiedImageError, OSError, SyntaxError) as e:
        raise InvalidImage(f"could not decode image (mime={source_mime!r}): {e}") from e


# Codex / gpt-image-2 accepts only these for image references:
# https://platform.openai.com/docs/guides/images-vision (PNG, JPEG, WebP, non-animated GIF).
# HEIC/HEIF (iPhone default), BMP, TIFF, SVG, AVIF are not accepted — they
# return 400 from the OpenAI backend with an explicit "supported image
# formats" error. We convert anything outside the allowlist to JPEG (or PNG
# when alpha matters, e.g. watermarks).
_CODEX_PASSTHROUGH_MIMES = {"image/jpeg", "image/png", "image/webp"}


def ensure_codex_compatible(
    raw: bytes,
    source_mime: str,
    *,
    prefer_png: bool = False,
) -> tuple[bytes, str, str]:
    """Return (bytes, content_type, extension) ready to feed codex.

    Pass-through if `source_mime` is JPEG/PNG/WebP (after a verify check).
    Otherwise (HEIC, BMP, TIFF, AVIF, ...) decode and re-encode:
      - JPEG q=90 by default,
      - PNG when `prefer_png=True` (used for watermarks so alpha is kept).

    No resize. Caller decides max bytes upstream.
    """
    if source_mime in _CODEX_PASSTHROUGH_MIMES:
        try:
            with Image.open(io.BytesIO(raw)) as probe:
                probe.verify()
        except (UnidentifiedImageError, OSError, SyntaxError) as e:
            raise InvalidImage(
                f"file claims {source_mime} but failed to decode: {e}"
            ) from e
        ext = {"image/jpeg": "jpg", "image/png": "png", "image/webp": "webp"}[source_mime]
        return raw, source_mime, ext

    try:
        with Image.open(io.BytesIO(raw)) as img:
            if prefer_png:
                # Keep alpha if present.
                if img.mode not in ("RGB", "RGBA"):
                    img = img.convert("RGBA" if "A" in img.mode else "RGB")
                out = io.BytesIO()
                img.save(out, format="PNG", optimize=True)
                return out.getvalue(), "image/png", "png"
            else:
                if img.mode != "RGB":
                    img = img.convert("RGB")
                out = io.BytesIO()
                img.save(out, format="JPEG", quality=90, optimize=True)
                return out.getvalue(), "image/jpeg", "jpg"
    except (UnidentifiedImageError, OSError, SyntaxError) as e:
        raise InvalidImage(
            f"could not decode image (mime={source_mime!r}): {e}"
        ) from e

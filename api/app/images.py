from __future__ import annotations

import io

from PIL import Image, UnidentifiedImageError
from pillow_heif import register_heif_opener

register_heif_opener()


class InvalidImage(Exception):
    """Raised when bytes can't be decoded as an image. Caller maps to HTTP 400."""


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

from __future__ import annotations

import base64
from dataclasses import dataclass
from pathlib import Path

from openai import AsyncOpenAI

# Standard gpt-image edit sizes, chosen by source orientation. The model honors
# these exactly; arbitrary WxH is also accepted (divisible by 16, ratio 1:3..3:1)
# but we stick to the three canonical aspect ratios.
SIZE_SQUARE = "1024x1024"
SIZE_LANDSCAPE = "1536x1024"
SIZE_PORTRAIT = "1024x1536"


class CodexError(RuntimeError):
    """Raised when the image edit produces no usable image. Worker maps to a
    failed job. (Name kept for backward-compat with the worker's handlers.)"""

    def __init__(
        self,
        message: str,
        *,
        rc: int | None = None,
        rate_limited: bool = False,
        log_tail: str = "",
    ) -> None:
        super().__init__(message)
        self.rc = rc
        self.rate_limited = rate_limited
        self.log_tail = log_tail


@dataclass(slots=True)
class CodexResult:
    image: bytes
    tokens_used: int | None
    actual_quality: str | None
    revised_prompt: str | None
    log_tail: str
    elapsed_seconds: float


def size_for(width: int, height: int) -> str:
    """Pick the edit output size from the source image orientation."""
    if width == height:
        return SIZE_SQUARE
    return SIZE_LANDSCAPE if width > height else SIZE_PORTRAIT


async def run_codex(
    client: AsyncOpenAI,
    prompt: str,
    refs: list[Path],
    *,
    model: str,
    size: str,
    quality: str = "auto",
    timeout_seconds: float = 15 * 60,
) -> CodexResult:
    """Run a multi-reference image edit via the OpenAI `images.edit` endpoint.

    `refs` are the reference images in prompt order: [source, background?,
    watermark?]. The result image bytes are returned in memory — there is no
    filesystem session dir to clean up (unlike the old codex CLI runner).

    Quality is advisory: the actual value the model used is returned in
    `CodexResult.actual_quality` (the backend may not honor the request).
    """
    import time

    if not refs:
        raise CodexError("at least one reference image is required")

    started = time.monotonic()
    files = [open(p, "rb") for p in refs]
    try:
        resp = await client.with_options(timeout=timeout_seconds).images.edit(
            model=model,
            image=files,
            prompt=prompt,
            size=size,
            quality=quality,
        )
    finally:
        for f in files:
            f.close()

    elapsed = time.monotonic() - started

    data = resp.data or []
    b64 = getattr(data[0], "b64_json", None) if data else None
    if not b64:
        raise CodexError(
            "image edit returned no image (model refusal, content filter, or "
            "unsupported source) — check the request",
            log_tail=str(getattr(resp, "model_dump", lambda: resp)())[:2000],
        )

    image = base64.b64decode(b64)
    usage = getattr(resp, "usage", None)
    tokens_used = getattr(usage, "total_tokens", None) if usage else None
    actual_quality = getattr(resp, "quality", None)
    revised_prompt = getattr(data[0], "revised_prompt", None)

    log_tail = (
        f"quality={actual_quality} size={getattr(resp, 'size', size)} "
        f"tokens={tokens_used} elapsed={elapsed:.1f}s"
    )
    if revised_prompt:
        log_tail += f"\nrevised_prompt: {revised_prompt}"

    return CodexResult(
        image=image,
        tokens_used=tokens_used,
        actual_quality=actual_quality,
        revised_prompt=revised_prompt,
        log_tail=log_tail,
        elapsed_seconds=elapsed,
    )

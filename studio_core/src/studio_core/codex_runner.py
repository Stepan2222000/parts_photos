from __future__ import annotations

import asyncio
import collections
import re
import shutil
from dataclasses import dataclass
from pathlib import Path
from typing import Awaitable, Callable

CODEX_HOME = Path.home() / ".codex"
GENERATED_DIR = CODEX_HOME / "generated_images"

_SESSION_ID_RE = re.compile(r"^session id:\s*([0-9a-f-]+)\s*$", re.IGNORECASE)
_TOKENS_RE = re.compile(r"^tokens used\s*$", re.IGNORECASE)
_RATE_LIMIT_MARKERS = (
    "429",
    "rate limit",
    "rate-limit",
    "usage limit",
    "you've hit your usage",
    "too many requests",
)


class CodexError(RuntimeError):
    """Raised when codex exec exits non-zero or produces no output image."""

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
    image_path: Path
    session_id: str
    tokens_used: int | None
    log_tail: str
    elapsed_seconds: float


LogCallback = Callable[[str], Awaitable[None]]


def _detect_codex_binary() -> str:
    binary = shutil.which("codex")
    if binary is None:
        raise CodexError("codex CLI not found in PATH — install or expose it in the worker container")
    return binary


def _resolve_output(session_id: str, started_after: float) -> Path | None:
    """Find the latest ig_*.png inside the per-session dir.

    Falls back to scanning the parent generated_images/ for any file newer
    than `started_after` if the per-session dir is missing — this happens for
    very old codex versions.
    """
    sess_dir = GENERATED_DIR / session_id
    if sess_dir.is_dir():
        candidates = sorted(
            (p for p in sess_dir.iterdir() if p.is_file() and p.suffix.lower() == ".png"),
            key=lambda p: p.stat().st_mtime,
        )
        if candidates:
            return candidates[-1]

    if not GENERATED_DIR.is_dir():
        return None
    fallback = [
        p
        for p in GENERATED_DIR.rglob("*")
        if p.is_file()
        and p.suffix.lower() in {".png", ".jpg", ".jpeg", ".webp"}
        and p.stat().st_mtime >= started_after
    ]
    if not fallback:
        return None
    return max(fallback, key=lambda p: p.stat().st_mtime)


async def run_codex(
    prompt: str,
    refs: list[Path],
    *,
    log_callback: LogCallback | None = None,
    timeout_seconds: float = 15 * 60,
    cwd: Path | None = None,
) -> CodexResult:
    """Run `codex exec` with attached references and return the resulting image.

    Argument-order matters: the prompt is passed positionally FIRST, the
    `-i FILE,FILE,...` flag goes LAST (the -i value parser is greedy on this
    codex build and would eat the prompt otherwise). Stdin is closed because
    codex hangs if it sees an open pipe and no input.
    """
    if not refs:
        raise CodexError("at least one reference image is required")

    binary = _detect_codex_binary()
    started = asyncio.get_event_loop().time()

    args = [
        binary,
        "exec",
        "--sandbox",
        "workspace-write",
        "--skip-git-repo-check",
        "--ephemeral",
        "--color",
        "never",
        prompt,
        "-i",
        ",".join(str(p) for p in refs),
    ]

    proc = await asyncio.create_subprocess_exec(
        *args,
        stdin=asyncio.subprocess.DEVNULL,
        stdout=asyncio.subprocess.DEVNULL,
        stderr=asyncio.subprocess.PIPE,
        cwd=str(cwd) if cwd else None,
    )

    log_buf: collections.deque[str] = collections.deque(maxlen=40)
    session_id: str | None = None
    tokens_used: int | None = None
    rate_limited = False
    capture_tokens = False

    try:
        async with asyncio.timeout(timeout_seconds):
            assert proc.stderr is not None
            async for raw in proc.stderr:
                line = raw.decode(errors="ignore").rstrip("\n")
                log_buf.append(line)
                if session_id is None:
                    m = _SESSION_ID_RE.match(line.strip())
                    if m:
                        session_id = m.group(1)
                if not rate_limited:
                    low = line.lower()
                    if any(marker in low for marker in _RATE_LIMIT_MARKERS):
                        rate_limited = True
                if capture_tokens:
                    digits = re.sub(r"[^0-9]", "", line)
                    if digits:
                        try:
                            tokens_used = int(digits)
                        except ValueError:
                            pass
                    capture_tokens = False
                elif _TOKENS_RE.match(line.strip()):
                    capture_tokens = True
                if log_callback is not None:
                    await log_callback("\n".join(log_buf))
            rc = await proc.wait()
    except TimeoutError:
        proc.kill()
        await proc.wait()
        raise CodexError(
            f"codex exec timed out after {timeout_seconds}s",
            rc=None,
            rate_limited=rate_limited,
            log_tail="\n".join(log_buf),
        )

    elapsed = asyncio.get_event_loop().time() - started

    if rc != 0:
        raise CodexError(
            f"codex exec exited rc={rc}",
            rc=rc,
            rate_limited=rate_limited,
            log_tail="\n".join(log_buf),
        )
    if session_id is None:
        raise CodexError(
            "codex exec did not emit a session id — cannot locate output image",
            rc=rc,
            rate_limited=rate_limited,
            log_tail="\n".join(log_buf),
        )
    image_path = _resolve_output(session_id, started_after=started - 5)
    if image_path is None:
        raise CodexError(
            f"no image generated by codex (session {session_id})",
            rc=rc,
            rate_limited=rate_limited,
            log_tail="\n".join(log_buf),
        )
    return CodexResult(
        image_path=image_path,
        session_id=session_id,
        tokens_used=tokens_used,
        log_tail="\n".join(log_buf),
        elapsed_seconds=elapsed,
    )


def run_codex_sync(
    prompt: str,
    refs: list[Path],
    *,
    timeout_seconds: float = 15 * 60,
    cwd: Path | None = None,
) -> CodexResult:
    """Synchronous helper for the CLI."""
    return asyncio.run(
        run_codex(prompt, refs, timeout_seconds=timeout_seconds, cwd=cwd)
    )

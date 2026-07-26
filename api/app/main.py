from __future__ import annotations

import asyncio
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from . import video
from .config import settings
from .db import close_pool, init_pool
from .routers import (
    arrivals,
    backgrounds,
    collages,
    gaps,
    groups,
    owners,
    photos,
    studio,
    watermark,
)
from .studio.storage import ensure_bucket as ensure_studio_bucket


@asynccontextmanager
async def lifespan(app: FastAPI):
    await init_pool()
    await asyncio.to_thread(ensure_studio_bucket)
    # Re-launch any video transcode left pending by a previous process.
    await video.reconcile_pending()
    try:
        yield
    finally:
        await close_pool()


app = FastAPI(title="photos_api", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    # WEB_ORIGIN supports a comma-separated list (e.g. dev 3000 + prod 3100).
    allow_origins=[o.strip() for o in settings.web_origin.split(",") if o.strip()],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(groups.router)
app.include_router(collages.router)
app.include_router(photos.router)
app.include_router(owners.router)
app.include_router(studio.router)
app.include_router(gaps.router)
app.include_router(arrivals.router)
app.include_router(watermark.router)
app.include_router(backgrounds.router)


@app.get("/health")
async def health() -> dict[str, str]:
    return {"status": "ok"}

from __future__ import annotations

import asyncio
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .config import settings
from .db import close_pool, init_pool
from .routers import collages, groups, owners, photos, studio
from .studio.storage import ensure_bucket as ensure_studio_bucket


@asynccontextmanager
async def lifespan(app: FastAPI):
    await init_pool()
    await asyncio.to_thread(ensure_studio_bucket)
    try:
        yield
    finally:
        await close_pool()


app = FastAPI(title="photos_api", lifespan=lifespan)

# Comma-separated WEB_ORIGIN — e.g. http://localhost:3000,http://localhost:3100
_cors_origins = [o.strip() for o in settings.web_origin.split(",") if o.strip()]

app.add_middleware(
    CORSMiddleware,
    allow_origins=_cors_origins,
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(groups.router)
app.include_router(collages.router)
app.include_router(photos.router)
app.include_router(owners.router)
app.include_router(studio.router)


@app.get("/health")
async def health() -> dict[str, str]:
    return {"status": "ok"}

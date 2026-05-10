from __future__ import annotations

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8")

    pg_dsn: str
    minio_endpoint: str
    minio_access_key: str
    minio_secret_key: str
    minio_bucket: str
    minio_public_base: str
    minio_secure: bool = False
    web_origin: str = "http://localhost:3000"
    api_port: int = 8001

    # Studio (image generation)
    studio_minio_bucket: str = "parts-photos-studio"
    studio_minio_public_base: str = ""  # falls back to derived from minio_public_base
    studio_max_workers: int = 10
    studio_min_workers: int = 2
    studio_max_source_bytes: int = 25 * 1024 * 1024  # gpt-image-2 hard limit
    studio_codex_timeout_seconds: int = 15 * 60


settings = Settings()

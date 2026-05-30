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
    studio_image_timeout_seconds: int = 15 * 60

    # Video uploads (only into source photo groups). Originals are transcoded to
    # web-playable mp4 (H.264/AAC, +faststart) in a background task.
    max_video_bytes: int = 200 * 1024 * 1024
    video_transcode_concurrency: int = 2
    ffmpeg_bin: str = "ffmpeg"
    ffprobe_bin: str = "ffprobe"

    # Studio image-edit backend (OpenAI-compatible /images/edits endpoint)
    studio_openai_base_url: str = "https://api.openai.com/v1"
    studio_openai_api_key: str = ""
    studio_image_model: str = "gpt-image-2"
    studio_image_quality: str = "auto"  # advisory; backend may not honor it


settings = Settings()

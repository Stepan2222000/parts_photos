from __future__ import annotations

import io

from minio import Minio

from .config import settings

_client: Minio | None = None


def client() -> Minio:
    global _client
    if _client is None:
        _client = Minio(
            settings.minio_endpoint,
            access_key=settings.minio_access_key,
            secret_key=settings.minio_secret_key,
            secure=settings.minio_secure,
        )
    return _client


def put_jpeg(s3_key: str, data: bytes) -> None:
    """Upload JPEG bytes. Raises minio.error.S3Error on failure — caller decides."""
    buf = io.BytesIO(data)
    client().put_object(
        bucket_name=settings.minio_bucket,
        object_name=s3_key,
        data=buf,
        length=len(data),
        content_type="image/jpeg",
    )


def public_url(s3_key: str) -> str:
    return f"{settings.minio_public_base}/{s3_key}"

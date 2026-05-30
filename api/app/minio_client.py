from __future__ import annotations

import io

from minio import Minio
from minio.commonconfig import CopySource

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


def put_object(bucket: str, s3_key: str, data: bytes, content_type: str) -> None:
    """Upload bytes to a specific bucket. Raises minio.error.S3Error on failure."""
    client().put_object(
        bucket_name=bucket,
        object_name=s3_key,
        data=io.BytesIO(data),
        length=len(data),
        content_type=content_type,
    )


def put_jpeg(s3_key: str, data: bytes) -> None:
    """Photos-bucket JPEG upload (back-compat for the photos router)."""
    put_object(settings.minio_bucket, s3_key, data, "image/jpeg")


def put_file(bucket: str, s3_key: str, path: str, content_type: str) -> None:
    """Stream a local file into a bucket without loading it into memory.
    Used for transcoded video (potentially hundreds of MB)."""
    client().fput_object(bucket, s3_key, path, content_type=content_type)


def public_url(s3_key: str, bucket: str | None = None) -> str:
    if bucket is None or bucket == settings.minio_bucket:
        return f"{settings.minio_public_base}/{s3_key}"
    base = settings.minio_public_base.rstrip("/")
    if base.endswith("/" + settings.minio_bucket):
        base = base[: -len(settings.minio_bucket) - 1]
    return f"{base}/{bucket}/{s3_key}"


def copy_object(src_bucket: str, src_key: str, dst_bucket: str, dst_key: str) -> None:
    """Server-side copy between buckets. No bytes flow through the client."""
    client().copy_object(
        bucket_name=dst_bucket,
        object_name=dst_key,
        source=CopySource(src_bucket, src_key),
    )

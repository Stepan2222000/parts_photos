"""MinIO helpers for the Studio bucket. Separate from the legacy
api.app.minio_client which is hard-coded to the photos bucket.
"""
from __future__ import annotations

import io
import json
from pathlib import Path

from minio import Minio
from minio.error import S3Error

from ..config import settings
from ..minio_client import client as photos_client


def studio_bucket() -> str:
    return settings.studio_minio_bucket


def _public_base() -> str:
    if settings.studio_minio_public_base:
        return settings.studio_minio_public_base.rstrip("/")
    # derive from photos public base by replacing the bucket segment
    base = settings.minio_public_base.rstrip("/")
    if base.endswith("/" + settings.minio_bucket):
        base = base[: -len(settings.minio_bucket) - 1]
    return f"{base}/{settings.studio_minio_bucket}"


def studio_url(s3_key: str) -> str:
    return f"{_public_base()}/{s3_key}"


def _public_read_policy(bucket: str) -> str:
    """Same anonymous-read shape as the legacy `parts-photos` bucket: clients
    can list the bucket and GET any object without auth, but cannot mutate.
    """
    return json.dumps(
        {
            "Version": "2012-10-17",
            "Statement": [
                {
                    "Effect": "Allow",
                    "Principal": {"AWS": ["*"]},
                    "Action": ["s3:GetBucketLocation", "s3:ListBucket"],
                    "Resource": [f"arn:aws:s3:::{bucket}"],
                },
                {
                    "Effect": "Allow",
                    "Principal": {"AWS": ["*"]},
                    "Action": ["s3:GetObject"],
                    "Resource": [f"arn:aws:s3:::{bucket}/*"],
                },
            ],
        }
    )


def ensure_bucket(client: Minio | None = None) -> None:
    """Create the Studio bucket if it does not exist + apply public-read
    policy so the web frontend can render images without signed URLs.
    Idempotent on both create and policy.
    """
    c = client or photos_client()
    bucket = studio_bucket()
    try:
        if not c.bucket_exists(bucket):
            c.make_bucket(bucket)
    except S3Error as e:
        if "BucketAlreadyOwnedByYou" not in str(e):
            raise
    c.set_bucket_policy(bucket, _public_read_policy(bucket))


def put_bytes(s3_key: str, data: bytes, content_type: str) -> None:
    photos_client().put_object(
        bucket_name=studio_bucket(),
        object_name=s3_key,
        data=io.BytesIO(data),
        length=len(data),
        content_type=content_type,
    )


def remove_object(s3_key: str) -> None:
    photos_client().remove_object(studio_bucket(), s3_key)


def fetch_to(s3_key: str, dest: Path, *, bucket: str | None = None) -> None:
    """Download an object into a local file. Creates parent dirs as needed."""
    dest.parent.mkdir(parents=True, exist_ok=True)
    use_bucket = bucket or studio_bucket()
    photos_client().fget_object(use_bucket, s3_key, str(dest))

"""Studio MinIO helpers — thin layer over the shared `minio_client` that
fixes the bucket to the Studio bucket and adds the bucket-bootstrap step.
"""
from __future__ import annotations

import json
import logging
from pathlib import Path

from minio.error import S3Error

from ..config import settings
from ..minio_client import (
    client as minio,
    copy_object,
    public_url,
    put_object,
)

log = logging.getLogger("studio.storage")


def studio_bucket() -> str:
    return settings.studio_minio_bucket


def studio_url(s3_key: str) -> str:
    return public_url(s3_key, bucket=studio_bucket())


def ensure_bucket() -> None:
    """Create the Studio bucket on first run + apply the same public-read
    policy as the legacy `parts-photos` bucket. Idempotent."""
    c = minio()
    bucket = studio_bucket()
    try:
        if not c.bucket_exists(bucket):
            c.make_bucket(bucket)
    except S3Error as e:
        if "BucketAlreadyOwnedByYou" not in str(e):
            raise
    c.set_bucket_policy(bucket, _public_read_policy(bucket))


def _public_read_policy(bucket: str) -> str:
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


def put_bytes(s3_key: str, data: bytes, content_type: str) -> None:
    put_object(studio_bucket(), s3_key, data, content_type)


def fetch_to(s3_key: str, dest: Path, *, bucket: str | None = None) -> None:
    """Download an object into a local file. Creates parent dirs as needed."""
    dest.parent.mkdir(parents=True, exist_ok=True)
    minio().fget_object(bucket or studio_bucket(), s3_key, str(dest))


def move_studio_to_photos(src_key: str, dest_key: str) -> None:
    """Copy from the Studio bucket to the photos bucket, then delete the
    source. Used when transferring a generated result into a collage."""
    copy_object(studio_bucket(), src_key, settings.minio_bucket, dest_key)
    try:
        minio().remove_object(studio_bucket(), src_key)
    except Exception as e:
        log.warning(
            "studio orphan: copied %s → %s but failed to delete source: %s",
            src_key,
            dest_key,
            e,
        )

"""Voice-note audio in the private S3 bucket (``S3_BUCKET``).

The browser never talks to S3 with credentials: the backend uploads, and hands out
short-lived signed links for playback.
"""
from __future__ import annotations

from functools import lru_cache

import boto3
from botocore.config import Config
from botocore.exceptions import BotoCoreError, ClientError

from core.config import AWS_REGION, S3_BUCKET

PREFIX = "dedup/voice-notes"
# How long a playback link works.
LINK_SECONDS = 15 * 60


class StorageError(Exception):
    """S3 is not set up, or a call to it failed."""


@lru_cache(maxsize=1)
def _client():
    # The regional endpoint: on the global one, links to a new bucket answer 307 until
    # AWS's DNS catches up, and audio players do not follow that.
    return boto3.client(
        "s3",
        region_name=AWS_REGION,
        endpoint_url=f"https://s3.{AWS_REGION}.amazonaws.com",
        config=Config(signature_version="s3v4", s3={"addressing_style": "virtual"}),
    )


def _bucket() -> str:
    if not S3_BUCKET:
        raise StorageError("Voice-note storage is not set up: S3_BUCKET is missing on the server.")
    return S3_BUCKET


def key_for(item_id: int, voice_note_id: str) -> str:
    return f"{PREFIX}/{item_id}/{voice_note_id}.wav"


def upload(key: str, data: bytes, content_type: str) -> None:
    try:
        _client().put_object(Bucket=_bucket(), Key=key, Body=data, ContentType=content_type)
    except (BotoCoreError, ClientError) as exc:
        raise StorageError(f"Could not store the recording: {exc}") from exc


def playback_url(key: str) -> str:
    try:
        return _client().generate_presigned_url(
            "get_object", Params={"Bucket": _bucket(), "Key": key}, ExpiresIn=LINK_SECONDS
        )
    except (BotoCoreError, ClientError) as exc:
        raise StorageError(f"Could not make a playback link: {exc}") from exc

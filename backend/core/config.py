import os
from dotenv import load_dotenv

load_dotenv(override=True)

DATABASE_URL = os.getenv(
    "DATABASE_URL",
    ""
)

# BEC OpenPecha / OT API (volume batch aggregates for admin dashboard)
BEC_OTAPI_BASE_URL = os.getenv("BEC_OTAPI_BASE_URL", "https://bec-otapi.bdrc.io").rstrip("/")

# Sending dedup answers to BDRC. On unless DEDUP_SYNC=off: set that on a local machine,
# whose answers must not reach BDRC (they stay queued in the local database instead).
DEDUP_SYNC_ENABLED = os.getenv("DEDUP_SYNC", "on").strip().lower() not in ("off", "0", "false", "no")

# BDRC's editions API (Author Identification) sits behind a password. It stays on the
# server: the browser only talks to our backend.
EDITIONS_TOOL_USER = os.getenv("EDITIONS_TOOL_USER", "").strip()
EDITIONS_TOOL_PASSWORD = os.getenv("EDITIONS_TOOL_PASSWORD", "").strip()

# The BDRC batch "Assign work" hands texts out from (BDRC's first batch is "1").
AUTHOR_IDENTIFICATION_BATCH_ID = os.getenv("AUTHOR_IDENTIFICATION_BATCH_ID", "1").strip() or "1"

# Sending Author Identification answers to BDRC. On unless AUTHOR_IDENTIFICATION_SYNC=off:
# set that on a local machine, so test answers never reach BDRC (they stay queued in the
# local database instead).
AUTHOR_IDENTIFICATION_SYNC_ENABLED = os.getenv("AUTHOR_IDENTIFICATION_SYNC", "on").strip().lower() not in (
    "off", "0", "false", "no",
)

# Monlam AI speech-to-text, for the Deduplicator's voice notes. The key is an
# organisation key: it stays on the server and is never sent to the browser.
MONLAM_API_BASE_URL = os.getenv("MONLAM_API_BASE_URL", "https://api-v1.monlamai.studio").rstrip("/")
MONLAM_API_KEY = os.getenv("MONLAM_API_KEY", "").strip()

# Private S3 bucket for voice-note audio. boto3 reads AWS_ACCESS_KEY_ID and
# AWS_SECRET_ACCESS_KEY from the environment itself.
S3_BUCKET = os.getenv("S3_BUCKET", "").strip()
AWS_REGION = os.getenv("AWS_REGION", "ap-southeast-1").strip()

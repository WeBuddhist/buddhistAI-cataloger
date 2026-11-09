import os
from dotenv import load_dotenv

load_dotenv(override=True)

DATABASE_URL = os.getenv(
    "DATABASE_URL",
    ""
)

# BEC OpenPecha / OT API (volume batch aggregates for admin dashboard)
BEC_OTAPI_BASE_URL = os.getenv("BEC_OTAPI_BASE_URL", "https://bec-otapi.bdrc.io").rstrip("/")

# Monlam AI speech-to-text, for the Deduplicator's voice notes. The key is an
# organisation key: it stays on the server and is never sent to the browser.
MONLAM_API_BASE_URL = os.getenv("MONLAM_API_BASE_URL", "https://api-v1.monlamai.studio").rstrip("/")
MONLAM_API_KEY = os.getenv("MONLAM_API_KEY", "").strip()

# Private S3 bucket for voice-note audio. boto3 reads AWS_ACCESS_KEY_ID and
# AWS_SECRET_ACCESS_KEY from the environment itself.
S3_BUCKET = os.getenv("S3_BUCKET", "").strip()
AWS_REGION = os.getenv("AWS_REGION", "ap-southeast-1").strip()

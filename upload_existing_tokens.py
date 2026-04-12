"""
One-time script to upload existing local Garmin token files to Supabase.
Run this instead of garmin_bootstrap.py when you already have token files.
"""
import os
from datetime import datetime, timezone
from pathlib import Path

import requests
from dotenv import load_dotenv

load_dotenv(".env.local")

SUPABASE_URL = (os.environ.get("SUPABASE_URL") or os.environ["NEXT_PUBLIC_SUPABASE_URL"]).rstrip("/")
SUPABASE_SERVICE_ROLE_KEY = os.environ["SUPABASE_SERVICE_ROLE_KEY"]
USER_ID = os.environ["SUPABASE_USER_ID"]

TOKEN_DIR = Path("garmin-sync/tokens")

token_files = {
    f.name: f.read_text(encoding="utf-8")
    for f in TOKEN_DIR.iterdir()
    if f.is_file()
}

if not token_files:
    raise RuntimeError(f"No token files found in {TOKEN_DIR}")

print(f"Found {len(token_files)} token file(s): {', '.join(token_files.keys())}")

res = requests.post(
    f"{SUPABASE_URL}/rest/v1/garmin_token_store",
    headers={
        "apikey": SUPABASE_SERVICE_ROLE_KEY,
        "Authorization": f"Bearer {SUPABASE_SERVICE_ROLE_KEY}",
        "Content-Type": "application/json",
        "Prefer": "resolution=merge-duplicates",
    },
    json={
        "user_id": USER_ID,
        "token_files": token_files,
        "updated_at": datetime.now(timezone.utc).isoformat(),
    },
)

if res.status_code >= 400:
    raise RuntimeError(f"Failed to upload tokens: {res.status_code} {res.text}")

print("Tokens uploaded to Supabase successfully.")
print("GitHub Actions workflow will now reuse these tokens on every run.")

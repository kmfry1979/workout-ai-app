#!/usr/bin/env python3
"""
Local-only script: log in to Garmin from your home machine and upload
fresh tokens to Supabase so GitHub Actions can use them.

Run from the garmin-sync directory:
  cd garmin-sync
  python bootstrap_tokens.py

Reads credentials from ../.env.local (or environment variables).
"""

from __future__ import annotations

import json
import os
import sys
from pathlib import Path

import requests
from dotenv import load_dotenv
from garminconnect import Garmin

# Load from .env.local in project root
env_path = Path(__file__).parent.parent / ".env.local"
load_dotenv(env_path)
load_dotenv()  # also try .env in cwd

GARMIN_EMAIL    = os.getenv("GARMIN_EMAIL", "").strip()
GARMIN_PASSWORD = os.getenv("GARMIN_PASSWORD", "").strip()
SUPABASE_URL    = (os.getenv("SUPABASE_URL") or os.getenv("NEXT_PUBLIC_SUPABASE_URL") or "").rstrip("/")
SUPABASE_KEY    = os.getenv("SUPABASE_SERVICE_ROLE_KEY", "").strip()
SUPABASE_USER_ID = os.getenv("SUPABASE_USER_ID", "").strip()
TOKENS_DIR      = Path(__file__).parent / "tokens"

# ── validation ────────────────────────────────────────────────────────────────

missing = [k for k, v in {
    "GARMIN_EMAIL": GARMIN_EMAIL,
    "GARMIN_PASSWORD": GARMIN_PASSWORD,
    "SUPABASE_URL": SUPABASE_URL,
    "SUPABASE_SERVICE_ROLE_KEY": SUPABASE_KEY,
    "SUPABASE_USER_ID": SUPABASE_USER_ID,
}.items() if not v]

if missing:
    print(f"ERROR: Missing environment variables: {', '.join(missing)}")
    print(f"Looked for .env.local at: {env_path}")
    sys.exit(1)

# ── Garmin login ───────────────────────────────────────────────────────────────

print(f"Logging in to Garmin as {GARMIN_EMAIL} ...")
TOKENS_DIR.mkdir(parents=True, exist_ok=True)

# Unset GARMINTOKENS so garminconnect doesn't try to load stale files
os.environ.pop("GARMINTOKENS", None)

api = Garmin(email=GARMIN_EMAIL, password=GARMIN_PASSWORD, is_cn=False)

try:
    api.login()
except Exception as exc:
    err = str(exc)
    if "MFA" in err or "mfa" in err or "factor" in err.lower():
        print("MFA required. Check your email/phone for the code.")
        code = input("Enter MFA code: ").strip()
        # garminconnect 0.2.x doesn't expose resume_login without return_on_mfa,
        # so we need to use garth directly if MFA is needed.
        print("ERROR: MFA flow not supported in automated bootstrap.")
        print("Disable MFA temporarily in your Garmin account, run this script, then re-enable it.")
        sys.exit(1)
    raise

# ── Save tokens locally ────────────────────────────────────────────────────────

api.garth.dump(str(TOKENS_DIR))

token_files_found = list(TOKENS_DIR.glob("*.json"))
print(f"Saved {len(token_files_found)} token file(s) locally: {[f.name for f in token_files_found]}")

# Verify files are non-empty valid JSON
for f in token_files_found:
    content = f.read_text(encoding="utf-8").strip()
    if not content:
        print(f"ERROR: {f.name} is empty after login — something went wrong.")
        sys.exit(1)
    try:
        json.loads(content)
        print(f"  ✓ {f.name} ({len(content)} bytes, valid JSON)")
    except json.JSONDecodeError as e:
        print(f"  ✗ {f.name} is not valid JSON: {e}")
        sys.exit(1)

# ── Upload to Supabase ─────────────────────────────────────────────────────────

token_files: dict[str, str] = {
    f.name: f.read_text(encoding="utf-8")
    for f in token_files_found
}

headers = {
    "apikey": SUPABASE_KEY,
    "Authorization": f"Bearer {SUPABASE_KEY}",
    "Content-Type": "application/json",
    "Prefer": "resolution=merge-duplicates",
}

resp = requests.post(
    f"{SUPABASE_URL}/rest/v1/garmin_token_store",
    headers=headers,
    params={"on_conflict": "user_id"},
    json={
        "user_id": SUPABASE_USER_ID,
        "token_files": token_files,
    },
    timeout=15,
)

if resp.status_code in (200, 201, 204):
    print(f"\nTokens uploaded to Supabase successfully (HTTP {resp.status_code}).")
    print("You can now trigger the GitHub Actions Garmin Sync workflow.")
else:
    print(f"\nERROR uploading to Supabase: HTTP {resp.status_code}")
    print(resp.text[:500])
    sys.exit(1)

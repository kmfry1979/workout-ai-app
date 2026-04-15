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

os.environ.pop("GARMINTOKENS", None)

def mfa_prompt() -> str:
    return input("Enter Garmin MFA code: ").strip()

api = Garmin(
    email=GARMIN_EMAIL,
    password=GARMIN_PASSWORD,
    is_cn=False,
    prompt_mfa=mfa_prompt,
)
api.login()

# ── Get token content ──────────────────────────────────────────────────────────

token_content = api.client.dumps()

if not token_content or not token_content.strip():
    print("ERROR: token content is empty after login — something went wrong.")
    sys.exit(1)

# Validate it's real JSON
try:
    json.loads(token_content)
    print(f"  ✓ garmin_tokens.json ({len(token_content)} bytes, valid JSON)")
except json.JSONDecodeError as e:
    print(f"  ✗ Token content is not valid JSON: {e}")
    sys.exit(1)

# ── Upload to Supabase ─────────────────────────────────────────────────────────

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
        "token_files": {"garmin_tokens.json": token_content},
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

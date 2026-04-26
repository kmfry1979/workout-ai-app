#!/usr/bin/env python3
"""
Local-only script: upload fresh Garmin tokens to Supabase so GitHub Actions can use them.

PREFERRED (no login needed, no rate-limit risk):
  If you've done a successful local sync recently, tokens are already saved
  in ./tokens/. This script will upload them directly.

FALLBACK (fresh login):
  If no local tokens exist, it logs in with email/password. This can hit
  Garmin's 429 rate-limit if attempted too soon after failed logins — wait
  a few hours if that happens.

Run from the garmin-sync directory:
  cd garmin-sync
  python bootstrap_tokens.py
"""

from __future__ import annotations

import json
import os
import sys
from pathlib import Path

import requests
from dotenv import load_dotenv

# Load from .env.local in project root, then .env in cwd
env_path = Path(__file__).parent.parent / ".env.local"
load_dotenv(env_path)
load_dotenv()

GARMIN_EMAIL     = os.getenv("GARMIN_EMAIL", "").strip()
GARMIN_PASSWORD  = os.getenv("GARMIN_PASSWORD", "").strip()
SUPABASE_URL     = (os.getenv("SUPABASE_URL") or os.getenv("NEXT_PUBLIC_SUPABASE_URL") or "").rstrip("/")
SUPABASE_KEY     = (os.getenv("SUPABASE_SERVICE_ROLE_KEY") or "").split('\n')[0].strip()
SUPABASE_USER_ID = os.getenv("SUPABASE_USER_ID", "").strip()
TOKENS_DIR       = Path(os.getenv("GARMINTOKENS", "./tokens")).expanduser()

for var, val in {"SUPABASE_URL": SUPABASE_URL, "SUPABASE_SERVICE_ROLE_KEY": SUPABASE_KEY, "SUPABASE_USER_ID": SUPABASE_USER_ID}.items():
    if not val:
        print(f"ERROR: {var} not set in .env / .env.local")
        sys.exit(1)


# ── Step 1: try to read tokens already saved by a previous local sync ──────────

def load_local_tokens() -> str | None:
    """
    Try to load garmin_tokens.json from the local tokens directory.
    Returns the JSON string, or None if not found / invalid.
    """
    candidates = [
        TOKENS_DIR / "garmin_tokens.json",
        TOKENS_DIR / "oauth2_token.json",   # garth sometimes uses this name
        TOKENS_DIR / ".garminconnect",
    ]
    for path in candidates:
        if path.exists():
            try:
                content = path.read_text(encoding="utf-8").strip()
                if content:
                    json.loads(content)   # validate JSON
                    print(f"  ✓ Found local tokens: {path} ({len(content)} bytes)")
                    return content
            except (json.JSONDecodeError, OSError):
                continue
    # Also look for any .json file in TOKENS_DIR
    if TOKENS_DIR.is_dir():
        for path in TOKENS_DIR.glob("*.json"):
            try:
                content = path.read_text(encoding="utf-8").strip()
                if content and len(content) > 50:
                    json.loads(content)
                    print(f"  ✓ Found local tokens: {path} ({len(content)} bytes)")
                    return content
            except (json.JSONDecodeError, OSError):
                continue
    return None


token_content = load_local_tokens()

if token_content:
    print("Using existing local tokens (no Garmin login needed).")
else:
    # ── Step 2: fresh login ─────────────────────────────────────────────────────
    if not GARMIN_EMAIL or not GARMIN_PASSWORD:
        print("ERROR: No local tokens found and GARMIN_EMAIL/GARMIN_PASSWORD not set.")
        print(f"  Looked in: {TOKENS_DIR}")
        print("  Add credentials to .env and retry, or wait a few hours if rate-limited.")
        sys.exit(1)

    print(f"No local tokens found. Logging in to Garmin as {GARMIN_EMAIL} ...")
    print("  (If this hits a 429 rate-limit, wait a few hours and try again)")

    from garminconnect import Garmin

    def mfa_prompt() -> str:
        return input("Enter Garmin MFA code: ").strip()

    os.environ.pop("GARMINTOKENS", None)   # force fresh, don't load stale local files

    api = Garmin(email=GARMIN_EMAIL, password=GARMIN_PASSWORD, is_cn=False, prompt_mfa=mfa_prompt)
    api.login()

    _garth = getattr(api, 'garth', None) or getattr(api, 'client', None)
    token_content = _garth.dumps()

    if not token_content or not token_content.strip():
        print("ERROR: token content is empty after login.")
        sys.exit(1)

    try:
        json.loads(token_content)
        print(f"  ✓ Login successful, got {len(token_content)} bytes of tokens.")
    except json.JSONDecodeError as e:
        print(f"  ✗ Token content is not valid JSON: {e}")
        sys.exit(1)


# ── Step 3: upload to Supabase ─────────────────────────────────────────────────

print(f"\nUploading tokens to Supabase ({SUPABASE_URL[:40]}…)")

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
    print(f"Tokens uploaded successfully (HTTP {resp.status_code}).")
    print("You can now trigger the GitHub Actions Garmin Sync workflow.")
else:
    print(f"\nERROR uploading to Supabase: HTTP {resp.status_code}")
    print(resp.text[:500])
    sys.exit(1)

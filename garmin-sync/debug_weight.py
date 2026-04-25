#!/usr/bin/env python3
"""
Debug script: prints raw Garmin weight API responses so we can see
exactly what format the data comes back in.

Run from garmin-sync/ directory:
    python debug_weight.py

Uses the same token login as sync_once.py.
"""
import json
import os
import sys
from datetime import date, timedelta
from pathlib import Path

from dotenv import load_dotenv
from garminconnect import Garmin

load_dotenv()

TOKENS_DIR = Path(os.getenv("GARMINTOKENS", "./tokens")).expanduser()
SUPABASE_URL = (os.getenv("SUPABASE_URL") or os.getenv("NEXT_PUBLIC_SUPABASE_URL") or "").rstrip("/")
SUPABASE_SERVICE_ROLE_KEY = os.getenv("SUPABASE_SERVICE_ROLE_KEY", "").strip()
SUPABASE_USER_ID = os.getenv("SUPABASE_USER_ID", "").strip()

# ── Login ──────────────────────────────────────────────────────────────────────

def login_garmin() -> Garmin:
    token_file = TOKENS_DIR / "garmin_tokens.json"
    if not token_file.exists():
        # Try pulling from Supabase
        import requests
        session = requests.Session()
        session.headers.update({
            "apikey": SUPABASE_SERVICE_ROLE_KEY,
            "Authorization": f"Bearer {SUPABASE_SERVICE_ROLE_KEY}",
        })
        try:
            resp = session.get(
                f"{SUPABASE_URL}/rest/v1/garmin_token_store",
                params={"user_id": f"eq.{SUPABASE_USER_ID}", "select": "token_files", "limit": "1"},
            )
            if resp.ok:
                rows = resp.json()
                if rows:
                    tf = rows[0].get("token_files", {})
                    content = tf.get("garmin_tokens.json")
                    if content:
                        TOKENS_DIR.mkdir(parents=True, exist_ok=True)
                        token_file.write_text(content if isinstance(content, str) else json.dumps(content))
                        print("Loaded tokens from Supabase.")
        except Exception as e:
            print(f"Could not load tokens from Supabase: {e}")

    if token_file.exists():
        api = Garmin(is_cn=False)
        api.login(tokenstore=str(TOKENS_DIR))
        print("Logged in via token file.")
        return api

    email = os.getenv("GARMIN_EMAIL", "")
    password = os.getenv("GARMIN_PASSWORD", "")
    if not email or not password:
        sys.exit("No token file found and GARMIN_EMAIL/GARMIN_PASSWORD not set.")
    api = Garmin(email=email, password=password, is_cn=False)
    api.login()
    print("Logged in via email/password.")
    return api


# ── Main ───────────────────────────────────────────────────────────────────────

def pp(label: str, data):
    print(f"\n{'='*60}")
    print(f"  {label}")
    print('='*60)
    print(json.dumps(data, indent=2, default=str)[:4000])  # cap at 4000 chars


def main():
    api = login_garmin()

    end_date = date.today().isoformat()
    start_date = (date.today() - timedelta(days=30)).isoformat()
    print(f"\nDate range: {start_date} → {end_date}\n")

    # 1. get_weigh_ins
    print("Calling api.get_weigh_ins()...")
    try:
        result = api.get_weigh_ins(start_date, end_date)
        pp("get_weigh_ins() raw response", result)
        wlist = result.get("dateWeightList") if isinstance(result, dict) else result
        if wlist:
            print(f"\n  ✓ Found {len(wlist)} entries in dateWeightList")
            print(f"  First entry keys: {list(wlist[0].keys()) if wlist else 'N/A'}")
            print(f"  First entry: {json.dumps(wlist[0], default=str)}")
        else:
            print(f"\n  ✗ No dateWeightList found. Top-level keys: {list(result.keys()) if isinstance(result, dict) else type(result)}")
    except Exception as e:
        print(f"  ERROR: {e}")

    # 2. get_body_composition
    print("\nCalling api.get_body_composition()...")
    try:
        result2 = api.get_body_composition(start_date, end_date)
        pp("get_body_composition() raw response", result2)
        if isinstance(result2, dict):
            print(f"\n  Top-level keys: {list(result2.keys())}")
            total_avg = result2.get("totalAverage")
            if total_avg:
                print(f"  totalAverage: {json.dumps(total_avg, default=str)}")
            metrics = (result2.get("allMetrics") or {}).get("metricsMap") or {}
            if metrics:
                print(f"  metricsMap keys: {list(metrics.keys())}")
                weight_m = metrics.get("WEIGHT") or []
                print(f"  WEIGHT entries: {len(weight_m)}")
                if weight_m:
                    print(f"  First WEIGHT entry: {json.dumps(weight_m[0], default=str)}")
    except Exception as e:
        print(f"  ERROR: {e}")

    # 3. get_daily_weigh_ins for today
    print(f"\nCalling api.get_daily_weigh_ins({end_date})...")
    try:
        result3 = api.get_daily_weigh_ins(end_date)
        pp(f"get_daily_weigh_ins({end_date}) raw response", result3)
    except Exception as e:
        print(f"  ERROR: {e}")

    # 4. get_stats_and_body (daily summary includes bodyComposition)
    print(f"\nCalling api.get_stats_and_body({end_date})...")
    try:
        result4 = api.get_stats_and_body(end_date)
        # Only print weight-related fields
        weight_fields = {k: v for k, v in (result4 or {}).items()
                         if any(w in k.lower() for w in ['weight','bmi','fat','muscle','bone','comp'])}
        pp(f"get_stats_and_body weight fields", weight_fields)
    except Exception as e:
        print(f"  ERROR: {e}")


if __name__ == "__main__":
    main()

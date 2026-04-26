#!/usr/bin/env python3
"""
Garmin -> Supabase sync worker

What it does:
- Logs into Garmin using python-garminconnect
- Loads/saves tokens from Supabase garmin_token_store (for GitHub Actions)
- Falls back to local token files (for local runs)
- Falls back to email/password (first run or expired tokens)
- Pulls today's daily summary, HRV, sleep, Body Battery, activities
- Upserts into Supabase: provider_connections, daily_health_metrics, garmin_activities

Environment variables (required):
  SUPABASE_URL=https://your-project.supabase.co
  SUPABASE_SERVICE_ROLE_KEY=your_service_role_key
  SUPABASE_USER_ID=uuid-of-the-app-user

Environment variables (needed for first run / fallback):
  GARMIN_EMAIL=you@example.com
  GARMIN_PASSWORD=your_password

Optional:
  GARMINTOKENS=./tokens          (local token directory, default ./tokens)
  GARMIN_ACTIVITY_LIMIT=10
  GARMIN_DAYS_BACK=1             (how many days to sync, default 1 = today only)
"""

from __future__ import annotations

import os
import sys
import tempfile
import time
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Optional

import requests
from dotenv import load_dotenv
from garminconnect import (
    Garmin,
    GarminConnectAuthenticationError,
    GarminConnectConnectionError,
    GarminConnectTooManyRequestsError,
)


load_dotenv()

GARMIN_EMAIL = os.getenv("GARMIN_EMAIL", "").strip()
GARMIN_PASSWORD = os.getenv("GARMIN_PASSWORD", "").strip()
TOKENS_DIR = Path(os.getenv("GARMINTOKENS", "./tokens")).expanduser()
ACTIVITY_LIMIT = int(os.getenv("GARMIN_ACTIVITY_LIMIT", "10"))
DAYS_BACK = int(os.getenv("GARMIN_DAYS_BACK", "1"))
# Polite throttle between Garmin API calls to avoid tripping rate limiting on a
# long backfill. Default 1.0s; set higher for very long runs.
SYNC_DELAY_SECONDS = float(os.getenv("GARMIN_REQUEST_DELAY", "1.0"))
# Optional run id; when set, the script writes progress rows the dashboard tails.
SYNC_RUN_ID = os.getenv("GARMIN_SYNC_RUN_ID", "").strip()

SUPABASE_URL = (os.getenv("SUPABASE_URL") or os.getenv("NEXT_PUBLIC_SUPABASE_URL") or "").rstrip("/")
SUPABASE_SERVICE_ROLE_KEY = os.getenv("SUPABASE_SERVICE_ROLE_KEY", "").strip()
SUPABASE_USER_ID = os.getenv("SUPABASE_USER_ID", "").strip()

if not SUPABASE_URL:
    raise RuntimeError("SUPABASE_URL is required")
if not SUPABASE_SERVICE_ROLE_KEY:
    raise RuntimeError("SUPABASE_SERVICE_ROLE_KEY is required")
if not SUPABASE_USER_ID:
    raise RuntimeError("SUPABASE_USER_ID is required")

SESSION = requests.Session()
SESSION.headers.update(
    {
        "apikey": SUPABASE_SERVICE_ROLE_KEY,
        "Authorization": f"Bearer {SUPABASE_SERVICE_ROLE_KEY}",
        "Content-Type": "application/json",
        "Prefer": "resolution=merge-duplicates,return=representation",
    }
)


# ---------------------------------------------------------------------------
# Progress streaming + rate limiting
# ---------------------------------------------------------------------------

def progress(
    message: str,
    *,
    level: str = "info",
    stage: Optional[str] = None,
    percent: Optional[int] = None,
    days_total: Optional[int] = None,
    day_index: Optional[int] = None,
) -> None:
    """Print to stdout AND (when SYNC_RUN_ID is set) write a row to
    garmin_sync_progress so the dashboard can tail the sync live."""
    print(f"[{level}] {message}", flush=True)
    if not SYNC_RUN_ID:
        return
    payload = {
        "user_id": SUPABASE_USER_ID,
        "run_id": SYNC_RUN_ID,
        "level": level,
        "stage": stage,
        "message": message,
        "percent": percent,
        "days_total": days_total,
        "day_index": day_index,
    }
    try:
        SESSION.post(
            f"{SUPABASE_URL}/rest/v1/garmin_sync_progress",
            json=payload,
            timeout=10,
        )
    except Exception as exc:  # never let logging break the sync
        print(f"  (progress write failed: {exc})", flush=True)


def throttle() -> None:
    """Sleep between Garmin API calls. Cheap insurance against rate limits."""
    if SYNC_DELAY_SECONDS > 0:
        time.sleep(SYNC_DELAY_SECONDS)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def utc_now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def iso_or_none(value: Any) -> Optional[str]:
    if value is None:
        return None
    if isinstance(value, datetime):
        dt = value
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        return dt.astimezone(timezone.utc).isoformat()
    if isinstance(value, date):
        return datetime(value.year, value.month, value.day, tzinfo=timezone.utc).isoformat()
    if isinstance(value, str):
        return value
    return str(value)


def pick_first(data: dict[str, Any], keys: list[str], default: Any = None) -> Any:
    for key in keys:
        if key in data and data[key] is not None:
            return data[key]
    return default


def as_int(value: Any) -> Optional[int]:
    if value is None or value == "":
        return None
    if isinstance(value, dict):
        # Handle nested score objects like {"value": 76}
        value = value.get("value") or value.get("score") or value.get("overall")
        if value is None:
            return None
    try:
        return int(float(value))
    except (TypeError, ValueError):
        return None


def as_float(value: Any) -> Optional[float]:
    if value is None or value == "":
        return None
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def safe_call(func, *args, **kwargs) -> tuple[bool, Any, Optional[str]]:
    try:
        return True, func(*args, **kwargs), None
    except Exception as exc:
        return False, None, str(exc)


# ---------------------------------------------------------------------------
# Supabase REST helpers
# ---------------------------------------------------------------------------

def supabase_request(
    method: str,
    path: str,
    *,
    params: Optional[dict[str, Any]] = None,
    json_body: Any = None,
) -> Any:
    url = f"{SUPABASE_URL}{path}"
    response = SESSION.request(method, url, params=params, json=json_body, timeout=60)

    if response.status_code >= 400:
        raise RuntimeError(
            f"Supabase {method} {path} failed ({response.status_code}): {response.text}"
        )

    if not response.text.strip():
        return None

    return response.json()


def supabase_upsert(table: str, payload: dict[str, Any], on_conflict: str) -> Any:
    return supabase_request(
        "POST",
        f"/rest/v1/{table}",
        params={"on_conflict": on_conflict},
        json_body=payload,
    )


def supabase_patch(
    table: str,
    payload: dict[str, Any],
    filters: list[tuple[str, str, Any]],
) -> Any:
    url = f"{SUPABASE_URL}/rest/v1/{table}"
    params = {col: f"{op}.{value}" for col, op, value in filters}
    response = SESSION.patch(url, params=params, json=payload, timeout=60)

    if response.status_code >= 400:
        raise RuntimeError(
            f"Supabase PATCH {table} failed ({response.status_code}): {response.text}"
        )

    if not response.text.strip():
        return None

    return response.json()


# ---------------------------------------------------------------------------
# Token management (Supabase <-> local files)
# ---------------------------------------------------------------------------

def load_tokens_from_supabase(user_id: str) -> bool:
    """
    Pull token files from garmin_token_store and write them to TOKENS_DIR.
    Returns True if tokens were found and written.
    """
    try:
        result = supabase_request(
            "GET",
            "/rest/v1/garmin_token_store",
            params={"user_id": f"eq.{user_id}", "select": "token_files"},
        )
        if not result or not isinstance(result, list) or not result[0].get("token_files"):
            print("No tokens found in Supabase garmin_token_store.")
            return False

        token_files: dict[str, str] = result[0]["token_files"]
        TOKENS_DIR.mkdir(parents=True, exist_ok=True)

        written = 0
        for filename, content in token_files.items():
            if not content or not content.strip():
                print(f"WARNING: token file '{filename}' in Supabase is empty — skipping.")
                continue
            print(f"DEBUG token '{filename}' first 80 chars: {content[:80]}")
            (TOKENS_DIR / filename).write_text(content, encoding="utf-8")
            written += 1

        if written == 0:
            print("No valid (non-empty) token files found in Supabase.")
            return False

        print(f"Loaded {written} token file(s) from Supabase.")
        return True
    except Exception as exc:
        print(f"Could not load tokens from Supabase: {exc}")
        return False


def save_tokens_to_supabase(user_id: str, token_content: str) -> None:
    """
    Upsert the garmin_tokens.json content (from api.client.dumps()) into garmin_token_store.
    """
    if not token_content or not token_content.strip():
        print("Warning: token content is empty, skipping Supabase save.")
        return

    try:
        supabase_request(
            "POST",
            "/rest/v1/garmin_token_store",
            params={"on_conflict": "user_id"},
            json_body={
                "user_id": user_id,
                "token_files": {"garmin_tokens.json": token_content},
                "updated_at": utc_now_iso(),
            },
        )
        print("Saved tokens to Supabase.")
    except Exception as exc:
        print(f"Warning: could not save tokens to Supabase: {exc}")


# ---------------------------------------------------------------------------
# Garmin auth
# ---------------------------------------------------------------------------

def login_garmin() -> Garmin:
    """
    In CI (GitHub Actions): token-only login using garmin_tokens.json from Supabase.
    Never attempts password login — failed attempts count against Garmin's rate limit.
    Run bootstrap_tokens.py (or the web reauth flow) to upload fresh tokens when needed.

    Locally: token login first, then password fallback.
    """
    in_ci = bool(os.getenv("CI", "").strip())

    TOKENS_DIR.mkdir(parents=True, exist_ok=True)
    token_file = TOKENS_DIR / "garmin_tokens.json"

    # If no local token file, try pulling from Supabase first
    if not token_file.exists():
        load_tokens_from_supabase(SUPABASE_USER_ID)

    if token_file.exists():
        try:
            print("Using existing Garmin tokens...")
            api = Garmin(is_cn=False)
            api.login(tokenstore=str(TOKENS_DIR))
            return api
        except GarminConnectTooManyRequestsError as exc:
            raise RuntimeError(
                f"Garmin rate limit (429) hit during token login. "
                f"Wait 24h before retrying. Details: {exc}"
            ) from exc
        except Exception as exc:
            err_str = str(exc)
            print(f"DEBUG exc type: {type(exc).__name__}, str: {err_str[:200]}")
            if "429" in err_str or "Too Many" in err_str or "rate" in err_str.lower():
                raise RuntimeError(
                    f"Garmin rate limit hit during token login ({type(exc).__name__}). "
                    f"Wait 24h before retrying. Details: {exc}"
                ) from exc
            if in_ci:
                raise RuntimeError(
                    f"Token login failed in CI and password fallback is disabled to protect "
                    f"against rate limiting. Re-run bootstrap_tokens.py to upload fresh "
                    f"tokens to Supabase. Error: {exc}"
                ) from exc
            print(f"Token login failed ({exc}), falling back to password login.")
            token_file.unlink(missing_ok=True)

    if in_ci:
        raise RuntimeError(
            "No valid tokens found in Supabase and password login is disabled in CI. "
            "Run bootstrap_tokens.py to upload fresh tokens to Supabase."
        )

    if not GARMIN_EMAIL or not GARMIN_PASSWORD:
        raise RuntimeError(
            "No valid tokens found and GARMIN_EMAIL/GARMIN_PASSWORD are not set. "
            "Run bootstrap_tokens.py first or set credentials."
        )

    # Local password fallback
    try:
        print("Logging in with email/password...")
        api = Garmin(
            email=GARMIN_EMAIL,
            password=GARMIN_PASSWORD,
            is_cn=False,
            prompt_mfa=lambda: input("Enter Garmin MFA code: ").strip(),
        )
        api.login()
        print("Garmin login successful.")
        return api

    except GarminConnectTooManyRequestsError as exc:
        raise RuntimeError(
            f"Garmin rate limit (429) on password login. Wait 24h. Details: {exc}"
        ) from exc
    except Exception as exc:
        if "429" in str(exc) or "Too Many" in str(exc):
            raise RuntimeError(
                f"Garmin rate limit (429) on password login. Wait 24h. Details: {exc}"
            ) from exc
        raise


# ---------------------------------------------------------------------------
# Provider connection
# ---------------------------------------------------------------------------

def get_or_create_connection(user_id: str) -> dict[str, Any]:
    result = supabase_upsert(
        "provider_connections",
        {
            "user_id": user_id,
            "provider_type": "garmin",
            "status": "connecting",
            "external_account_id": None,
            "oauth_access_token_enc": None,
            "oauth_refresh_token_enc": None,
            "token_expires_at": None,
            "consented_at": None,
            "last_sync_at": None,
            "last_successful_sync_at": None,
            "sync_cursor": None,
            "backfill_start_date": None,
            "backfill_complete": False,
            "last_error": None,
            "updated_at": utc_now_iso(),
            "created_at": utc_now_iso(),
        },
        on_conflict="user_id,provider_type",
    )

    if isinstance(result, list) and result:
        return result[0]
    if isinstance(result, dict):
        return result

    raise RuntimeError("Could not create or fetch provider_connections row")


def update_connection_status(
    connection_id: str,
    user_id: str,
    status: str,
    *,
    external_account_id: str | None = None,
    last_error: str | None = None,
    consented_at: str | None = None,
    last_sync_at: str | None = None,
    last_successful_sync_at: str | None = None,
    backfill_complete: bool | None = None,
) -> None:
    payload: dict[str, Any] = {
        "status": status,
        "last_error": last_error,
        "updated_at": utc_now_iso(),
    }

    if external_account_id is not None:
        payload["external_account_id"] = external_account_id
    if consented_at is not None:
        payload["consented_at"] = consented_at
    if last_sync_at is not None:
        payload["last_sync_at"] = last_sync_at
    if last_successful_sync_at is not None:
        payload["last_successful_sync_at"] = last_successful_sync_at
    if backfill_complete is not None:
        payload["backfill_complete"] = backfill_complete

    supabase_patch(
        "provider_connections",
        payload,
        filters=[
            ("id", "eq", connection_id),
            ("user_id", "eq", user_id),
        ],
    )


# ---------------------------------------------------------------------------
# Garmin data fetchers
# ---------------------------------------------------------------------------

def get_user_profile_name(api: Garmin) -> str | None:
    success, full_name, _ = safe_call(api.get_full_name)
    if success and full_name:
        return str(full_name)
    return None


def get_daily_summary(api: Garmin, date_iso: str) -> dict[str, Any]:
    summary: dict[str, Any] = {}
    hydration: dict[str, Any] | None = None

    success, data, err = safe_call(api.get_user_summary, date_iso)
    if success and isinstance(data, dict):
        summary = data
    elif err:
        print(f"  Warning: get_user_summary failed: {err}")

    success, data, err = safe_call(api.get_hydration_data, date_iso)
    if success and isinstance(data, dict):
        hydration = data

    return {"summary": summary, "hydration": hydration}


def get_hrv_data(api: Garmin, date_iso: str) -> dict[str, Any]:
    success, data, err = safe_call(api.get_hrv_data, date_iso)
    if success and isinstance(data, dict):
        return data
    if err:
        print(f"  Warning: get_hrv_data failed: {err}")
    return {}


def get_sleep_data(api: Garmin, date_iso: str) -> dict[str, Any]:
    success, data, err = safe_call(api.get_sleep_data, date_iso)
    if success and isinstance(data, dict):
        return data
    if err:
        print(f"  Warning: get_sleep_data failed: {err}")
    return {}


def get_body_battery(api: Garmin, date_iso: str) -> list[dict[str, Any]]:
    """Returns list of body battery readings for the day."""
    success, data, err = safe_call(api.get_body_battery, date_iso, date_iso)
    if success and isinstance(data, list):
        return data
    if err:
        print(f"  Warning: get_body_battery failed: {err}")
    return []


def get_steps_data(api: Garmin, date_iso: str) -> list[dict[str, Any]]:
    """
    Returns the raw 15-minute step buckets from Garmin.
    python-garminconnect returns a list of dicts, not a single daily-totals dict.
    Daily totals are read from the user summary instead.
    """
    success, data, err = safe_call(api.get_steps_data, date_iso)
    if success and isinstance(data, list):
        return data
    if success and isinstance(data, dict):
        # Older library versions returned a dict — still stash it
        return [data]
    if err:
        print(f"  Warning: get_steps_data failed: {err}")
    return []


def get_spo2_data(api: Garmin, date_iso: str) -> dict[str, Any]:
    """Daily SpO2 summary (averageSpO2 / lowestSpO2 / latestSpO2)."""
    success, data, err = safe_call(api.get_spo2_data, date_iso)
    if success and isinstance(data, dict):
        return data
    if err:
        print(f"  Warning: get_spo2_data failed: {err}")
    return {}


def get_weigh_ins_data(api: Garmin, startdate: str, enddate: str) -> list[dict[str, Any]]:
    """
    Returns a flat list of normalised weigh-in entries for the date range.

    Garmin's daily summary (already stored in daily_health_metrics.body_composition)
    uses the format: {"weight_kg": 108.6, "body_fat_pct": 36.5}

    The dedicated weight-range API uses: {"dateWeightList": [{calendarDate, weight, ...}]}
    where weight may be in grams (>500) or kg.

    We try both endpoints and normalise everything to {"calendarDate", "weight_kg",
    "body_fat_pct"} for upsert_weight_snapshots.
    """
    entries: list[dict[str, Any]] = []

    # Primary: /weight/range/{start}/{end}?includeAll=True → {"dateWeightList": [...]}
    success, data, err = safe_call(api.get_weigh_ins, startdate, enddate)
    if success and isinstance(data, dict):
        raw_list = data.get("dateWeightList") or []
        print(f"  get_weigh_ins returned {len(raw_list)} entries (top keys: {list(data.keys())[:6]})")
        for e in raw_list:
            if not isinstance(e, dict):
                continue
            w_raw = as_float(e.get("weight"))
            if not w_raw or w_raw <= 0:
                continue
            # Weight >500 = grams, else already kg
            w_kg = w_raw / 1000 if w_raw > 500 else w_raw
            cdate = e.get("calendarDate") or e.get("summaryDate")
            entries.append({
                "calendarDate": cdate,
                "weight_kg": w_kg,
                "body_fat_pct": as_float(e.get("bodyFat")),
                "body_water_pct": as_float(e.get("bodyWater")),
                "muscle_mass_kg": (as_float(e.get("muscleMass")) or 0) / 1000 or None,
                "bone_mass_kg": (as_float(e.get("boneMass")) or 0) / 1000 or None,
                "bmi": as_float(e.get("bmi")),
                "source_type": e.get("sourceType") or "MANUAL",
            })
    else:
        if err:
            print(f"  Warning: get_weigh_ins failed: {err}")

    # Fallback: /weight/dateRange via get_body_composition
    if not entries:
        success2, data2, err2 = safe_call(api.get_body_composition, startdate, enddate)
        if success2 and isinstance(data2, dict):
            metrics_map = (data2.get("allMetrics") or {}).get("metricsMap") or {}
            weight_list = metrics_map.get("WEIGHT") or []
            fat_list = metrics_map.get("BODY_FAT") or []
            fat_by_date = {e.get("calendarDate"): as_float(e.get("value"))
                           for e in fat_list if isinstance(e, dict)}
            for w in weight_list:
                if not isinstance(w, dict):
                    continue
                w_raw = as_float(w.get("value"))
                if not w_raw or w_raw <= 0:
                    continue
                w_kg = w_raw / 1000 if w_raw > 500 else w_raw
                cdate = w.get("calendarDate")
                entries.append({
                    "calendarDate": cdate,
                    "weight_kg": w_kg,
                    "body_fat_pct": fat_by_date.get(cdate),
                    "source_type": w.get("sourceType") or "MANUAL",
                })
            print(f"  get_body_composition fallback returned {len(entries)} weight entries")
        else:
            if err2:
                print(f"  Warning: get_body_composition also failed: {err2}")

    return entries


# ---------------------------------------------------------------------------
# Data normalization
# ---------------------------------------------------------------------------

def extract_sleep_score(sleep_data: dict[str, Any]) -> Optional[int]:
    """Navigate the nested Garmin sleep score structure."""
    dto = sleep_data.get("dailySleepDTO") or {}

    # Try sleepScores.overall.value
    scores = dto.get("sleepScores") or {}
    overall = scores.get("overall")
    if isinstance(overall, dict):
        v = overall.get("value") or overall.get("qualifierKey")
        if v is not None:
            return as_int(v)
    if isinstance(overall, (int, float)):
        return as_int(overall)

    # Try direct sleepScore field
    direct = dto.get("sleepScore") or sleep_data.get("sleepScore")
    if direct is not None:
        return as_int(direct)

    return None


def extract_body_battery_stats(
    summary: dict[str, Any],
    bb_readings: list[dict[str, Any]],
) -> tuple[Optional[int], Optional[int], Optional[int], Optional[int]]:
    """
    Returns (start, peak, low, end_of_day) Body Battery values.

    python-garminconnect returns bb_readings as a list of per-day dicts, each with
    a ``bodyBatteryValuesArray`` of ``[timestamp_ms, status, level, ...]`` rows
    (level is usually index 2, but older payloads have it at index 1).
    """
    levels: list[int] = []
    for entry in bb_readings or []:
        if not isinstance(entry, dict):
            continue
        values = entry.get("bodyBatteryValuesArray") or entry.get("values") or []
        for row in values:
            level: Optional[int] = None
            if isinstance(row, (list, tuple)):
                # Try index 2 first (newer payloads: [ts, status, level]), then index 1.
                for idx in (2, 1):
                    if len(row) > idx and row[idx] is not None:
                        level = as_int(row[idx])
                        if level is not None:
                            break
            elif isinstance(row, dict):
                level = as_int(
                    row.get("bodyBatteryLevel")
                    or row.get("level")
                    or row.get("value")
                )
            if level is not None:
                levels.append(level)

    if levels:
        return levels[0], max(levels), min(levels), levels[-1]

    # Fallback to daily summary keys
    start = as_int(
        pick_first(summary, ["bodyBatteryAtWakeTime", "startBodyBattery"])
    )
    peak = as_int(
        pick_first(summary, ["bodyBatteryHighestValue", "bodyBatteryChargedLevel", "highBodyBattery"])
    )
    low = as_int(
        pick_first(summary, ["bodyBatteryLowestValue", "bodyBatteryDrainedLevel", "lowBodyBattery"])
    )
    eod = as_int(
        pick_first(summary, ["bodyBatteryMostRecentValue", "lastUpdatedBodyBatteryLevel", "endOfDayBodyBatteryLevel"])
    )
    return start, peak, low, eod


def _ms_epoch_to_iso(value: Any) -> Optional[str]:
    """Convert a millisecond epoch (int or numeric string) to ISO 8601 UTC."""
    ms = as_int(value)
    if ms is None or ms <= 0:
        return None
    try:
        return datetime.fromtimestamp(ms / 1000, tz=timezone.utc).isoformat()
    except (OverflowError, OSError, ValueError):
        return None


def extract_sleep_session_data(sleep_data: dict[str, Any], date_iso: str) -> dict[str, Any]:
    """
    Extract detailed sleep session data from Garmin sleep response.
    Returns normalized data for garmin_sleep_data table.

    Garmin returns timestamps as millisecond epochs and sleep-stage seconds as
    flat keys on the DTO (deepSleepSeconds, remSleepSeconds, etc.), not nested
    under ``sleepLevels``.
    """
    dto = sleep_data.get("dailySleepDTO") or sleep_data

    sleep_start = _ms_epoch_to_iso(
        pick_first(dto, ["sleepStartTimestampGMT", "sleepStartTimestampLocal", "sleepTimeTimestamp"])
    )
    sleep_end = _ms_epoch_to_iso(
        pick_first(dto, ["sleepEndTimestampGMT", "sleepEndTimestampLocal", "wakeTimeTimestamp"])
    )

    # Sleep stages — flat on DTO in the current API, with legacy nested fallback
    stages = dto.get("sleepLevels") or {}
    awake_sec = (
        as_int(dto.get("awakeSleepSeconds"))
        or as_int(stages.get("awake"))
        or as_int(stages.get("awakeSeconds"))
        or 0
    )
    light_sec = (
        as_int(dto.get("lightSleepSeconds"))
        or as_int(stages.get("light"))
        or as_int(stages.get("lightSeconds"))
        or 0
    )
    deep_sec = (
        as_int(dto.get("deepSleepSeconds"))
        or as_int(stages.get("deep"))
        or as_int(stages.get("deepSeconds"))
        or 0
    )
    rem_sec = (
        as_int(dto.get("remSleepSeconds"))
        or as_int(stages.get("rem"))
        or as_int(stages.get("remSeconds"))
        or 0
    )

    # Duration — real key is sleepTimeSeconds; fall back to totals / legacy keys
    duration_sec = (
        as_int(dto.get("sleepTimeSeconds"))
        or as_int(dto.get("duration"))
        or as_int(dto.get("sleepDurationSeconds"))
    )
    if duration_sec is None:
        total = awake_sec + light_sec + deep_sec + rem_sec
        duration_sec = total if total > 0 else None

    # Sleep scores
    sleep_score = extract_sleep_score(sleep_data)
    scores = dto.get("sleepScores") or {}
    quality_obj = scores.get("qualityScore") if isinstance(scores, dict) else None
    quality_score = None
    if isinstance(quality_obj, dict):
        quality_score = as_int(quality_obj.get("value"))
    if quality_score is None:
        quality_score = (
            as_int(dto.get("sleepQualityScore"))
            or as_int(dto.get("qualityScore"))
        )

    # Physiological metrics
    avg_spo2 = as_float(pick_first(dto, ["averageSpO2Value", "averageSpO2", "avgSpO2"]))
    min_spo2 = as_float(pick_first(dto, ["lowestSpO2Value", "minSpO2Value", "minSpO2", "lowestSpO2"]))
    avg_resp = as_float(pick_first(dto, ["averageRespirationValue", "averageRespiration", "avgRespiration"]))
    avg_hr = as_int(pick_first(dto, ["averageHeartRate", "avgHeartRate", "avgHR", "restingHeartRate"]))
    max_hr = as_int(pick_first(dto, ["highestHeartRate", "maxHeartRate", "maxHR"]))

    # Stress during sleep
    stress_score = as_int(dto.get("avgSleepStress")) or as_int(dto.get("sleepStressScore")) or as_int(dto.get("stressScore"))

    return {
        "sleep_start": sleep_start,
        "sleep_end": sleep_end,
        "sleep_duration_seconds": duration_sec,
        "awake_seconds": awake_sec,
        "light_sleep_seconds": light_sec,
        "deep_sleep_seconds": deep_sec,
        "rem_sleep_seconds": rem_sec,
        "sleep_score": sleep_score,
        "sleep_quality_score": quality_score,
        "avg_spo2": avg_spo2,
        "min_spo2": min_spo2,
        "avg_respiration_bpm": avg_resp,
        "avg_heart_rate_bpm": avg_hr,
        "max_heart_rate_bpm": max_hr,
        "sleep_stress_score": stress_score,
        "sleep_hr_avg": avg_hr,
        "sleep_hr_max": max_hr,
    }


def extract_daily_health_metrics(
    summary: dict[str, Any],
    hydration: dict[str, Any] | None,
    hrv_data: dict[str, Any],
    bb_readings: list[dict[str, Any]],
    spo2_data: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """
    Extract extended daily health metrics for garmin_daily_health_metrics table.
    """
    hrv_summary = hrv_data.get("hrvSummary") or {}
    spo2_data = spo2_data or {}

    # Body Battery — peak/low/EOD from readings list, start from first reading or summary
    bb_start, bb_peak, bb_low, bb_end = extract_body_battery_stats(summary, bb_readings)

    # Stress
    stress_avg = as_int(pick_first(summary, ["averageStressLevel", "stressScore"]))
    stress_max = as_int(pick_first(summary, ["maxStressLevel"]))
    stress_min = as_int(pick_first(summary, ["minStressLevel"]))

    # HRV — real keys are lastNightAvg / lastNight5MinHigh; legacy fallbacks kept
    hrv_avg = as_int(pick_first(hrv_summary, ["lastNightAvg", "lastNight"]))
    hrv_max = as_int(pick_first(hrv_summary, ["lastNight5MinHigh", "max"]))
    hrv_min = as_int(hrv_summary.get("min"))
    if hrv_min is None:
        # Derive min from the reading array if available
        readings = hrv_data.get("hrvReadings") or []
        reading_values: list[int] = []
        for r in readings:
            if isinstance(r, dict):
                v = as_int(r.get("hrvValue") or r.get("value"))
                if v is not None:
                    reading_values.append(v)
        if reading_values:
            hrv_min = min(reading_values)
            if hrv_max is None:
                hrv_max = max(reading_values)
    hrv_status = hrv_summary.get("status")

    # Respiration — avgWakingRespirationValue is the current key
    resp_avg = as_float(pick_first(summary, ["avgWakingRespirationValue", "averageRespirationValue", "avgRespiration"]))
    resp_min = as_float(pick_first(summary, ["lowestRespirationValue", "minRespirationValue", "minRespiration"]))
    resp_max = as_float(pick_first(summary, ["highestRespirationValue", "maxRespirationValue", "maxRespiration"]))

    # SpO2 — dedicated endpoint (get_spo2_data) is authoritative; summary has averageSpo2
    spo2_avg = as_float(
        pick_first(spo2_data, ["averageSpO2", "avgSpO2", "averageSpo2"])
    )
    if spo2_avg is None:
        spo2_avg = as_float(pick_first(summary, ["averageSpo2", "averageSpO2", "avgSpO2"]))
    spo2_min = as_float(
        pick_first(spo2_data, ["lowestSpO2", "minSpO2"])
    )
    if spo2_min is None:
        spo2_min = as_float(pick_first(summary, ["lowestSpo2", "minSpO2", "lowestSpO2"]))
    spo2_max = as_float(pick_first(spo2_data, ["highestSpO2", "maxSpO2"]))
    if spo2_max is None:
        spo2_max = as_float(pick_first(summary, ["maxSpO2", "highestSpO2"]))

    # Hydration
    hydration_goal = as_int(hydration.get("goalInML")) if hydration else None
    hydration_intake = as_int(hydration.get("intakeInML")) if hydration else None
    hydration_remaining = as_int(hydration.get("remainingInML")) if hydration else None

    return {
        "body_battery_start": bb_start,
        "body_battery_end": bb_end,
        "body_battery_peak": bb_peak,
        "body_battery_low": bb_low,
        "stress_avg": stress_avg,
        "stress_max": stress_max,
        "stress_min": stress_min,
        "hrv_avg": hrv_avg,
        "hrv_min": hrv_min,
        "hrv_max": hrv_max,
        "hrv_status": hrv_status,
        "respiration_avg_bpm": resp_avg,
        "respiration_min_bpm": resp_min,
        "respiration_max_bpm": resp_max,
        "spo2_avg": spo2_avg,
        "spo2_min": spo2_min,
        "spo2_max": spo2_max,
        "hydration_goal_ml": hydration_goal,
        "hydration_intake_ml": hydration_intake,
        "hydration_remaining_ml": hydration_remaining,
    }


def extract_daily_steps_data(
    summary: dict[str, Any],
    steps_buckets: list[dict[str, Any]] | None = None,
) -> dict[str, Any]:
    """
    Extract daily steps data for garmin_daily_steps table.

    The authoritative source for daily totals is the user summary
    (``api.get_user_summary``). ``api.get_steps_data`` returns a list of
    15-minute buckets, which we aggregate as a fallback and keep for the
    ``hourly_steps`` column.
    """
    summary = summary or {}
    buckets = steps_buckets or []

    total_steps = as_int(pick_first(summary, ["totalSteps", "steps"]))
    total_distance = as_float(pick_first(summary, ["totalDistanceMeters", "wellnessDistanceMeters", "distanceMeters"]))
    total_calories = as_int(pick_first(summary, ["totalKilocalories", "wellnessKilocalories", "totalCalories"]))

    # Fallback to aggregating the 15-minute buckets
    if total_steps is None:
        agg = 0
        for b in buckets:
            if isinstance(b, dict):
                agg += as_int(b.get("steps")) or 0
        total_steps = agg

    if total_distance is None:
        agg_dist = 0.0
        for b in buckets:
            if isinstance(b, dict):
                agg_dist += as_float(b.get("distance")) or 0.0
        total_distance = agg_dist

    # Active / sedentary minutes — summary values are in seconds
    active_sec = (
        as_int(pick_first(summary, ["highlyActiveSeconds"])) or 0
    ) + (
        as_int(pick_first(summary, ["activeSeconds"])) or 0
    )
    active_min = active_sec // 60 if active_sec else 0

    sedentary_sec = as_int(pick_first(summary, ["sedentarySeconds"])) or 0
    sedentary_min = sedentary_sec // 60 if sedentary_sec else 0

    # Garmin intensity minutes: moderate 1× + vigorous 2× toward the 150-min/week goal.
    # These are weekly rolling totals from the summary endpoint.
    moderate_intensity_min = as_int(pick_first(summary, ["moderateIntensityMinutes"]))
    vigorous_intensity_min = as_int(pick_first(summary, ["vigorousIntensityMinutes"]))
    intensity_minutes_goal = as_int(pick_first(summary, ["intensityMinutesGoal"]))

    hourly_steps = buckets if buckets else None

    return {
        "total_steps": total_steps or 0,
        "total_distance_meters": total_distance or 0,
        "total_calories": total_calories or 0,
        "active_minutes": active_min,
        "sedentary_minutes": sedentary_min,
        "moderate_intensity_minutes": moderate_intensity_min,
        "vigorous_intensity_minutes": vigorous_intensity_min,
        "intensity_minutes_goal": intensity_minutes_goal,
        "hourly_steps": hourly_steps,
    }


def normalize_garmin_activity_row(
    activity: dict[str, Any],
    user_id: str,
    connection_id: str,
) -> dict[str, Any]:
    provider_activity_id = str(
        pick_first(
            activity,
            ["activityId", "activity_id", "id", "activityID", "activityUuid"],
            default="",
        )
    )

    activity_type = pick_first(
        activity,
        ["activityType", "activity_type", "type", "activityName"],
        default=None,
    )
    if isinstance(activity_type, dict):
        activity_type = (
            activity_type.get("typeKey")
            or activity_type.get("TypeKey")   # Garmin Connect uses capital T
            or activity_type.get("name")
            or activity_type.get("Name")
            or str(activity_type)
        )

    return {
        "user_id": user_id,
        "connection_id": connection_id,
        "provider_activity_id": provider_activity_id,
        "activity_type": str(activity_type) if activity_type is not None else None,
        "start_time": iso_or_none(pick_first(activity, ["startTimeLocal", "startTimeGMT", "startTime", "start_time"])),
        "duration_sec": as_int(pick_first(activity, ["duration", "durationInSeconds", "durationSec", "duration_sec"])),
        "distance_m": as_float(pick_first(activity, ["distance", "distanceMeters", "distance_m", "totalDistanceMeters"])),
        "calories": as_float(pick_first(activity, ["calories", "caloriesBurned", "totalCalories", "totalKilocalories"])),
        "avg_hr": as_int(pick_first(activity, ["averageHR", "avgHr", "avgHR", "averageHeartRate"])),
        "max_hr": as_int(pick_first(activity, ["maxHR", "maxHr", "maxHeartRate"])),
        "training_effect": as_float(pick_first(activity, ["trainingEffect", "training_effect"])),
        "source_file_type": str(pick_first(activity, ["sourceFileType", "fileType"])) if pick_first(activity, ["sourceFileType", "fileType"]) else None,
        "raw_payload": activity,
        "created_at": utc_now_iso(),
    }


# ---------------------------------------------------------------------------
# Supabase writes
# ---------------------------------------------------------------------------

def upsert_daily_health(
    user_id: str,
    connection_id: str,
    date_iso: str,
    daily: dict[str, Any],
    hrv_data: dict[str, Any],
    sleep_data: dict[str, Any],
    bb_readings: list[dict[str, Any]],
) -> None:
    summary = daily.get("summary") or {}
    hydration = daily.get("hydration")

    hrv_summary = hrv_data.get("hrvSummary") or {}
    sleep_dto = sleep_data.get("dailySleepDTO") or {}

    _bb_start, bb_high, bb_low, bb_eod = extract_body_battery_stats(summary, bb_readings)
    sleep_score = extract_sleep_score(sleep_data)

    payload = {
        "user_id": user_id,
        "connection_id": connection_id,
        "metric_date": date_iso,
        # Core daily metrics
        "steps": as_int(pick_first(summary, ["totalSteps", "steps"])),
        "calories": as_float(pick_first(summary, ["totalKilocalories", "calories"])),
        "distance_m": as_float(pick_first(summary, ["totalDistanceMeters", "distanceMeters"])),
        "resting_hr": as_int(pick_first(summary, ["restingHeartRate", "resting_hr"])),
        "avg_hr": as_int(pick_first(summary, ["averageHeartRate", "avgHeartRate", "avg_hr"])),
        "sleep_minutes": as_int(pick_first(summary, ["sleepMinutes", "sleep_minutes"])),
        "stress_score": as_float(pick_first(summary, ["averageStressLevel", "stressScore", "stress_score"])),
        "body_battery": as_float(pick_first(summary, ["lastUpdatedBodyBatteryLevel", "bodyBattery", "body_battery"])),
        "respiration_rate": as_float(pick_first(summary, ["avgWakingRespirationValue", "averageRespirationValue", "respirationRate", "respiration_rate"])),
        "pulse_ox": as_float(pick_first(summary, ["averageSpo2", "averageSpO2", "pulseOx", "pulse_ox"])),
        "body_composition": summary.get("bodyComposition"),
        # Garmin enriched: Body Battery
        "garmin_body_battery_high": bb_high,
        "garmin_body_battery_low": bb_low,
        "garmin_body_battery_eod": bb_eod,
        # Garmin enriched: Stress
        "garmin_stress_avg": as_int(pick_first(summary, ["averageStressLevel", "stressScore"])),
        "garmin_stress_max": as_int(pick_first(summary, ["maxStressLevel"])),
        # Garmin enriched: HRV
        "garmin_hrv_nightly_avg": as_int(pick_first(hrv_summary, ["lastNightAvg", "lastNight"])),
        "garmin_hrv_5day_avg": as_int(hrv_summary.get("weeklyAvg") or hrv_summary.get("fiveDayAvg")),
        "garmin_hrv_status": hrv_summary.get("status"),
        # Garmin enriched: Sleep
        "garmin_sleep_score": sleep_score,
        "garmin_spo2_avg": as_float(
            pick_first(sleep_dto, ["averageSpO2Value", "averageSpO2"])
            or pick_first(summary, ["averageSpo2", "averageSpO2"])
        ),
        "garmin_respiration_avg": as_float(
            pick_first(sleep_dto, ["averageRespirationValue", "averageRespiration"])
            or pick_first(summary, ["avgWakingRespirationValue", "averageRespirationValue"])
        ),
        # Raw
        "raw_payload": {
            "summary": summary,
            "hydration": hydration,
            "hrv": hrv_data,
            "sleep": sleep_data,
        },
        "created_at": utc_now_iso(),
    }

    supabase_upsert("daily_health_metrics", payload, on_conflict="connection_id,metric_date")
    print(f"  Upserted daily_health_metrics for {date_iso}")


def upsert_sleep_data(
    user_id: str,
    connection_id: str,
    date_iso: str,
    sleep_data: dict[str, Any],
) -> None:
    """
    Upsert detailed sleep session data into garmin_sleep_data table.
    """
    if not sleep_data:
        return

    extracted = extract_sleep_session_data(sleep_data, date_iso)

    # Skip empty placeholder responses (Garmin returns these for the current day
    # before a sleep session has been recorded). Don't pollute the table with
    # rows where every meaningful field is null/zero.
    has_score = extracted.get("sleep_score") is not None
    has_duration = (extracted.get("sleep_duration_seconds") or 0) > 0
    has_stages = any((extracted.get(k) or 0) > 0 for k in (
        "deep_sleep_seconds", "light_sleep_seconds", "rem_sleep_seconds"
    ))
    if not (has_score or has_duration or has_stages):
        print(f"  Skipping empty sleep payload for {date_iso}")
        return

    payload = {
        "user_id": user_id,
        "connection_id": connection_id,
        "sleep_date": date_iso,
        **extracted,
        "raw_payload": sleep_data,
        "created_at": utc_now_iso(),
    }

    supabase_upsert("garmin_sleep_data", payload, on_conflict="connection_id,sleep_date")
    print(f"  Upserted garmin_sleep_data for {date_iso}")


def upsert_daily_health_extended(
    user_id: str,
    connection_id: str,
    date_iso: str,
    summary: dict[str, Any],
    hydration: dict[str, Any] | None,
    hrv_data: dict[str, Any],
    bb_readings: list[dict[str, Any]],
    spo2_data: dict[str, Any] | None = None,
) -> None:
    """
    Upsert extended daily health metrics into garmin_daily_health_metrics table.
    """
    extracted = extract_daily_health_metrics(summary, hydration, hrv_data, bb_readings, spo2_data)

    payload = {
        "user_id": user_id,
        "connection_id": connection_id,
        "metric_date": date_iso,
        **extracted,
        "raw_payload": {
            "summary": summary,
            "hydration": hydration,
            "hrv": hrv_data,
            "body_battery": bb_readings,
            "spo2": spo2_data,
        },
        "created_at": utc_now_iso(),
    }

    supabase_upsert("garmin_daily_health_metrics", payload, on_conflict="connection_id,metric_date")
    print(f"  Upserted garmin_daily_health_metrics for {date_iso}")


def upsert_daily_steps(
    user_id: str,
    connection_id: str,
    date_iso: str,
    summary: dict[str, Any],
    steps_buckets: list[dict[str, Any]] | None = None,
) -> None:
    """
    Upsert daily steps data into garmin_daily_steps table.
    Uses upsert logic to update the same row when steps change during the day.
    """
    extracted = extract_daily_steps_data(summary, steps_buckets)

    if not extracted["total_steps"] and not (steps_buckets or summary):
        return

    payload = {
        "user_id": user_id,
        "connection_id": connection_id,
        "step_date": date_iso,
        **extracted,
        "raw_payload": {
            "summary": summary,
            "buckets": steps_buckets,
        },
        "created_at": utc_now_iso(),
    }

    supabase_upsert("garmin_daily_steps", payload, on_conflict="connection_id,step_date")
    print(f"  Upserted garmin_daily_steps for {date_iso} (total: {extracted['total_steps']})")


def upsert_intraday_body_battery(
    user_id: str,
    connection_id: str,
    date_iso: str,
    bb_readings: list[dict[str, Any]],
) -> int:
    """
    Extract per-reading body battery values from the raw API response and upsert
    each one into garmin_intraday_body_battery.  Returns number of rows written.
    """
    rows = []
    for entry in bb_readings or []:
        if not isinstance(entry, dict):
            continue
        values = entry.get("bodyBatteryValuesArray") or entry.get("values") or []
        for row in values:
            ts_ms: Optional[int] = None
            level: Optional[int] = None
            status: Optional[str] = None
            if isinstance(row, (list, tuple)):
                ts_ms = as_int(row[0]) if len(row) > 0 else None
                status = str(row[1]) if len(row) > 1 and row[1] is not None else None
                for idx in (2, 1):
                    if len(row) > idx and row[idx] is not None:
                        level = as_int(row[idx])
                        if level is not None:
                            break
            elif isinstance(row, dict):
                ts_ms = as_int(row.get("startTimestampLocal") or row.get("timestamp"))
                level = as_int(row.get("bodyBatteryLevel") or row.get("level") or row.get("value"))
                status = str(row.get("activityType") or row.get("status") or "")
            if ts_ms and level is not None:
                ts_iso = _ms_epoch_to_iso(ts_ms)
                if ts_iso:
                    rows.append({
                        "user_id": user_id,
                        "connection_id": connection_id,
                        "metric_date": date_iso,
                        "recorded_at": ts_iso,
                        "level": level,
                        "status": status,
                        "created_at": utc_now_iso(),
                    })

    for row in rows:
        supabase_upsert(
            "garmin_intraday_body_battery",
            row,
            on_conflict="connection_id,recorded_at",
        )

    if rows:
        print(f"  Upserted {len(rows)} intraday body battery readings for {date_iso}")
    return len(rows)


def sync_recent_garmin_activities(api: Garmin, user_id: str, connection_id: str) -> int:
    success, activities, err = safe_call(api.get_activities, 0, ACTIVITY_LIMIT)
    if not success or activities is None:
        print(f"  Warning: get_activities failed: {err}")
        return 0

    if isinstance(activities, dict):
        for key in ["activities", "activityList", "items", "data"]:
            if key in activities and isinstance(activities[key], list):
                activities = activities[key]
                break

    if not isinstance(activities, list):
        return 0

    inserted = 0
    for activity in activities:
        if not isinstance(activity, dict):
            continue

        row = normalize_garmin_activity_row(activity, user_id, connection_id)
        if not row["provider_activity_id"]:
            continue

        try:
            supabase_upsert("garmin_activities", row, on_conflict="connection_id,provider_activity_id")
            inserted += 1
        except Exception as exc:
            print(f"  Warning: failed to upsert activity {row['provider_activity_id']}: {exc}")

    return inserted


def upsert_weight_snapshots(user_id: str, connection_id: str, entries: list[dict[str, Any]]) -> int:
    """
    Upserts normalised weigh-in entries into garmin_weight_snapshots.
    Entries come from get_weigh_ins_data() already normalised to weight_kg.
    """
    count = 0
    for entry in entries:
        date_str = entry.get("calendarDate") or entry.get("summaryDate")
        if not date_str:
            continue
        weight_kg = as_float(entry.get("weight_kg"))
        if weight_kg is None or weight_kg <= 0:
            continue
        payload = {
            "user_id": user_id,
            "connection_id": connection_id,
            "weigh_date": date_str,
            "weight_grams": round(weight_kg * 1000, 1),
            "bmi": as_float(entry.get("bmi")),
            "body_fat_pct": as_float(entry.get("body_fat_pct")),
            "body_water_pct": as_float(entry.get("body_water_pct")),
            "muscle_mass_grams": round(entry["muscle_mass_kg"] * 1000, 1) if entry.get("muscle_mass_kg") else None,
            "bone_mass_grams": round(entry["bone_mass_kg"] * 1000, 1) if entry.get("bone_mass_kg") else None,
            "source_type": entry.get("source_type") or "MANUAL",
            "raw_payload": entry,
        }
        supabase_upsert("garmin_weight_snapshots", payload, on_conflict="connection_id,weigh_date")
        print(f"    Weight {date_str}: {weight_kg:.1f} kg")
        count += 1
    return count


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main() -> None:
    progress(
        f"Starting Garmin sync (days_back={DAYS_BACK}, delay={SYNC_DELAY_SECONDS}s)",
        stage="login",
    )

    api = login_garmin()
    progress("Logged in to Garmin", stage="login")

    # Save refreshed tokens back to Supabase after every successful login
    save_tokens_to_supabase(SUPABASE_USER_ID, api.client.dumps())

    full_name = get_user_profile_name(api) or ""

    connection = get_or_create_connection(SUPABASE_USER_ID)
    connection_id = str(connection["id"])

    update_connection_status(
        connection_id,
        SUPABASE_USER_ID,
        "syncing",
        external_account_id=full_name or None,
        consented_at=utc_now_iso(),
        last_sync_at=utc_now_iso(),
        last_error=None,
    )

    # Sync DAYS_BACK days (default: just today)
    dates_to_sync = [
        (date.today() - timedelta(days=i)).isoformat()
        for i in range(DAYS_BACK)
    ]

    total = len(dates_to_sync)
    # Iterate oldest-to-newest so the UI feels like it's progressing forward in time.
    for idx, date_iso in enumerate(reversed(dates_to_sync), start=1):
        pct = int((idx / total) * 95)  # leave room for activities at the end
        progress(
            f"Syncing {date_iso} ({idx}/{total})",
            stage="day",
            percent=pct,
            days_total=total,
            day_index=idx,
        )

        progress(f"  daily summary {date_iso}", stage="daily", days_total=total, day_index=idx)
        daily = get_daily_summary(api, date_iso)
        throttle()

        progress(f"  HRV {date_iso}", stage="hrv", days_total=total, day_index=idx)
        hrv = get_hrv_data(api, date_iso)
        throttle()

        progress(f"  sleep {date_iso}", stage="sleep", days_total=total, day_index=idx)
        sleep = get_sleep_data(api, date_iso)
        throttle()

        progress(f"  body battery {date_iso}", stage="body_battery", days_total=total, day_index=idx)
        bb = get_body_battery(api, date_iso)
        throttle()

        progress(f"  steps {date_iso}", stage="steps", days_total=total, day_index=idx)
        steps_buckets = get_steps_data(api, date_iso)
        throttle()

        progress(f"  SpO2 {date_iso}", stage="spo2", days_total=total, day_index=idx)
        spo2 = get_spo2_data(api, date_iso)
        throttle()

        summary = daily.get("summary") or {}
        hydration = daily.get("hydration")

        # Upsert to all tables
        upsert_daily_health(SUPABASE_USER_ID, connection_id, date_iso, daily, hrv, sleep, bb)
        upsert_sleep_data(SUPABASE_USER_ID, connection_id, date_iso, sleep)
        upsert_daily_health_extended(
            SUPABASE_USER_ID, connection_id, date_iso,
            summary, hydration, hrv, bb, spo2,
        )
        upsert_daily_steps(SUPABASE_USER_ID, connection_id, date_iso, summary, steps_buckets)
        upsert_intraday_body_battery(SUPABASE_USER_ID, connection_id, date_iso, bb)

    progress("Syncing recent activities", stage="activities", percent=95)
    activity_count = sync_recent_garmin_activities(api, SUPABASE_USER_ID, connection_id)

    # Sync weigh-ins: always fetch the last 90 days so we pick up
    # any weight entries not logged on the same days as activities.
    weight_end = date.today().isoformat()
    weight_start = (date.today() - timedelta(days=89)).isoformat()
    progress(f"Syncing weigh-ins {weight_start} to {weight_end}", stage="weigh_ins", percent=98)
    try:
        weight_entries = get_weigh_ins_data(api, weight_start, weight_end)
        weight_count = upsert_weight_snapshots(SUPABASE_USER_ID, connection_id, weight_entries)
        throttle()
        print(f"  Upserted {weight_count} weigh-in entries")
    except Exception as exc:
        print(f"  Warning: weigh-ins sync failed: {exc}")

    update_connection_status(
        connection_id,
        SUPABASE_USER_ID,
        "connected",
        external_account_id=full_name or None,
        last_sync_at=utc_now_iso(),
        last_successful_sync_at=utc_now_iso(),
        backfill_complete=True,
        last_error=None,
    )

    progress(
        f"Sync complete. Days: {len(dates_to_sync)}, activities: {activity_count}",
        level="done",
        stage="complete",
        percent=100,
    )
    print(f"  User: {full_name or 'unknown'}")


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        print("Cancelled.")
        sys.exit(130)
    except Exception as exc:
        print(f"Sync failed: {exc}")
        raise

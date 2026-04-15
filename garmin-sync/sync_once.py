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


def get_steps_data(api: Garmin, date_iso: str) -> dict[str, Any]:
    """Returns daily steps data from Garmin."""
    success, data, err = safe_call(api.get_steps_data, date_iso)
    if success and isinstance(data, dict):
        return data
    if err:
        print(f"  Warning: get_steps_data failed: {err}")
    return {}


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
) -> tuple[Optional[int], Optional[int], Optional[int]]:
    """
    Returns (high, low, end_of_day) Body Battery values.
    Prefers the detailed readings list; falls back to summary fields.
    """
    if bb_readings:
        levels = [
            r.get("bodyBatteryLevel") or r.get("level")
            for r in bb_readings
            if r.get("bodyBatteryLevel") is not None or r.get("level") is not None
        ]
        levels = [l for l in levels if l is not None]
        if levels:
            high = max(levels)
            low = min(levels)
            eod = levels[-1]  # last reading of the day
            return as_int(high), as_int(low), as_int(eod)

    # Fallback to summary
    high = as_int(pick_first(summary, ["bodyBatteryChargedLevel", "highBodyBattery"]))
    low = as_int(pick_first(summary, ["bodyBatteryDrainedLevel", "lowBodyBattery"]))
    eod = as_int(pick_first(summary, ["lastUpdatedBodyBatteryLevel", "endOfDayBodyBatteryLevel"]))
    return high, low, eod


def extract_sleep_session_data(sleep_data: dict[str, Any], date_iso: str) -> dict[str, Any]:
    """
    Extract detailed sleep session data from Garmin sleep response.
    Returns normalized data for garmin_sleep_data table.
    """
    dto = sleep_data.get("dailySleepDTO") or sleep_data
    sleep_start = dto.get("sleepTimeTimestamp") or dto.get("sleep_start_timestamp")
    sleep_end = dto.get("wakeTimeTimestamp") or dto.get("wake_time_timestamp")

    # Sleep stages in seconds
    stages = dto.get("sleepLevels") or {}
    awake_sec = as_int(stages.get("awake")) or as_int(stages.get("awakeSeconds")) or 0
    light_sec = as_int(stages.get("light")) or as_int(stages.get("lightSeconds")) or 0
    deep_sec = as_int(stages.get("deep")) or as_int(stages.get("deepSeconds")) or 0
    rem_sec = as_int(stages.get("rem")) or as_int(stages.get("remSeconds")) or 0

    # Duration
    duration_sec = as_int(dto.get("duration")) or as_int(dto.get("sleepDurationSeconds"))

    # Sleep scores
    sleep_score = extract_sleep_score(sleep_data)
    quality_score = as_int(dto.get("sleepQualityScore")) or as_int(dto.get("qualityScore"))

    # Physiological metrics
    avg_spo2 = as_float(pick_first(dto, ["averageSpO2Value", "averageSpO2", "avgSpO2"]))
    min_spo2 = as_float(pick_first(dto, ["minSpO2Value", "minSpO2", "lowestSpO2"]))
    avg_resp = as_float(pick_first(dto, ["averageRespirationValue", "averageRespiration", "avgRespiration"]))
    avg_hr = as_int(pick_first(dto, ["averageHeartRate", "avgHeartRate", "avgHR"]))
    max_hr = as_int(pick_first(dto, ["maxHeartRate", "maxHeartRate", "maxHR"]))

    # Stress during sleep
    stress_score = as_int(dto.get("sleepStressScore")) or as_int(dto.get("stressScore"))

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
) -> dict[str, Any]:
    """
    Extract extended daily health metrics for garmin_daily_health_metrics table.
    """
    hrv_summary = hrv_data.get("hrvSummary") or {}

    # Body Battery detailed
    bb_start = as_int(pick_first(summary, ["bodyBatteryChargedLevel", "startBodyBattery"]))
    bb_end = as_int(pick_first(summary, ["lastUpdatedBodyBatteryLevel", "endOfDayBodyBatteryLevel"]))
    bb_peak, bb_low, _ = extract_body_battery_stats(summary, bb_readings)

    # Stress
    stress_avg = as_int(pick_first(summary, ["averageStressLevel", "stressScore"]))
    stress_max = as_int(pick_first(summary, ["maxStressLevel"]))
    stress_min = as_int(pick_first(summary, ["minStressLevel"]))

    # HRV
    hrv_avg = as_int(hrv_summary.get("lastNight"))
    hrv_min = as_int(hrv_summary.get("min"))
    hrv_max = as_int(hrv_summary.get("max"))
    hrv_status = hrv_summary.get("status")

    # Respiration
    resp_avg = as_float(pick_first(summary, ["averageRespirationValue", "avgRespiration"]))
    resp_min = as_float(pick_first(summary, ["minRespirationValue", "minRespiration"]))
    resp_max = as_float(pick_first(summary, ["maxRespirationValue", "maxRespiration"]))

    # SpO2
    spo2_avg = as_float(pick_first(summary, ["averageSpO2", "avgSpO2"]))
    spo2_min = as_float(pick_first(summary, ["minSpO2", "lowestSpO2"]))
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


def extract_daily_steps_data(steps_data: dict[str, Any]) -> dict[str, Any]:
    """
    Extract daily steps data for garmin_daily_steps table.
    """
    total_steps = as_int(pick_first(steps_data, ["totalSteps", "steps", "total_steps"])) or 0
    total_distance = as_float(pick_first(steps_data, ["totalDistanceMeters", "totalDistance", "distance_m"])) or 0
    total_calories = as_int(pick_first(steps_data, ["totalCalories", "calories", "active_calories"])) or 0

    # Activity time
    active_min = as_int(pick_first(steps_data, ["activeMinutes", "highlyActiveSeconds", "active_seconds"])) or 0
    if active_min > 60:
        active_min = active_min // 60  # Convert from seconds if needed

    sedentary_min = as_int(pick_first(steps_data, ["sedentarySeconds", "sedentary_minutes"])) or 0
    if sedentary_min > 60:
        sedentary_min = sedentary_min // 60

    # Hourly breakdown if available
    hourly = steps_data.get("totalSteps") or steps_data.get("hourlySteps") or []
    hourly_steps = hourly if isinstance(hourly, list) else None

    return {
        "total_steps": total_steps,
        "total_distance_meters": total_distance,
        "total_calories": total_calories,
        "active_minutes": active_min,
        "sedentary_minutes": sedentary_min,
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

    bb_high, bb_low, bb_eod = extract_body_battery_stats(summary, bb_readings)
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
        "respiration_rate": as_float(pick_first(summary, ["averageRespirationValue", "respirationRate", "respiration_rate"])),
        "pulse_ox": as_float(pick_first(summary, ["averageSpO2", "pulseOx", "pulse_ox"])),
        "body_composition": summary.get("bodyComposition"),
        # Garmin enriched: Body Battery
        "garmin_body_battery_high": bb_high,
        "garmin_body_battery_low": bb_low,
        "garmin_body_battery_eod": bb_eod,
        # Garmin enriched: Stress
        "garmin_stress_avg": as_int(pick_first(summary, ["averageStressLevel", "stressScore"])),
        "garmin_stress_max": as_int(pick_first(summary, ["maxStressLevel"])),
        # Garmin enriched: HRV
        "garmin_hrv_nightly_avg": as_int(hrv_summary.get("lastNight")),
        "garmin_hrv_5day_avg": as_int(hrv_summary.get("weeklyAvg") or hrv_summary.get("fiveDayAvg")),
        "garmin_hrv_status": hrv_summary.get("status"),
        # Garmin enriched: Sleep
        "garmin_sleep_score": sleep_score,
        "garmin_spo2_avg": as_float(
            pick_first(sleep_dto, ["averageSpO2Value", "averageSpO2"])
            or summary.get("averageSpO2")
        ),
        "garmin_respiration_avg": as_float(
            pick_first(sleep_dto, ["averageRespirationValue", "averageRespiration"])
            or summary.get("averageRespirationValue")
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
) -> None:
    """
    Upsert extended daily health metrics into garmin_daily_health_metrics table.
    """
    extracted = extract_daily_health_metrics(summary, hydration, hrv_data, bb_readings)

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
        },
        "created_at": utc_now_iso(),
    }

    supabase_upsert("garmin_daily_health_metrics", payload, on_conflict="connection_id,metric_date")
    print(f"  Upserted garmin_daily_health_metrics for {date_iso}")


def upsert_daily_steps(
    user_id: str,
    connection_id: str,
    date_iso: str,
    steps_data: dict[str, Any],
) -> None:
    """
    Upsert daily steps data into garmin_daily_steps table.
    Uses upsert logic to update the same row when steps change during the day.
    """
    if not steps_data:
        return

    extracted = extract_daily_steps_data(steps_data)

    payload = {
        "user_id": user_id,
        "connection_id": connection_id,
        "step_date": date_iso,
        **extracted,
        "raw_payload": steps_data,
        "created_at": utc_now_iso(),
    }

    supabase_upsert("garmin_daily_steps", payload, on_conflict="connection_id,step_date")
    print(f"  Upserted garmin_daily_steps for {date_iso} (total: {extracted['total_steps']})")


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


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main() -> None:
    print("Starting Garmin sync...")

    api = login_garmin()

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

    for date_iso in dates_to_sync:
        print(f"\nSyncing {date_iso}...")

        daily = get_daily_summary(api, date_iso)
        hrv = get_hrv_data(api, date_iso)
        sleep = get_sleep_data(api, date_iso)
        bb = get_body_battery(api, date_iso)
        steps = get_steps_data(api, date_iso)

        summary = daily.get("summary") or {}
        hydration = daily.get("hydration")

        # Upsert to all tables
        upsert_daily_health(SUPABASE_USER_ID, connection_id, date_iso, daily, hrv, sleep, bb)
        upsert_sleep_data(SUPABASE_USER_ID, connection_id, date_iso, sleep)
        upsert_daily_health_extended(SUPABASE_USER_ID, connection_id, date_iso, summary, hydration, hrv, bb)
        upsert_daily_steps(SUPABASE_USER_ID, connection_id, date_iso, steps)

    activity_count = sync_recent_garmin_activities(api, SUPABASE_USER_ID, connection_id)

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

    print(f"\nSync complete.")
    print(f"  User: {full_name or 'unknown'}")
    print(f"  Days synced: {len(dates_to_sync)}")
    print(f"  Activities synced: {activity_count}")


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        print("Cancelled.")
        sys.exit(130)
    except Exception as exc:
        print(f"Sync failed: {exc}")
        raise

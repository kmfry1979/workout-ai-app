"""AthleteIQ MCP server.

Exposes Kelvin's Supabase fitness data (synced from Garmin) as read-only
MCP tools, so Claude Desktop / claude.ai can query it directly instead of
needing the data hand-fed into a prompt.

Run locally:
    python server.py

Deploy: see Dockerfile + README.md in this directory.
"""

import os

from dotenv import load_dotenv

load_dotenv()

from fastmcp import FastMCP
from fastmcp.server.auth.providers.google import GoogleProvider
from fastmcp.server.dependencies import get_access_token

import supabase_client as db

GOOGLE_CLIENT_ID = os.getenv("GOOGLE_OAUTH_CLIENT_ID", "").strip()
GOOGLE_CLIENT_SECRET = os.getenv("GOOGLE_OAUTH_CLIENT_SECRET", "").strip()
MCP_BASE_URL = os.getenv("MCP_BASE_URL", "").strip()
MCP_JWT_SIGNING_KEY = os.getenv("MCP_JWT_SIGNING_KEY", "").strip()
ALLOWED_EMAIL = os.getenv("ALLOWED_EMAIL", "kmfry1979@gmail.com").strip()

for var_name, value in {
    "GOOGLE_OAUTH_CLIENT_ID": GOOGLE_CLIENT_ID,
    "GOOGLE_OAUTH_CLIENT_SECRET": GOOGLE_CLIENT_SECRET,
    "MCP_BASE_URL": MCP_BASE_URL,
    "MCP_JWT_SIGNING_KEY": MCP_JWT_SIGNING_KEY,
}.items():
    if not value:
        raise RuntimeError(f"{var_name} is required")

auth = GoogleProvider(
    client_id=GOOGLE_CLIENT_ID,
    client_secret=GOOGLE_CLIENT_SECRET,
    base_url=MCP_BASE_URL,
    jwt_signing_key=MCP_JWT_SIGNING_KEY,
    required_scopes=["openid", "email", "profile"],
)

mcp = FastMCP("athleteiq", auth=auth)


def _require_owner() -> None:
    """Reject any caller whose Google account isn't ALLOWED_EMAIL."""
    token = get_access_token()
    claims = token.claims or {}
    email = claims.get("email") or (claims.get("upstream_claims") or {}).get("email")
    if email != ALLOWED_EMAIL:
        raise PermissionError(f"Access denied for {email!r}")


@mcp.tool
def get_recent_activities(limit: int = 20, activity_type: str | None = None) -> list[dict]:
    """List recent Garmin activities, most recent first.

    activity_type filters with a case-insensitive substring match
    (e.g. "running", "strength", "treadmill").
    """
    _require_owner()
    params = {
        "select": "id,activity_type,start_time,duration_sec,distance_m,avg_hr,max_hr,training_effect,calories",
        "order": "start_time.desc",
        "limit": str(limit),
    }
    if activity_type:
        params["activity_type"] = f"ilike.*{activity_type}*"
    return db.select("garmin_activities", params)


@mcp.tool
def get_activity_detail(activity_id: str) -> list[dict]:
    """Full detail for one activity (id from get_recent_activities), including
    raw_payload (laps, HR series, etc)."""
    _require_owner()
    return db.select(
        "garmin_activities",
        {"select": "*", "id": f"eq.{activity_id}", "limit": "1"},
    )


@mcp.tool
def get_health_metrics(start_date: str, end_date: str) -> list[dict]:
    """Daily health metrics (HRV, body battery, stress, steps, SpO2, training readiness)
    between start_date and end_date (YYYY-MM-DD, inclusive)."""
    _require_owner()
    return db.select(
        "garmin_daily_health_metrics",
        {
            "select": "metric_date,hrv_avg,hrv_status,stress_avg,body_battery_end,"
            "spo2_avg,respiration_avg_bpm,training_readiness_score,"
            "training_readiness_label,training_status_phase",
            "metric_date": f"gte.{start_date}",
            "and": f"(metric_date.lte.{end_date})",
            "order": "metric_date.asc",
        },
    )


@mcp.tool
def get_sleep_data(start_date: str, end_date: str) -> list[dict]:
    """Sleep stages and scores between start_date and end_date (YYYY-MM-DD, inclusive)."""
    _require_owner()
    return db.select(
        "garmin_sleep_data",
        {
            "select": "sleep_date,sleep_score,sleep_duration_seconds,"
            "deep_sleep_seconds,avg_respiration_bpm",
            "sleep_date": f"gte.{start_date}",
            "and": f"(sleep_date.lte.{end_date})",
            "order": "sleep_date.asc",
        },
    )


@mcp.tool
def get_weight_history(start_date: str, end_date: str) -> list[dict]:
    """Weigh-ins between start_date and end_date (YYYY-MM-DD, inclusive).

    Returns only core columns (weight, body fat %, BMI) — body composition
    extras like muscle/bone mass live in raw_payload and aren't selected
    directly, since they may not exist in the PostgREST schema cache.
    """
    _require_owner()
    return db.select(
        "garmin_weight_snapshots",
        {
            "select": "weigh_date,weight_kg,weight_grams,body_fat_pct,bmi,raw_payload",
            "weigh_date": f"gte.{start_date}",
            "and": f"(weigh_date.lte.{end_date})",
            "order": "weigh_date.asc",
        },
    )


@mcp.tool
def get_profile_and_thresholds() -> list[dict]:
    """Kelvin's profile: race thresholds, race predictions, race goal, body stats."""
    _require_owner()
    return db.select(
        "profiles",
        {
            "select": "display_name,date_of_birth,height_cm,threshold_5k_sec,"
            "threshold_10k_sec,race_predictions,race_goal,weekly_plan"
        },
    )


@mcp.tool
def get_daily_insight(date: str | None = None) -> list[dict]:
    """AI Brain readiness insight for a given date (YYYY-MM-DD).

    If date is omitted, returns the most recent insight.
    """
    _require_owner()
    cols = "insight_date,insight_text,readiness_score,readiness_label,suggested_focus,raw_context"
    params = {"select": cols, "order": "insight_date.desc", "limit": "1"}
    if date:
        params = {"select": cols, "insight_date": f"eq.{date}"}
    return db.select("daily_insights", params)


if __name__ == "__main__":
    port = int(os.getenv("PORT", "8000"))
    mcp.run(transport="streamable-http", host="0.0.0.0", port=port)

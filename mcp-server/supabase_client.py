"""Thin Supabase REST wrapper for the AthleteIQ MCP server.

Uses the service role key directly against PostgREST (same pattern as
garmin-sync/sync_once.py) so it bypasses RLS and is scoped to one user_id.
"""

import os

import requests

SUPABASE_URL = os.getenv("SUPABASE_URL", "").rstrip("/")
SUPABASE_SERVICE_ROLE_KEY = os.getenv("SUPABASE_SERVICE_ROLE_KEY", "").strip()
SUPABASE_USER_ID = os.getenv("SUPABASE_USER_ID", "").strip()

for var_name, value in {
    "SUPABASE_URL": SUPABASE_URL,
    "SUPABASE_SERVICE_ROLE_KEY": SUPABASE_SERVICE_ROLE_KEY,
    "SUPABASE_USER_ID": SUPABASE_USER_ID,
}.items():
    if not value:
        raise RuntimeError(f"{var_name} is required")

_HEADERS = {
    "apikey": SUPABASE_SERVICE_ROLE_KEY,
    "Authorization": f"Bearer {SUPABASE_SERVICE_ROLE_KEY}",
}


def select(table: str, params: dict) -> list[dict]:
    """Run a read-only PostgREST select scoped to SUPABASE_USER_ID."""
    query = {"user_id": f"eq.{SUPABASE_USER_ID}", **params}
    resp = requests.get(
        f"{SUPABASE_URL}/rest/v1/{table}",
        headers=_HEADERS,
        params=query,
        timeout=30,
    )
    resp.raise_for_status()
    return resp.json()

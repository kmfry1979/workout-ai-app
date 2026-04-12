import os
from datetime import datetime, timezone
from pathlib import Path

import requests
from dotenv import load_dotenv
from garminconnect import Garmin

load_dotenv(".env.local")

GARMIN_EMAIL = os.environ["GARMIN_EMAIL"]
GARMIN_PASSWORD = os.environ["GARMIN_PASSWORD"]
SUPABASE_URL = (os.environ.get("SUPABASE_URL") or os.environ["NEXT_PUBLIC_SUPABASE_URL"]).rstrip("/")
SUPABASE_SERVICE_ROLE_KEY = os.environ["SUPABASE_SERVICE_ROLE_KEY"]
USER_ID = os.environ["SUPABASE_USER_ID"]

TOKEN_DIR = Path(".garmin_tokens")
TOKEN_DIR.mkdir(exist_ok=True)

print("Starting Garmin bootstrap...")
print(f"Logging in as {GARMIN_EMAIL}")

client = Garmin(
    email=GARMIN_EMAIL,
    password=GARMIN_PASSWORD,
    is_cn=False,
    return_on_mfa=True,
)

result1, result2 = client.login()

if result1 == "needs_mfa":
    mfa_code = input("Enter your Garmin 2FA code: ").strip()
    client.resume_login(result2, mfa_code)
    print("MFA accepted.")

print("Login successful.")

# Save tokens locally
if hasattr(client, "garth") and hasattr(client.garth, "dump"):
    client.garth.dump(str(TOKEN_DIR))
else:
    raise RuntimeError("Cannot dump tokens — update garminconnect library.")

token_files = {
    f.name: f.read_text(encoding="utf-8")
    for f in TOKEN_DIR.iterdir()
    if f.is_file()
}

if not token_files:
    raise RuntimeError("No token files created in .garmin_tokens")

print(f"Captured {len(token_files)} token file(s): {', '.join(token_files.keys())}")

# Upload to Supabase garmin_token_store
headers = {
    "apikey": SUPABASE_SERVICE_ROLE_KEY,
    "Authorization": f"Bearer {SUPABASE_SERVICE_ROLE_KEY}",
    "Content-Type": "application/json",
    "Prefer": "resolution=merge-duplicates",
}

res = requests.post(
    f"{SUPABASE_URL}/rest/v1/garmin_token_store",
    headers=headers,
    json={
        "user_id": USER_ID,
        "token_files": token_files,
        "updated_at": datetime.now(timezone.utc).isoformat(),
    },
)

if res.status_code >= 400:
    raise RuntimeError(f"Failed to store tokens in Supabase: {res.status_code} {res.text}")

print("Garmin tokens uploaded to Supabase successfully.")
print("You can now run the GitHub Actions workflow — it will reuse these tokens.")

import os
import sys
import time
import requests
from garminconnect import Garmin, GarminConnectConnectionError

email = os.environ["GARMIN_EMAIL"]
password = os.environ["GARMIN_PASSWORD"]
supabase_url = os.environ["SUPABASE_URL"]
supabase_key = os.environ["SUPABASE_SERVICE_ROLE_KEY"]
user_id = os.environ["USER_ID"]

print("Logging into Garmin...")

# 🔥 Retry logic for Garmin rate limiting
max_attempts = 3
for attempt in range(max_attempts):
    try:
        client = Garmin(email, password)
        client.login()
        print("Login successful")
        break
    except GarminConnectConnectionError as e:
        print(f"Login failed (attempt {attempt + 1}): {e}")
        
        if "429" in str(e):
            print("Rate limited by Garmin. Waiting 60 seconds...")
            time.sleep(60)
        else:
            sys.exit(1)
else:
    print("Failed to login after retries")
    sys.exit(1)

print("Fetching activities...")
activities = client.get_activities(0, 20)

print(f"Fetched {len(activities)} activities")

headers = {
    "apikey": supabase_key,
    "Authorization": f"Bearer {supabase_key}",
    "Content-Type": "application/json",
}

for a in activities:
    data = {
        "user_id": user_id,
        "provider_activity_id": str(a.get("activityId")),  # 🔥 important for dedupe later
        "activity_type": str(a.get("activityType")),
        "start_time": a.get("startTimeLocal"),
        "duration_sec": a.get("duration"),
        "distance_m": a.get("distance"),
        "calories": a.get("calories"),
        "avg_hr": a.get("averageHR"),
    }

    print("Uploading:", data["start_time"])

    res = requests.post(
        f"{supabase_url}/rest/v1/garmin_activities",
        headers=headers,
        json=data,
    )

    print("Insert status:", res.status_code)

    if res.status_code >= 400:
        print("Error inserting:", res.text)

import os
import requests
from garminconnect import Garmin

email = os.environ["GARMIN_EMAIL"]
password = os.environ["GARMIN_PASSWORD"]
supabase_url = os.environ["SUPABASE_URL"]
supabase_key = os.environ["SUPABASE_SERVICE_ROLE_KEY"]
user_id = os.environ["USER_ID"]

print("Logging into Garmin...")
client = Garmin(email, password)
client.login()

print("Fetching activities...")
activities = client.get_activities(0, 10)

headers = {
    "apikey": supabase_key,
    "Authorization": f"Bearer {supabase_key}",
    "Content-Type": "application/json",
}

for a in activities:
    data = {
        "user_id": user_id,
        "activity_type": str(a.get("activityType")),
        "start_time": a.get("startTimeLocal"),
        "duration_sec": a.get("duration"),
        "distance_m": a.get("distance"),
        "calories": a.get("calories"),
        "avg_hr": a.get("averageHR"),
    }

    print("Uploading:", data["start_time"])

    requests.post(
        f"{supabase_url}/rest/v1/garmin_activities",
        headers=headers,
        json=data,
    )

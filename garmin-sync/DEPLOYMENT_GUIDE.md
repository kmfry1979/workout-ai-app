# Garmin Sync Enhancement - Deployment Guide

## Overview

This update adds three new tables to capture detailed Garmin health data:
1. **garmin_sleep_data** - Detailed sleep sessions with stages and scores
2. **garmin_daily_health_metrics** - Extended metrics (Body Battery detailed, HRV, stress, hydration)
3. **garmin_daily_steps** - Daily step counts (single row per day, upsert logic)

Plus a new **AI Insights** section on the dashboard that analyzes all metrics and provides personalized recommendations.

---

## Step 1: Run Database Migration

Run the following SQL in your Supabase Dashboard:

1. Go to Supabase Dashboard → SQL Editor → New Query
2. Copy and paste the contents of `schema_migration_v2.sql`
3. Execute the query

**File:** `garmin-sync/schema_migration_v2.sql`

This creates:
- `garmin_sleep_data` table with sleep stages, scores, and physiological metrics
- `garmin_daily_health_metrics` table with Body Battery, stress, HRV, SpO2, hydration
- `garmin_daily_steps` table with daily step counts (upsert on date)
- Indexes for performance
- Triggers for auto-updating `updated_at` fields

---

## Step 2: Update Garmin Sync

The sync script (`garmin-sync/sync_once.py`) has been updated to:

1. Fetch sleep data via `api.get_sleep_data()`
2. Fetch steps data via `api.get_steps_data()`
3. Populate all three new tables on each sync

### Test Locally (Recommended)

```bash
cd C:\Users\Kelv\workout-ai-app
python garmin-sync/sync_once.py
```

Check the output for any errors and verify data is being inserted.

### Trigger GitHub Actions Sync

1. Go to GitHub → Actions → Garmin Sync workflow
2. Click "Run workflow"
3. Optionally set `days_back` to sync historical data (e.g., "7" for past week)
4. Click "Run workflow"

---

## Step 3: Deploy Website

The dashboard page (`app/dashboard/page.tsx`) has been updated with:

- New type definitions for sleep, health metrics, and steps data
- Data loading from all new tables
- **AI Insights** expandable section with personalized analysis
- Enhanced Body Battery display (start/peak/low/end)
- Detailed sleep analysis with stage breakdown visualization
- Extended stress metrics with HRV
- Daily steps card with distance and active minutes
- Hydration tracking with progress bar

### Build & Test Locally

```bash
cd C:\Users\Kelv\workout-ai-app
npm run build
npm run dev
```

Visit `http://localhost:3000/dashboard` and verify:
- All new metric cards display correctly
- AI Insights section expands and shows recommendations
- No console errors

### Deploy to Production

Depending on your hosting setup:

**If using Vercel:**
```bash
# Install Vercel CLI if not already installed
npm install -g vercel

# Deploy
vercel --prod
```

**If using another host:**
1. Push changes to your git repository
2. The connected deployment service should auto-deploy
3. Or trigger a manual deployment from your hosting dashboard

---

## Step 4: Verify Data Population

After the sync runs, verify data in Supabase:

```sql
-- Check sleep data
SELECT sleep_date, sleep_score, sleep_duration_seconds, avg_spO2
FROM garmin_sleep_data
ORDER BY sleep_date DESC
LIMIT 7;

-- Check daily health metrics
SELECT metric_date, body_battery_peak, body_battery_low, stress_avg, hrv_avg
FROM garmin_daily_health_metrics
ORDER BY metric_date DESC
LIMIT 7;

-- Check daily steps
SELECT step_date, total_steps, total_distance_meters, active_minutes
FROM garmin_daily_steps
ORDER BY step_date DESC
LIMIT 7;
```

---

## New Dashboard Features

### AI Insights Section
- Expandable card with personalized analysis
- Analyzes Body Battery, sleep quality, HRV, stress, activity, and steps
- Provides actionable recommendations based on current state
- Examples:
  - Low Body Battery → Recovery focus
  - Good sleep + high BB → Workout recommendations
  - Elevated stress → Stress reduction activities

### Enhanced Metrics Display
- **Body Battery**: Start/Peak/Low/End values
- **Sleep Analysis**: Score, duration, quality, stage breakdown visualization
- **Stress**: Average + Max with HRV correlation
- **Steps**: Total steps, distance, active minutes, calories burned
- **Hydration**: Intake vs goal with progress bar

---

## Troubleshooting

### Sync Fails with Rate Limit (429)
- Garmin rate limits are strict. Wait 24 hours before retrying
- In CI, password fallback is disabled to protect against rate limiting
- Use `bootstrap_tokens.py` locally to upload fresh tokens

### Tables Not Populating
1. Verify migration SQL ran successfully
2. Check `provider_connections` table for valid connection_id
3. Ensure `SUPABASE_USER_ID` environment variable is correct
4. Check sync logs for specific error messages

### AI Insights Not Showing
1. Ensure all new tables have data for today's date
2. Check browser console for errors
3. Verify Supabase RLS policies allow read access

---

## Environment Variables Required

For Garmin Sync (GitHub Actions):
- `GARMIN_EMAIL`
- `GARMIN_PASSWORD`
- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `SUPABASE_USER_ID`

For Website:
- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`

---

## Files Modified

### Python/Sync
- `garmin-sync/schema_migration_v2.sql` (NEW)
- `garmin-sync/sync_once.py` (UPDATED)

### Website
- `app/dashboard/page.tsx` (UPDATED)

### Documentation
- `garmin-sync/DEPLOYMENT_GUIDE.md` (NEW - this file)

---

## Support

If you encounter issues:
1. Check sync logs in GitHub Actions
2. Review Supabase logs for database errors
3. Check browser console for frontend errors
4. Verify all environment variables are set correctly

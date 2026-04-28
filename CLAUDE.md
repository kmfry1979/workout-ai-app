@AGENTS.md

# AthleteIQ — Project Intelligence

## What this app is
A personal fitness dashboard for Kelvin (kmfry1979@gmail.com). It syncs Garmin Connect data into Supabase, then surfaces it through a Next.js frontend with AI coaching powered by Groq (LLaMA). Deployed on Vercel. Sync runs as a GitHub Actions workflow.

---

## Stack

| Layer | Technology |
|---|---|
| Frontend | Next.js (App Router) — check `node_modules/next/dist/docs/` before writing any code |
| Database | Supabase (Postgres + PostgREST + Auth) |
| AI | Groq API (LLaMA) via `lib/groq.ts` |
| Sync | Python (`garmin-sync/sync_once.py`) + `garminconnect` library |
| Deployment | Vercel (frontend) + GitHub Actions (sync worker) |
| Styling | Tailwind CSS, dark theme throughout |

---

## Key pages

| Route | File | Purpose |
|---|---|---|
| `/dashboard` | `app/dashboard/page.tsx` | Home overview |
| `/health` | `app/health/page.tsx` | Main analytics hub — Today / Analytics / Training tabs |
| `/you` | `app/you/page.tsx` | Body metrics: weight, BMI, body fat, race predictions, PRs |
| `/activities` | `app/activities/page.tsx` | Activity list |
| `/activities/[id]` | `app/activities/[id]/page.tsx` | Activity detail — HR chart, pace zones, AI insight |
| `/coach` | `app/coach/page.tsx` | AI chat coach |
| `/profile` | `app/profile/page.tsx` | User profile — name, DOB, height, 5K time, provider |
| `/athlytic` | `app/athlytic/page.tsx` | Athlytic-style view |

---

## Key API routes

| Route | Purpose |
|---|---|
| `app/api/coach/activity/route.ts` | AI insight for a single activity (paceInsight + hrInsight + analysis) |
| `app/api/coach/chat/route.ts` | Streaming AI coach chat |
| `app/api/ai/weekly-plan/route.ts` | Generate 7-day training plan via Groq |
| `app/api/ai/snapshot/route.ts` | Daily snapshot AI summary |
| `app/api/brain/generate-insight/route.ts` | Daily readiness insight → daily_insights table |
| `app/api/integrations/garmin/sync/route.ts` | Trigger sync from UI |

---

## Supabase tables (key ones)

| Table | Purpose |
|---|---|
| `profiles` | User profile — `display_name`, `height_cm`, `date_of_birth`, `threshold_5k_sec`, `weekly_plan` JSONB, `race_goal` JSONB, `race_predictions` JSONB |
| `garmin_activities` | One row per activity — `raw_payload` has full Garmin JSON incl. `laps[]` |
| `garmin_daily_health_metrics` | Daily metrics — HRV, body battery, stress, steps, SpO2, training readiness |
| `garmin_weight_snapshots` | Weigh-ins — `weigh_date`, `weight_grams`, `weight_kg`, `body_fat_pct`, `bmi` |
| `garmin_sleep_data` | Sleep stages and scores |
| `daily_health_metrics` | Older sync table — still used for `body_composition` fallback |
| `daily_insights` | Brain AI readiness summaries (one row per user per day) |
| `provider_connections` | Garmin connection record — `id` is `connection_id` used in most tables |
| `garmin_token_store` | Garmin OAuth tokens stored as JSONB for GitHub Actions |

### Schema migrations
Run `garmin-sync/schema_migration_v3.sql` in **Supabase → SQL Editor** whenever columns are added. After any ALTER TABLE, always end with `NOTIFY pgrst, 'reload schema';` — PostgREST caches the schema and will return 400 errors for new columns until reloaded.

---

## Garmin sync (`garmin-sync/sync_once.py`)

### Weight data — known quirks
The standard `get_weigh_ins()` (range endpoint) returns 0 entries for this account. Three fallback paths are tried in order:
1. `get_weigh_ins()` → `/weight/range/{start}/{end}`
2. `get_body_composition()` → `/weight/dateRange`
3. `get_daily_weigh_ins()` → `/weight/dayview/{date}` — scans last 30 days. **This is what actually works for this account.**

Never add optional body-comp columns (`muscle_mass_kg`, `bone_mass_kg`) to PostgREST SELECT queries in the frontend — they may not be in the schema cache and will cause a 400 error that silently falls through to stale fallback data. Derive from `raw_payload` instead.

### Activity laps
Running activities have laps fetched via `get_activity_splits()` → `lapDTOs` and stored in `raw_payload.laps[]`. Each lap has `averageSpeed`, `averageHR`, `distance`. Used for pace zones and the HR chart.

### Pace zones
Six zones (Z1–Z6) based on 5K threshold pace using Garmin-style multipliers:
- Zone boundaries at 1.28 / 1.10 / 0.98 / 0.92 / 0.86 × 5K pace per km

Threshold pace source priority (highest first):
1. `profiles.threshold_5k_sec` — manually entered in `/profile` (most reliable)
2. `raw_payload.lactateThresholdSpeed` (m/s) from GPS activity ÷ 1.065
3. Jack Daniels formula from VO2Max: `947 × e^(−0.01991 × VO2Max)`

**Only GPS running activities have VO2Max**. Treadmill and walking activities do not. Walking activities may show a VO2Max value (e.g. 41.0) that is not valid for running — always use the manual 5K time from profile as the primary source.

### Race predictions
Synced from Garmin via `api.get_personal_record_for_user()` and stored in `profiles.race_predictions` as JSONB array: `[{distance: number (km), time: number (sec)}]`. A manual `threshold_5k_sec` from profile is converted to a synthetic prediction entry `[{distance: 5, time: sec}]` with highest priority.

---

## AI coaching

All AI calls go through Groq (LLaMA). The activity insight API (`/api/coach/activity`) returns three sections parsed from a single prompt response:
- `paceInsight` — pace zone analysis
- `hrInsight` — heart rate pattern analysis
- `analysis` — overall session summary

Parsing uses regex section markers (`PACE_INSIGHT:`, `HR_INSIGHT:`, `BODY:`).

---

## Patterns to follow

### PostgREST / Supabase selects
- Never select columns that might not exist yet in the schema cache
- If a new column is needed in the frontend, add a fallback that reads from `raw_payload` JSONB if the column is null
- After schema changes: run `NOTIFY pgrst, 'reload schema';` in SQL Editor and wait ~10s before testing

### Weight display
- Always read from `garmin_weight_snapshots` first (ordered by `weigh_date` ascending, last entry = latest)
- Fallback: `daily_health_metrics.body_composition` (old table, stops at 10 Apr 2026)
- Fallback: `garmin_daily_health_metrics.raw_payload.summary` (Garmin daily summary has no bodyWeight for this account)
- Convert: `weight_grams / 1000` → kg → stone/lb via `kgToStoneLb()`

### RLS (Row Level Security)
Most tables have RLS enabled. The sync writes with the service role key (bypasses RLS). The browser client uses the user's JWT — needs a SELECT policy. If a table returns 0 rows in the browser but has data in the SQL Editor, check for a missing RLS SELECT policy:
```sql
CREATE POLICY <table>_select_own ON <table> FOR SELECT USING (auth.uid() = user_id);
```

### Dark theme
All UI uses a dark Tailwind theme. Background: `bg-gray-900` / `bg-gray-800`. Cards: `rounded-2xl bg-gray-800/60 border border-gray-700/50`. Text: `text-white` / `text-gray-400`. Accent colours: green = good/low, amber = moderate, red = high/alert.

---

## Environment variables

| Variable | Where used |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Frontend + sync |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Frontend |
| `SUPABASE_SERVICE_ROLE_KEY` | Sync worker + API routes |
| `SUPABASE_USER_ID` | Sync worker (Kelvin's auth.users UUID) |
| `GARMIN_EMAIL` / `GARMIN_PASSWORD` | Sync worker (first run only) |
| `GARMINTOKENS` | Path to token dir (default `./tokens`) |
| `GROQ_API_KEY` | All AI routes |
| `GARMIN_DAYS_BACK` | How many days to sync (default 1) |
| `GARMIN_ACTIVITY_LIMIT` | Max activities per sync (default 10) |

---

## Common debugging

**Weight showing stale date**: The `garmin_weight_snapshots` SELECT is failing (PostgREST 400 on unknown column) and falling through to old `body_composition` data. Check columns in SELECT vs. schema cache.

**Pace zones wrong / showing "no threshold data"**: `profiles.threshold_5k_sec` is null. Go to `/profile`, enter 5K time as `MM:SS` (e.g. `39:04`), save.

**Sync writing 0 weight entries**: Normal — `get_weigh_ins()` returns nothing for this account. The `get_daily_weigh_ins()` dayview fallback is the working path.

**PostgREST 400 on new column**: Run `NOTIFY pgrst, 'reload schema';` in Supabase SQL Editor and wait 10s.

**Activity pace zones show HR fallback**: No `raw_payload.laps` data. Laps are only fetched for running-type activities. Check `_RUN_TYPE_KEYWORDS` in sync_once.py.

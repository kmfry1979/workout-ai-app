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
| `/profile` | `app/profile/page.tsx` | User profile — name, DOB, height, race time overrides, provider |
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
| `profiles` | User profile — see column list below |
| `garmin_activities` | One row per activity — `raw_payload` has full Garmin JSON incl. `laps[]` |
| `garmin_daily_health_metrics` | Daily metrics — HRV, body battery, stress, steps, SpO2, training readiness |
| `garmin_weight_snapshots` | Weigh-ins — `weigh_date`, `weight_grams`, `weight_kg`, `body_fat_pct`, `bmi` |
| `garmin_sleep_data` | Sleep stages and scores |
| `daily_health_metrics` | Older sync table — still used for `body_composition` fallback |
| `daily_insights` | Brain AI readiness summaries (one row per user per day) |
| `provider_connections` | Garmin connection record — `id` is `connection_id` used in most tables |
| `garmin_token_store` | Garmin OAuth tokens stored as JSONB for GitHub Actions |

### profiles columns

| Column | Type | Purpose |
|---|---|---|
| `display_name` / `name` | TEXT | User's display name |
| `date_of_birth` | DATE | Used for Bio Age calculation |
| `height_cm` | NUMERIC | Used for BMI calculation |
| `workout_provider` | TEXT | e.g. 'Garmin' |
| `threshold_5k_sec` | INTEGER | 5K time in seconds — auto-set by sync from Garmin prediction; manual override via `/profile` |
| `threshold_10k_sec` | INTEGER | 10K time in seconds — auto-set by sync from Garmin prediction; manual override via `/profile` |
| `race_predictions` | JSONB | Raw Garmin race prediction object: `{time5K, time10K, timeHalfMarathon, timeMarathon, calendarDate, ...}` |
| `weekly_plan` | JSONB | AI-generated 7-day training plan `{generated_at, week_start, days:[{day, session, detail, intensity}]}` |
| `race_goal` | JSONB | User's goal race `{name, distance_km, target_sec, race_date}` |

### Schema migrations
Run `garmin-sync/schema_migration_v3.sql` in **Supabase → SQL Editor** whenever columns are added. After any ALTER TABLE, always end with `NOTIFY pgrst, 'reload schema';` — PostgREST caches the schema and will return 400 errors for new columns until reloaded.

**Columns added outside v3 (run manually if setting up fresh):**
```sql
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS threshold_10k_sec INTEGER;
ALTER TABLE garmin_weight_snapshots ADD COLUMN IF NOT EXISTS muscle_mass_kg NUMERIC(8,3);
ALTER TABLE garmin_weight_snapshots ADD COLUMN IF NOT EXISTS bone_mass_kg NUMERIC(8,3);
```

**RLS policy for garmin_weight_snapshots (required — missing by default):**
```sql
ALTER TABLE garmin_weight_snapshots ENABLE ROW LEVEL SECURITY;
CREATE POLICY weight_snapshots_select_own ON garmin_weight_snapshots
    FOR SELECT USING (auth.uid() = user_id);
```

---

## Garmin sync (`garmin-sync/sync_once.py`)

### Weight data — known quirks
The standard `get_weigh_ins()` (range endpoint) returns 0 entries for this account. Three fallback paths are tried in order:
1. `get_weigh_ins()` → `/weight/range/{start}/{end}`
2. `get_body_composition()` → `/weight/dateRange`
3. `get_daily_weigh_ins()` → `/weight/dayview/{date}` — scans last 30 days one day at a time. **This is what actually works for this account.**

Never select optional body-comp columns (`muscle_mass_kg`, `bone_mass_kg`) in PostgREST SELECT queries from the frontend — they may not be in the schema cache and cause a silent 400 → empty result → stale fallback. Derive from `raw_payload` instead.

### Activity laps
Running activities have laps fetched via `get_activity_splits()` → `lapDTOs` and stored in `raw_payload.laps[]`. Each lap has `averageSpeed`, `averageHR`, `distance`. Used for pace zones and the HR chart.

### Pace zones (activity detail page)
Six zones (Z1–Z6) based on 5K threshold pace. Zone boundaries = multiples of 5K pace per km:

| Zone | Multiplier range |
|---|---|
| Z6 Anaerobic | < 0.86 |
| Z5 VO₂ Max | 0.86 – 0.92 |
| Z4 Threshold | 0.92 – 0.98 |
| Z3 Tempo | 0.98 – 1.10 |
| Z2 Aerobic | 1.10 – 1.28 |
| Z1 Recovery | > 1.28 |

**Threshold pace source priority (highest first):**
1. `profiles.threshold_5k_sec` — manual override entered in `/profile` Race Time Overrides
2. `raw_payload.lactateThresholdSpeed` (m/s) ÷ 1.065 — embedded in GPS activity payloads
3. `profiles.race_predictions.time5K` ÷ 5 — Garmin's predicted 5K pace (auto-synced)
4. Jack Daniels VDOT formula: `947 × e^(−0.01991 × VO2Max)` — last resort

**Important:** Walking activities report a VO2Max value (~41) that overestimates running fitness. Treadmill runs have no VO2Max. Always prefer `threshold_5k_sec` or `race_predictions` over VO2Max for treadmill/walking activities.

### Race predictions — Garmin data format
Garmin's `get_race_predictions()` returns a **single object with all distances** (not one object per distance):
```json
{"time5K": 1998, "time10K": 4485, "timeHalfMarathon": 10904, "timeMarathon": 25362, "calendarDate": "2026-04-29"}
```
The `extract5KTimeSec()` function in `app/activities/[id]/page.tsx` handles both this format (`time5K` field) and the older distance-keyed format (`{distance: 5, time: 1998}`).

The sync auto-populates `threshold_5k_sec` and `threshold_10k_sec` from `time5K`/`time10K` on every run. Manual overrides saved via `/profile` take priority in the UI but will be overwritten by the next sync — to make a permanent override, the sync logic would need a "manual flag" (not currently implemented).

---

## `/profile` — Race Time Overrides
The profile page has a "Race Time Overrides" box with 5K and 10K inputs. Both accept:
- `MM:SS` — e.g. `39:04` or `85:30` (minutes can exceed 59)
- `H:MM:SS` — e.g. `1:25:30`

Parsed by `parseTimeSec()` in `app/profile/page.tsx`. Saves to `threshold_5k_sec` / `threshold_10k_sec` as total seconds. Fields pre-load with current values from the DB (whether from sync or previous manual save) via `fmtTimeSec()`.

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
- Derive optional body-comp fields from `raw_payload` JSONB rather than selecting new columns directly
- After schema changes: run `NOTIFY pgrst, 'reload schema';` in SQL Editor and wait ~10s before testing
- If a table returns 0 rows in the browser but has data in SQL Editor → missing RLS SELECT policy

### Weight display (`app/you/page.tsx`)
- Primary: `garmin_weight_snapshots` — select only core columns (`weigh_date, weight_grams, weight_kg, body_fat_pct, body_water_pct, muscle_mass_grams, bone_mass_grams, raw_payload`)
- Fallback A: `daily_health_metrics.body_composition` (stops at 10 Apr 2026)
- Fallback B: `garmin_daily_health_metrics.raw_payload.summary` (Garmin daily summary has no bodyWeight for this account — always empty)
- Convert: `weight_grams / 1000` → kg → stone/lb via `kgToStoneLb()`

### RLS (Row Level Security)
Most tables have RLS enabled. The sync writes with the service role key (bypasses RLS). The browser client uses the user's JWT — needs a SELECT policy. Template:
```sql
ALTER TABLE <table> ENABLE ROW LEVEL SECURITY;
CREATE POLICY <table>_select_own ON <table> FOR SELECT USING (auth.uid() = user_id);
```
`garmin_weight_snapshots` had RLS enabled with no SELECT policy — fixed by adding the policy above.

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

**Weight tile showing stale date (e.g. 10 Apr):**
1. Check `garmin_weight_snapshots` has rows: `SELECT * FROM garmin_weight_snapshots WHERE user_id = (SELECT id FROM auth.users WHERE email = 'kmfry1979@gmail.com') ORDER BY weigh_date DESC LIMIT 5;`
2. If rows exist but page shows old data → missing RLS SELECT policy (see above)
3. If no rows → run sync; dayview fallback will populate from Garmin
4. If SELECT fails with 400 → stale PostgREST schema cache; run `NOTIFY pgrst, 'reload schema';`

**Pace zones showing "VO2Max-estimated" subtitle:**
`threshold_5k_sec` is null or the `race_predictions` format wasn't recognised. Check `profiles.threshold_5k_sec` and `profiles.race_predictions` in SQL Editor. Run a sync to auto-populate, or enter manually in `/profile`.

**Pace zones wrong boundaries:**
The `threshold_5k_sec` value may be incorrect (e.g. 3904 instead of 2344 for 39:04). 3904 ÷ 60 = 65 min — far too slow. Correct value for 39:04 = 2344 seconds. Fix by entering `39:04` in `/profile` Race Time Overrides or triggering a sync to pull from Garmin's race predictions.

**Sync writing 0 weight entries from `get_weigh_ins()`:**
Normal for this account — the range endpoint returns `{dailyWeightSummaries: [], totalAverage: null, ...}`. The `get_daily_weigh_ins()` dayview scan (last 30 days) is the working path.

**PostgREST 400 on new column:**
Run `NOTIFY pgrst, 'reload schema';` in Supabase SQL Editor and wait 10s. If the column genuinely doesn't exist, check with `SELECT column_name FROM information_schema.columns WHERE table_name = '<table>';`

**Activity pace zones show HR fallback only:**
No `raw_payload.laps` data. Laps are fetched only for running-type activities matching `_RUN_TYPE_KEYWORDS` in sync_once.py. The activity type string must contain one of: running, run, jogging, jog, trail_running, treadmill, indoor_running, track_running, virtual_run, ultra_run, obstacle_run, street_running.

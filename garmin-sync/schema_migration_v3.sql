-- =============================================================================
-- AthleteIQ Schema Migration V3
-- Run once in Supabase SQL Editor (Dashboard → SQL Editor → New query)
-- Safe to run multiple times (IF NOT EXISTS / DO blocks throughout)
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. daily_insights — Brain AI readiness summaries (one row per user per day)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS daily_insights (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id       UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    insight_date  DATE NOT NULL,
    insight_text  TEXT,
    readiness_score  INTEGER,
    readiness_label  TEXT CHECK (readiness_label IN ('green','amber','red')),
    suggested_focus  TEXT,
    generated_at  TIMESTAMPTZ DEFAULT now(),
    raw_context   JSONB,
    UNIQUE (user_id, insight_date)
);

CREATE INDEX IF NOT EXISTS idx_daily_insights_user_date
    ON daily_insights(user_id, insight_date DESC);

-- RLS: users can only read their own insights; service role writes
ALTER TABLE daily_insights ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS daily_insights_select_own ON daily_insights;
CREATE POLICY daily_insights_select_own
    ON daily_insights FOR SELECT
    USING (auth.uid() = user_id);

-- -----------------------------------------------------------------------------
-- 2. profiles — add weekly_plan, race_goal, and race_predictions JSONB columns
-- -----------------------------------------------------------------------------
ALTER TABLE profiles
    ADD COLUMN IF NOT EXISTS weekly_plan      JSONB,
    ADD COLUMN IF NOT EXISTS race_goal        JSONB,
    ADD COLUMN IF NOT EXISTS race_predictions JSONB;
-- race_predictions shape: array of { distance: number (km), time: number (sec), ... }
-- populated by sync_once.py → sync_profile_predictions → api.get_race_predictions()

-- weekly_plan shape:
--   { generated_at: string, week_start: string,
--     days: [{ day, session, detail, intensity }] }
--
-- race_goal shape:
--   { name: string, distance_km: number, target_sec: number, race_date: string }

-- -----------------------------------------------------------------------------
-- 3. garmin_weight_snapshots — ensure both weight_grams and weight_kg exist
--    sync_once.py writes weight_grams; old rows may only have weight_kg
-- -----------------------------------------------------------------------------
ALTER TABLE garmin_weight_snapshots
    ADD COLUMN IF NOT EXISTS weight_grams     NUMERIC(10,1),
    ADD COLUMN IF NOT EXISTS weight_kg        NUMERIC(8,3),
    ADD COLUMN IF NOT EXISTS muscle_mass_grams NUMERIC(10,1),
    ADD COLUMN IF NOT EXISTS bone_mass_grams  NUMERIC(10,1);

-- Back-fill weight_kg from weight_grams for any rows that only have one
UPDATE garmin_weight_snapshots SET weight_kg = weight_grams / 1000 WHERE weight_kg IS NULL AND weight_grams IS NOT NULL;
UPDATE garmin_weight_snapshots SET weight_grams = weight_kg * 1000 WHERE weight_grams IS NULL AND weight_kg IS NOT NULL;

-- -----------------------------------------------------------------------------
-- 5. garmin_daily_health_metrics — add Training Readiness columns if missing
--    (added by sync_once.py but may not be in schema yet)
-- -----------------------------------------------------------------------------
ALTER TABLE garmin_daily_health_metrics
    ADD COLUMN IF NOT EXISTS training_readiness_score  INTEGER,
    ADD COLUMN IF NOT EXISTS training_readiness_label  TEXT,
    ADD COLUMN IF NOT EXISTS training_status_phase     TEXT;

-- -----------------------------------------------------------------------------
-- 4. Reload PostgREST schema cache
-- -----------------------------------------------------------------------------
NOTIFY pgrst, 'reload schema';

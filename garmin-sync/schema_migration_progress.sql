-- Live progress log for the Garmin sync worker.
-- The python sync writes a row per phase (login, per-day, per-endpoint) so the
-- UI can stream "what's happening right now" while a long backfill runs.
--
-- Apply once via Supabase SQL editor or `psql`:
--   psql "$SUPABASE_DB_URL" -f schema_migration_progress.sql

CREATE TABLE IF NOT EXISTS garmin_sync_progress (
    id BIGSERIAL PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    run_id TEXT NOT NULL,
    ts TIMESTAMPTZ NOT NULL DEFAULT now(),
    level TEXT NOT NULL DEFAULT 'info',  -- info | warn | error | done
    stage TEXT,                          -- e.g. 'sleep', 'steps', 'activities', 'login'
    message TEXT NOT NULL,
    percent SMALLINT,                    -- 0..100, optional
    days_total INT,                      -- size of the backfill, denormalised for the UI
    day_index INT                        -- which day in the backfill (1-based)
);

CREATE INDEX IF NOT EXISTS idx_garmin_sync_progress_user_ts
    ON garmin_sync_progress(user_id, ts DESC);

CREATE INDEX IF NOT EXISTS idx_garmin_sync_progress_run
    ON garmin_sync_progress(run_id, ts);

-- RLS: a user can read their own progress rows; writes are service-role only.
ALTER TABLE garmin_sync_progress ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS garmin_sync_progress_select_own ON garmin_sync_progress;
CREATE POLICY garmin_sync_progress_select_own
    ON garmin_sync_progress FOR SELECT
    USING (auth.uid() = user_id);

-- Optional housekeeping: drop progress rows older than 7 days.
-- (Run on a schedule or invoke from sync_once.py at startup.)
-- DELETE FROM garmin_sync_progress WHERE ts < now() - INTERVAL '7 days';

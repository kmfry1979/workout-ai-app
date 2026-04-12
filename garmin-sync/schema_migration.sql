-- =============================================================================
-- AthleteIQ Schema Migration
-- Run in Supabase SQL Editor (Dashboard → SQL Editor → New query)
-- Safe to run multiple times (uses IF NOT EXISTS / DO blocks)
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. provider_connections — add missing columns referenced in sync code
-- -----------------------------------------------------------------------------
ALTER TABLE provider_connections
  ADD COLUMN IF NOT EXISTS backfill_start_date   DATE,
  ADD COLUMN IF NOT EXISTS backfill_complete      BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS last_error             TEXT,
  ADD COLUMN IF NOT EXISTS updated_at             TIMESTAMPTZ DEFAULT now(),
  ADD COLUMN IF NOT EXISTS created_at             TIMESTAMPTZ DEFAULT now();

-- Unique constraint required for upsert on_conflict="user_id,provider_type"
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'provider_connections_user_id_provider_type_key'
  ) THEN
    ALTER TABLE provider_connections
      ADD CONSTRAINT provider_connections_user_id_provider_type_key
      UNIQUE (user_id, provider_type);
  END IF;
END $$;

-- -----------------------------------------------------------------------------
-- 2. garmin_token_store — ensure unique constraint on user_id for upsert
-- -----------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'garmin_token_store_user_id_key'
  ) THEN
    ALTER TABLE garmin_token_store
      ADD CONSTRAINT garmin_token_store_user_id_key UNIQUE (user_id);
  END IF;
END $$;

-- -----------------------------------------------------------------------------
-- 3. daily_health_metrics — ensure unique constraint for upsert
--    on_conflict="connection_id,metric_date"
-- -----------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'daily_health_metrics_connection_id_metric_date_key'
  ) THEN
    ALTER TABLE daily_health_metrics
      ADD CONSTRAINT daily_health_metrics_connection_id_metric_date_key
      UNIQUE (connection_id, metric_date);
  END IF;
END $$;

-- Add updated_at for tracking freshness
ALTER TABLE daily_health_metrics
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT now();

-- Trigger to auto-update updated_at on every row change
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS daily_health_metrics_updated_at ON daily_health_metrics;
CREATE TRIGGER daily_health_metrics_updated_at
  BEFORE UPDATE ON daily_health_metrics
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- -----------------------------------------------------------------------------
-- 4. garmin_activities — ensure unique constraint for upsert
--    on_conflict="connection_id,provider_activity_id"
-- -----------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'garmin_activities_connection_id_provider_activity_id_key'
  ) THEN
    ALTER TABLE garmin_activities
      ADD CONSTRAINT garmin_activities_connection_id_provider_activity_id_key
      UNIQUE (connection_id, provider_activity_id);
  END IF;
END $$;

-- -----------------------------------------------------------------------------
-- 5. Reload PostgREST schema cache
-- -----------------------------------------------------------------------------
NOTIFY pgrst, 'reload schema';

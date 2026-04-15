-- =============================================================================
-- AthleteIQ Schema Migration V2 - Sleep, Health Metrics, Steps
-- Run in Supabase SQL Editor (Dashboard → SQL Editor → New query)
-- Safe to run multiple times (uses IF NOT EXISTS / DO blocks)
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. garmin_sleep_data — detailed sleep sessions from Garmin
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS garmin_sleep_data (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL,
    connection_id UUID NOT NULL REFERENCES provider_connections(id),

    -- Date this sleep session belongs to (the day you woke up)
    sleep_date DATE NOT NULL,

    -- Sleep timing
    sleep_start TIMESTAMP WITH TIME ZONE,
    sleep_end TIMESTAMP WITH TIME ZONE,
    sleep_duration_seconds INTEGER,

    -- Sleep stages (seconds spent in each stage)
    awake_seconds INTEGER DEFAULT 0,
    light_sleep_seconds INTEGER DEFAULT 0,
    deep_sleep_seconds INTEGER DEFAULT 0,
    rem_sleep_seconds INTEGER DEFAULT 0,

    -- Sleep scores and metrics
    sleep_score INTEGER,
    sleep_quality_score INTEGER,

    -- Physiological metrics during sleep
    avg_spO2 NUMERIC(5,2),
    min_spO2 NUMERIC(5,2),
    avg_respiration_bpm NUMERIC(5,2),
    avg_heart_rate_bpm INTEGER,
    max_heart_rate_bpm INTEGER,

    -- Additional Garmin metrics
    sleep_stress_score INTEGER,
    sleep_hr_avg INTEGER,
    sleep_hr_max INTEGER,

    -- Raw payload for extensibility
    raw_payload JSONB,

    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now(),

    UNIQUE(connection_id, sleep_date)
);

CREATE INDEX IF NOT EXISTS idx_garmin_sleep_user_date ON garmin_sleep_data(user_id, sleep_date DESC);
CREATE INDEX IF NOT EXISTS idx_garmin_sleep_connection ON garmin_sleep_data(connection_id);

-- Trigger for updated_at
DROP TRIGGER IF EXISTS garmin_sleep_data_updated_at ON garmin_sleep_data;
CREATE TRIGGER garmin_sleep_data_updated_at
    BEFORE UPDATE ON garmin_sleep_data
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- -----------------------------------------------------------------------------
-- 2. garmin_daily_health_metrics — extended daily metrics (Body Battery, etc.)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS garmin_daily_health_metrics (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL,
    connection_id UUID NOT NULL REFERENCES provider_connections(id),
    metric_date DATE NOT NULL,

    -- Body Battery (detailed)
    body_battery_start INTEGER,
    body_battery_end INTEGER,
    body_battery_peak INTEGER,
    body_battery_low INTEGER,

    -- Stress metrics
    stress_avg INTEGER,
    stress_max INTEGER,
    stress_min INTEGER,

    -- Heart Rate Variability
    hrv_avg INTEGER,
    hrv_min INTEGER,
    hrv_max INTEGER,
    hrv_status TEXT,

    -- Respiration
    respiration_avg_bpm NUMERIC(5,2),
    respiration_min_bpm NUMERIC(5,2),
    respiration_max_bpm NUMERIC(5,2),

    -- Pulse Ox (SpO2)
    spo2_avg NUMERIC(5,2),
    spo2_min NUMERIC(5,2),
    spo2_max NUMERIC(5,2),

    -- Hydration
    hydration_goal_ml INTEGER,
    hydration_intake_ml INTEGER,
    hydration_remaining_ml INTEGER,

    -- Weather (if available from Garmin)
    weather_temp_celsius INTEGER,
    weather_condition TEXT,

    -- Raw payload
    raw_payload JSONB,

    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now(),

    UNIQUE(connection_id, metric_date)
);

CREATE INDEX IF NOT EXISTS idx_garmin_daily_health_user_date ON garmin_daily_health_metrics(user_id, metric_date DESC);
CREATE INDEX IF NOT EXISTS idx_garmin_daily_health_connection ON garmin_daily_health_metrics(connection_id);

-- Trigger for updated_at
DROP TRIGGER IF EXISTS garmin_daily_health_metrics_updated_at ON garmin_daily_health_metrics;
CREATE TRIGGER garmin_daily_health_metrics_updated_at
    BEFORE UPDATE ON garmin_daily_health_metrics
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- -----------------------------------------------------------------------------
-- 3. garmin_daily_steps — daily step count (single row per day, upsert)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS garmin_daily_steps (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL,
    connection_id UUID NOT NULL REFERENCES provider_connections(id),
    step_date DATE NOT NULL,

    -- Step metrics
    total_steps INTEGER NOT NULL DEFAULT 0,
    total_distance_meters NUMERIC(10,2) DEFAULT 0,
    total_calories INTEGER DEFAULT 0,

    -- Movement metrics
    active_minutes INTEGER DEFAULT 0,
    sedentary_minutes INTEGER DEFAULT 0,

    -- Hourly breakdown (stored as JSON for flexibility)
    hourly_steps JSONB,

    -- Raw payload
    raw_payload JSONB,

    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now(),

    UNIQUE(connection_id, step_date)
);

CREATE INDEX IF NOT EXISTS idx_garmin_daily_steps_user_date ON garmin_daily_steps(user_id, step_date DESC);
CREATE INDEX IF NOT EXISTS idx_garmin_daily_steps_connection ON garmin_daily_steps(connection_id);

-- Trigger for updated_at
DROP TRIGGER IF EXISTS garmin_daily_steps_updated_at ON garmin_daily_steps;
CREATE TRIGGER garmin_daily_steps_updated_at
    BEFORE UPDATE ON garmin_daily_steps
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- -----------------------------------------------------------------------------
-- 4. Reload PostgREST schema cache
-- -----------------------------------------------------------------------------
NOTIFY pgrst, 'reload schema';

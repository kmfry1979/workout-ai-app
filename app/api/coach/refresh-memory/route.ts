import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!

export async function POST(req: NextRequest) {
  // Authenticate via Bearer token (user's access token) or service role
  const authHeader = req.headers.get('authorization')
  const userToken = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null

  if (!userToken) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // Use user token to get their ID via the user-scoped client
  const userClient = createClient(supabaseUrl, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    global: { headers: { Authorization: `Bearer ${userToken}` } },
  })
  const { data: { user }, error: authErr } = await userClient.auth.getUser()
  if (authErr || !user) {
    return NextResponse.json({ error: 'Invalid token' }, { status: 401 })
  }

  const userId = user.id
  // Use service role for reading across tables
  const sb = createClient(supabaseUrl, serviceKey)

  const today = new Date().toISOString().split('T')[0]
  const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0]

  // Fetch all data in parallel
  const [
    profileRes,
    latestWeightRes,
    latestHealthRes,
    sleepRes,
    activitiesRes,
    stepsRes,
  ] = await Promise.all([
    sb.from('profiles').select('display_name,threshold_5k_sec,threshold_10k_sec,race_predictions').eq('id', userId).single(),
    sb.from('garmin_weight_snapshots').select('weight_kg,body_fat_pct,weigh_date').eq('user_id', userId).order('weigh_date', { ascending: false }).limit(1).single(),
    sb.from('garmin_daily_health_metrics').select('hrv_avg,body_battery_end,stress_avg,resting_heart_rate,spo2_avg,respiration_avg,training_readiness,raw_payload').eq('user_id', userId).order('calendar_date', { ascending: false }).limit(1).single(),
    sb.from('garmin_sleep_data').select('sleep_score,total_sleep_seconds,deep_sleep_seconds,rem_sleep_seconds,calendar_date').eq('user_id', userId).order('calendar_date', { ascending: false }).limit(1).single(),
    sb.from('garmin_activities').select('activity_type,duration_sec,distance_meters,avg_hr,start_time_local').eq('user_id', userId).gte('start_time_local', weekAgo).order('start_time_local', { ascending: false }).limit(20),
    sb.from('garmin_daily_steps').select('total_steps,total_distance_meters,active_minutes,calendar_date').eq('user_id', userId).eq('calendar_date', today).single(),
  ])

  const profile = profileRes.data
  const weight = latestWeightRes.data
  const health = latestHealthRes.data
  const sleep = sleepRes.data
  const activities = activitiesRes.data ?? []
  const steps = stepsRes.data

  // Weekly activity stats
  const runTypes = ['running', 'treadmill', 'jogging', 'trail', 'indoor_running', 'track']
  const runs = activities.filter(a =>
    runTypes.some(t => (a.activity_type ?? '').toLowerCase().includes(t))
  )
  const strengthTypes = ['strength', 'fitness', 'weight', 'gym']
  const strengthSessions = activities.filter(a =>
    strengthTypes.some(t => (a.activity_type ?? '').toLowerCase().includes(t))
  )

  const weeklyRunDistanceKm = runs.reduce((sum, r) =>
    sum + (r.distance_meters ? r.distance_meters / 1000 : 0), 0)
  const weeklyRunDurationMin = runs.reduce((sum, r) =>
    sum + (r.duration_sec ? r.duration_sec / 60 : 0), 0)

  const lastRun = runs[0]
  const lastActivity = activities[0]

  // Race predictions
  const rp = profile?.race_predictions as Record<string, number> | null
  const predicted5kSec = profile?.threshold_5k_sec
    ?? rp?.time5K
    ?? null
  const predicted10kSec = profile?.threshold_10k_sec
    ?? rp?.time10K
    ?? null

  const fmtPace = (sec: number | null, distKm: number) => {
    if (!sec) return null
    const paceSecPerKm = sec / distKm
    return `${Math.floor(paceSecPerKm / 60)}:${String(Math.round(paceSecPerKm % 60)).padStart(2, '0')}/km`
  }

  const fmtTime = (sec: number | null) => {
    if (!sec) return null
    const h = Math.floor(sec / 3600)
    const m = Math.floor((sec % 3600) / 60)
    const s = sec % 60
    return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}` : `${m}:${String(s).padStart(2, '0')}`
  }

  // Sleep stats (last night)
  const sleepDurH = sleep?.total_sleep_seconds
    ? Math.round((sleep.total_sleep_seconds / 3600) * 10) / 10
    : null

  // HRV 7-day average from health metrics
  const hrvMultiRes = await sb
    .from('garmin_daily_health_metrics')
    .select('hrv_avg')
    .eq('user_id', userId)
    .gte('calendar_date', weekAgo)
    .not('hrv_avg', 'is', null)
  const hrvValues = (hrvMultiRes.data ?? []).map(r => r.hrv_avg as number)
  const hrv7dayAvg = hrvValues.length > 0
    ? Math.round(hrvValues.reduce((a, b) => a + b, 0) / hrvValues.length)
    : null

  const facts = {
    // Identity
    name: profile?.display_name ?? null,

    // Body
    weight_kg: weight?.weight_kg ?? null,
    weight_date: weight?.weigh_date ?? null,
    body_fat_pct: weight?.body_fat_pct ?? null,

    // Race times
    threshold_5k_sec: predicted5kSec,
    threshold_5k_formatted: fmtTime(predicted5kSec),
    threshold_5k_pace: fmtPace(predicted5kSec, 5),
    threshold_10k_sec: predicted10kSec,
    threshold_10k_formatted: fmtTime(predicted10kSec),

    // Today's vitals
    hrv_today: health?.hrv_avg ?? null,
    hrv_7day_avg: hrv7dayAvg,
    body_battery: health?.body_battery_end ?? null,
    stress_avg: health?.stress_avg ?? null,
    resting_hr: health?.resting_heart_rate ?? null,
    spo2: health?.spo2_avg ?? null,
    training_readiness: health?.training_readiness ?? null,

    // Sleep (last night)
    sleep_score: sleep?.sleep_score ?? null,
    sleep_duration_hours: sleepDurH,
    sleep_date: sleep?.calendar_date ?? null,

    // Steps today
    steps_today: steps?.total_steps ?? null,
    steps_distance_km: steps?.total_distance_meters
      ? Math.round((steps.total_distance_meters / 1000) * 10) / 10
      : null,

    // Weekly training
    weekly_runs: runs.length,
    weekly_run_distance_km: Math.round(weeklyRunDistanceKm * 10) / 10,
    weekly_run_duration_min: Math.round(weeklyRunDurationMin),
    weekly_strength_sessions: strengthSessions.length,
    weekly_total_activities: activities.length,

    // Last run
    last_run_date: lastRun?.start_time_local?.split('T')[0] ?? null,
    last_run_type: lastRun?.activity_type ?? null,
    last_run_distance_km: lastRun?.distance_meters
      ? Math.round((lastRun.distance_meters / 1000) * 10) / 10
      : null,
    last_run_duration_min: lastRun?.duration_sec
      ? Math.round(lastRun.duration_sec / 60)
      : null,
    last_run_avg_hr: lastRun?.avg_hr ?? null,

    // Last activity (any type)
    last_activity_date: lastActivity?.start_time_local?.split('T')[0] ?? null,
    last_activity_type: lastActivity?.activity_type ?? null,

    updated_at: new Date().toISOString(),
  }

  // Upsert into coach_memory
  const { error: upsertErr } = await sb
    .from('coach_memory')
    .upsert({ user_id: userId, facts, updated_at: new Date().toISOString() }, { onConflict: 'user_id' })

  if (upsertErr) {
    console.error('coach_memory upsert error:', upsertErr)
    // Non-fatal — return facts anyway
  }

  return NextResponse.json({ facts })
}

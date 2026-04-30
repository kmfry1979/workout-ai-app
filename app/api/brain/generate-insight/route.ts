import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

const GROQ_API_KEY = process.env.GROQ_API_KEY ?? ''
const GROQ_MODEL = process.env.GROQ_MODEL ?? 'llama-3.3-70b-versatile'
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? ''
// Strip any accidental newlines/extra lines that can sneak in when pasting env vars
const SERVICE_KEY = (process.env.SUPABASE_SERVICE_ROLE_KEY ?? '').split('\n')[0].trim()

// ─── Types ─────────────────────────────────────────────────────────────────────

type BrainInsight = {
  headline: string
  insight: string
  suggested_focus: string
  readiness_score: number
  readiness_label: 'green' | 'amber' | 'red'
}

type HealthRow = {
  metric_date: string
  hrv_avg: number | null
  hrv_status: string | null
  stress_avg: number | null
  body_battery_end: number | null
  respiration_avg_bpm: number | null
  spo2_avg: number | null
  training_readiness_score: number | null
  training_readiness_label: string | null
  training_status_phase: string | null
}

type SleepRow = {
  sleep_date: string
  sleep_score: number | null
  sleep_duration_seconds: number | null
  deep_sleep_seconds: number | null
  rem_sleep_seconds: number | null
}

type StepsRow = {
  step_date: string
  total_steps: number | null
  active_minutes: number | null
  vigorous_intensity_minutes: number | null
}

type ActivityRow = {
  start_time: string
  activity_type: string | null
  duration_sec: number | null
  distance_m: number | null
  avg_hr: number | null
  training_effect: number | null
}

type WeightRow = {
  weigh_date: string
  weight_kg: number
  body_fat_pct: number | null
}

// ─── Prompt builder ────────────────────────────────────────────────────────────

function fmtDur(sec: number | null): string {
  if (sec == null) return '?'
  return `${Math.floor(sec / 3600)}h ${Math.floor((sec % 3600) / 60)}m`
}

function buildPrompt(
  health: HealthRow[],
  sleep: SleepRow[],
  steps: StepsRow[],
  activities: ActivityRow[],
  weights: WeightRow[],
  targetDate: string,
): string {
  const today = health.find(h => h.metric_date === targetDate) ?? health.at(-1)
  const todaySleep = sleep.find(s => s.sleep_date === targetDate) ?? sleep.at(-1)
  const todaySteps = steps.find(s => s.step_date === targetDate) ?? steps.at(-1)

  // 7-day HRV average (excluding today)
  const hrvHistory = health
    .filter(h => h.metric_date !== targetDate && h.hrv_avg != null)
    .map(h => h.hrv_avg!)
  const hrv7Avg = hrvHistory.length > 0
    ? Math.round(hrvHistory.reduce((a, b) => a + b, 0) / hrvHistory.length) : null

  // 7-day sleep average
  const sleepHistory = sleep
    .filter(s => s.sleep_date !== targetDate && s.sleep_duration_seconds != null)
    .map(s => s.sleep_duration_seconds!)
  const sleep7Avg = sleepHistory.length > 0
    ? Math.round(sleepHistory.reduce((a, b) => a + b, 0) / sleepHistory.length) : null

  // Split activities into today's sessions vs recent history
  const todayActivities = activities.filter(a => a.start_time.startsWith(targetDate))
  const recentActs = activities.filter(a => !a.start_time.startsWith(targetDate)).slice(0, 5)

  function fmtActivity(a: ActivityRow): string {
    const parts = [
      a.activity_type?.replace(/_/g, ' ') ?? 'activity',
      fmtDur(a.duration_sec),
      a.distance_m ? `${(a.distance_m / 1000).toFixed(1)}km` : null,
      a.avg_hr ? `${a.avg_hr}bpm` : null,
      a.training_effect ? `TE ${a.training_effect.toFixed(1)}` : null,
    ].filter(Boolean)
    return parts.join(' · ')
  }

  const todayActsText = todayActivities.length > 0
    ? todayActivities.map(a => `- ${fmtActivity(a)}`).join('\n')
    : '— None recorded yet'

  const todayTotalDurMin = todayActivities.reduce((s, a) => s + (a.duration_sec ?? 0), 0) / 60
  const alreadyTrainedHard = todayTotalDurMin >= 30

  const recentActsText = recentActs.map(a => {
    return `- ${new Date(a.start_time).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })}: ${fmtActivity(a)}`
  }).join('\n')

  const latestWeight = weights[0]

  return `You are a personal performance coach speaking directly to Kelvin. Write in second person ("your HRV", "you recovered well") — never third person ("the athlete"). Be direct, warm, and specific. Reference the actual numbers.

## Today's Data (${targetDate})
- HRV: ${today?.hrv_avg ?? '—'}ms ${hrv7Avg ? `(your 7-day avg: ${hrv7Avg}ms, ${today?.hrv_avg && hrv7Avg ? (((today.hrv_avg - hrv7Avg) / hrv7Avg) * 100).toFixed(0) : '?'}% vs your avg)` : ''}
- HRV status: ${today?.hrv_status ?? '—'}
- Body Battery: ${today?.body_battery_end ?? '—'}/100
- Stress avg: ${today?.stress_avg ?? '—'}/100
- Respiration: ${today?.respiration_avg_bpm ?? '—'} brpm
- SpO2: ${today?.spo2_avg ?? '—'}%
- Garmin Training Readiness: ${today?.training_readiness_score ?? '—'}/100 (${today?.training_readiness_label ?? '—'})
- Training Phase: ${today?.training_status_phase?.replace(/_/g, ' ') ?? '—'}

## Sleep
- Last night: score ${todaySleep?.sleep_score ?? '—'}/100, duration ${fmtDur(todaySleep?.sleep_duration_seconds ?? null)}, deep ${fmtDur(todaySleep?.deep_sleep_seconds ?? null)}, REM ${fmtDur(todaySleep?.rem_sleep_seconds ?? null)}
- Your 7-day sleep avg: ${sleep7Avg ? fmtDur(sleep7Avg) : '—'}

## Today's Completed Workouts (IMPORTANT — already done today)
${todayActsText}
${alreadyTrainedHard ? `You have already trained ~${Math.round(todayTotalDurMin)} minutes today across ${todayActivities.length} session(s).` : ''}

## Steps & Activity
- Steps: ${todaySteps?.total_steps?.toLocaleString() ?? '—'}
- Active minutes: ${todaySteps?.active_minutes ?? '—'}

## Recent Workouts (previous days)
${recentActsText || '— No recent activities'}

## Weight
${latestWeight ? `${latestWeight.weight_kg.toFixed(1)} kg${latestWeight.body_fat_pct ? ` · ${latestWeight.body_fat_pct.toFixed(1)}% body fat` : ''} (${latestWeight.weigh_date})` : '— No recent data'}

## Your Task
Generate a personalised JSON response speaking directly to Kelvin in second person. Reference actual numbers. Be specific and actionable.

Rules:
- "green" = good recovery (HRV normal/above avg, good sleep, BB > 60) — cleared for hard training if not already done
- "amber" = moderate recovery (HRV slightly low, ok sleep, BB 35–60) — train but moderate intensity
- "red" = poor recovery (HRV significantly below avg, poor sleep, BB < 35, or multiple warning signs) — rest or easy only
- readiness_score: 0–100 overall readiness based on HRV, sleep, body battery
- headline: one punchy sentence (max 15 words) speaking directly to Kelvin — e.g. "Your recovery is solid today, Kelvin"
- insight: 2–3 sentences in second person referencing actual numbers — e.g. "Your HRV of 37ms is right on your 7-day average..." Never say "the athlete".
- suggested_focus: CRITICAL — if training is already done today, tell Kelvin what to do for THE REST OF THE DAY (recovery, nutrition, mobility). If no training yet, recommend what to do. Always second person.

Return ONLY valid JSON, no markdown fences:
{
  "headline": "...",
  "insight": "...",
  "suggested_focus": "...",
  "readiness_score": 0-100,
  "readiness_label": "green|amber|red"
}`
}

// ─── Route ─────────────────────────────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AdminClient = ReturnType<typeof createClient<any>>

function makeAdmin(): AdminClient {
  return createClient(SUPABASE_URL, SERVICE_KEY)
}

/** Decode a JWT payload without verifying signature — just to inspect the role claim. */
function jwtRole(token: string): string {
  try {
    const payload = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString())
    return payload?.role ?? ''
  } catch {
    return ''
  }
}

export async function POST(req: NextRequest) {
  if (!GROQ_API_KEY) return NextResponse.json({ error: 'GROQ_API_KEY not set' }, { status: 503 })
  if (!SUPABASE_URL || !SERVICE_KEY) return NextResponse.json({ error: 'Supabase not configured' }, { status: 503 })

  const authHeader = req.headers.get('authorization') ?? ''
  const token = authHeader.replace(/^Bearer\s+/i, '').trim()
  if (!token) return NextResponse.json({ error: 'Authorization required' }, { status: 401 })

  const admin = makeAdmin()
  const body = await req.json() as { user_id?: string; date?: string }
  const targetDate = body.date ?? new Date().toISOString().split('T')[0]

  // Service-role path: token is the service key (exact match) OR JWT with role=service_role
  const isServiceRole = (SERVICE_KEY && token === SERVICE_KEY) || jwtRole(token) === 'service_role'

  if (isServiceRole) {
    if (!body.user_id) return NextResponse.json({ error: 'user_id required when calling with service role' }, { status: 400 })
    return generateAndStore(admin, body.user_id, targetDate)
  }

  // User JWT path
  const { data: { user }, error } = await admin.auth.getUser(token)
  if (error || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  return generateAndStore(admin, user.id, targetDate)
}

// Also support GET for client-side fetch of latest insight
export async function GET(req: NextRequest) {
  if (!SUPABASE_URL || !SERVICE_KEY) return NextResponse.json({ error: 'Supabase not configured' }, { status: 503 })

  const authHeader = req.headers.get('authorization') ?? ''
  const token = authHeader.replace(/^Bearer\s+/i, '').trim()
  if (!token) return NextResponse.json({ error: 'Authorization required' }, { status: 401 })

  const admin = makeAdmin()
  const { data: { user }, error } = await admin.auth.getUser(token)
  if (error || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const today = new Date().toISOString().split('T')[0]
  const { data: row } = await admin
    .from('daily_insights')
    .select('insight_date, insight_text, readiness_score, readiness_label, suggested_focus, generated_at')
    .eq('user_id', user.id)
    .gte('insight_date', today)
    .order('insight_date', { ascending: false })
    .limit(1)
    .maybeSingle()

  return NextResponse.json({ insight: row ?? null })
}

async function generateAndStore(
  admin: AdminClient,
  userId: string,
  targetDate: string,
): Promise<NextResponse> {
  // No date-range filter — just get the most recent rows regardless of age.
  // This way the Brain still works even if sync hasn't run for a while.
  const [healthRes, sleepRes, stepsRes, actsRes, weightRes, legacyRes] = await Promise.all([
    admin.from('garmin_daily_health_metrics')
      .select('metric_date, hrv_avg, hrv_status, stress_avg, body_battery_end, respiration_avg_bpm, spo2_avg, training_readiness_score, training_readiness_label, training_status_phase')
      .eq('user_id', userId).order('metric_date', { ascending: false }).limit(30),
    admin.from('garmin_sleep_data')
      .select('sleep_date, sleep_score, sleep_duration_seconds, deep_sleep_seconds, rem_sleep_seconds')
      .eq('user_id', userId).order('sleep_date', { ascending: false }).limit(30),
    admin.from('garmin_daily_steps')
      .select('step_date, total_steps, active_minutes, vigorous_intensity_minutes')
      .eq('user_id', userId).order('step_date', { ascending: false }).limit(7),
    admin.from('garmin_activities')
      .select('start_time, activity_type, duration_sec, distance_m, avg_hr, training_effect')
      .eq('user_id', userId)
      .order('start_time', { ascending: false }).limit(10),
    admin.from('garmin_weight_snapshots')
      .select('weigh_date, weight_kg, body_fat_pct')
      .eq('user_id', userId)
      .order('weigh_date', { ascending: false }).limit(5),
    // Legacy fallback — most recent 30 rows, no date filter
    admin.from('daily_health_metrics')
      .select('metric_date, garmin_hrv_nightly_avg, garmin_body_battery_high, garmin_stress_avg, garmin_sleep_score, steps, resting_hr')
      .eq('user_id', userId).order('metric_date', { ascending: false }).limit(30),
  ])

  // Rows came back in descending order; re-sort ascending for trend analysis
  let health = ((healthRes.data ?? []) as HealthRow[]).reverse()
  const sleep = ((sleepRes.data ?? []) as SleepRow[]).reverse()
  const stepsData = ((stepsRes.data ?? []) as StepsRow[]).reverse()
  const activities = (actsRes.data ?? []) as ActivityRow[]   // keep descending (newest first)
  const weights = (weightRes.data ?? []) as WeightRow[]      // keep descending (newest first)

  // If the new garmin_daily_health_metrics table is empty, map legacy rows into the same shape
  if (health.length === 0) {
    type LegacyRow = {
      metric_date: string
      garmin_hrv_nightly_avg: number | null
      garmin_body_battery_high: number | null
      garmin_stress_avg: number | null
      garmin_sleep_score: number | null
      steps: number | null
      resting_hr: number | null
    }
    health = ((legacyRes.data ?? []) as LegacyRow[]).reverse().map(r => ({
      metric_date: r.metric_date,
      hrv_avg: r.garmin_hrv_nightly_avg,
      hrv_status: null,
      stress_avg: r.garmin_stress_avg,
      body_battery_end: r.garmin_body_battery_high,
      respiration_avg_bpm: null,
      spo2_avg: null,
      training_readiness_score: null,
      training_readiness_label: null,
      training_status_phase: null,
    }))
  }

  const debugInfo = {
    user_id: userId,
    target_date: targetDate,
    garmin_health_rows: health.length,
    legacy_health_rows: (legacyRes.data ?? []).length,
    sleep_rows: sleep.length,
    activity_rows: activities.length,
    weight_rows: weights.length,
    garmin_health_error: healthRes.error ? `${healthRes.error.code}: ${healthRes.error.message}` : null,
    legacy_health_error: legacyRes.error ? `${legacyRes.error.code}: ${legacyRes.error.message}` : null,
    sleep_error: sleepRes.error ? `${sleepRes.error.code}: ${sleepRes.error.message}` : null,
    activity_error: actsRes.error ? `${actsRes.error.code}: ${actsRes.error.message}` : null,
    weight_error: weightRes.error ? `${weightRes.error.code}: ${weightRes.error.message}` : null,
  }
  console.log('Brain debug', JSON.stringify(debugInfo))

  if (health.length === 0 && sleep.length === 0 && activities.length === 0) {
    return NextResponse.json({
      error: 'No data available to analyse',
      debug: debugInfo,
    }, { status: 422 })
  }

  const prompt = buildPrompt(health, sleep, stepsData, activities, weights, targetDate)

  // Call Groq
  let groqRes: Response
  try {
    groqRes = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${GROQ_API_KEY}` },
      body: JSON.stringify({
        model: GROQ_MODEL,
        messages: [
          { role: 'system', content: 'You are a sports science AI. Always respond with valid JSON only — no markdown, no explanation, just the JSON object.' },
          { role: 'user', content: prompt },
        ],
        temperature: 0.4,
        max_tokens: 400,
      }),
    })
  } catch (e: unknown) {
    return NextResponse.json({ error: `Cannot reach Groq: ${e instanceof Error ? e.message : e}` }, { status: 503 })
  }

  if (!groqRes.ok) {
    const text = await groqRes.text()
    return NextResponse.json({ error: `Groq ${groqRes.status}: ${text}` }, { status: 502 })
  }

  const groqData = await groqRes.json() as { choices?: { message?: { content?: string } }[] }
  const raw = groqData.choices?.[0]?.message?.content?.trim() ?? ''

  let parsed: BrainInsight
  try {
    // Strip markdown fences if model wraps anyway
    const clean = raw.replace(/^```json?\s*/i, '').replace(/```\s*$/i, '').trim()
    parsed = JSON.parse(clean) as BrainInsight
  } catch {
    return NextResponse.json({ error: 'Could not parse Groq response', raw }, { status: 502 })
  }

  // Upsert into daily_insights
  const { error: upsertErr } = await admin.from('daily_insights').upsert({
    user_id: userId,
    insight_date: targetDate,
    insight_text: parsed.insight,
    readiness_score: parsed.readiness_score,
    readiness_label: parsed.readiness_label,
    suggested_focus: parsed.suggested_focus,
    generated_at: new Date().toISOString(),
    raw_context: {
      health_rows: health.length,
      sleep_rows: sleep.length,
      activity_rows: activities.length,
      headline: parsed.headline,
    },
  }, { onConflict: 'user_id,insight_date' })

  if (upsertErr) {
    console.error('Brain upsert error:', upsertErr)
  }

  return NextResponse.json({
    headline: parsed.headline,
    insight: parsed.insight,
    suggested_focus: parsed.suggested_focus,
    readiness_score: parsed.readiness_score,
    readiness_label: parsed.readiness_label,
    insight_date: targetDate,
  })
}

import { NextRequest, NextResponse } from 'next/server'

const GROQ_API_KEY = process.env.GROQ_API_KEY ?? ''
const GROQ_MODEL = process.env.GROQ_MODEL ?? 'llama-3.3-70b-versatile'

function fmtDur(sec: number | null | undefined): string {
  if (sec == null || sec <= 0) return '—'
  const h = Math.floor(sec / 3600)
  const m = Math.floor((sec % 3600) / 60)
  return h > 0 ? `${h}h ${m}m` : `${m}m`
}

async function callGroq(prompt: string): Promise<string> {
  const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${GROQ_API_KEY}` },
    body: JSON.stringify({
      model: GROQ_MODEL,
      messages: [
        { role: 'system', content: 'You are a warm, positive personal coach AI. Always respond with valid JSON only — no markdown fences, no explanation.' },
        { role: 'user', content: prompt },
      ],
      temperature: 0.65,
      max_tokens: 550,
    }),
  })
  if (!res.ok) throw new Error(`Groq ${res.status}`)
  const data = await res.json() as { choices?: { message?: { content?: string } }[] }
  const raw = data.choices?.[0]?.message?.content?.trim() ?? '{}'
  return raw.replace(/^```json?\s*/i, '').replace(/```\s*$/i, '').trim()
}

type MorningCheckin = {
  feeling_score?: number | null
  body_ache_areas?: string[]
  night_wakings?: number | null
  sleep_rating?: number | null
  energy_level?: number | null
  stress_level?: number | null
  motivation_level?: number | null
}

type EveningCheckin = {
  feeling_score?: number | null
  workout_status?: number | null
  nutrition_score?: number | null
  stress_level?: number | null
  energy_level?: number | null
  motivation_level?: number | null
}

type SleepCtx = {
  sleep_score?: number | null
  sleep_duration_seconds?: number | null
  deep_sleep_seconds?: number | null
  rem_sleep_seconds?: number | null
  light_sleep_seconds?: number | null
}

type HealthCtx = {
  hrv_avg?: number | null
  body_battery_end?: number | null
  stress_avg?: number | null
  steps?: number | null
}

type ActivityCtx = {
  activity_type?: string | null
  duration_sec?: number | null
  calories?: number | null
}

const FEELING_M   = ['—', 'Drained', 'Tired', 'OK', 'Good', 'Great']
const FEELING_E   = ['—', 'Rough', 'Hard', 'OK', 'Good', 'Great']
const ENERGY      = ['—', 'Empty/Drained', 'Low', 'OK', 'Good', 'High/Charged']
const STRESS      = ['—', 'Calm', 'Low', 'Moderate', 'High', 'Very high']
const SLEEP_Q     = ['—', 'Terrible', 'Poor', 'OK', 'Good', 'Great']
const MOTIVATION  = ['—', 'Rest day vibes', 'Not really', 'Maybe', 'Yes', 'Fired up']
const WORKOUT_ST  = ['Rest day', 'Completed', 'Modified', 'Skipped', 'Bonus session']
const NUTRITION   = ['—', 'Poor', 'Fair', 'OK', 'Good', 'On point']
const TOMORROW    = ['—', 'Need rest', 'Tired', 'OK', 'Ready', 'Bring it']

function pick<T>(arr: T[], idx: number | null | undefined): T { return arr[idx ?? 0] ?? arr[0] }

export async function POST(req: NextRequest) {
  if (!GROQ_API_KEY) return NextResponse.json({ error: 'GROQ_API_KEY not set' }, { status: 503 })

  const body = await req.json() as {
    type: 'morning' | 'evening'
    checkin: MorningCheckin | EveningCheckin
    sleep?: SleepCtx | null
    health?: HealthCtx | null
    activities?: ActivityCtx[]
    morning_checkin?: MorningCheckin | null
  }

  const { type, checkin, sleep, health, activities = [], morning_checkin } = body

  // ── Morning summary ──────────────────────────────────────────────────────────
  if (type === 'morning') {
    const c = checkin as MorningCheckin
    const aches = c.body_ache_areas?.filter(a => a !== 'none').join(', ') || 'None'

    const prompt = `You are a warm, positive personal coach generating a personalised morning summary for an athlete. Be specific with numbers. Always encouraging.

## Morning Check-in
- Overall feeling: ${pick(FEELING_M, c.feeling_score)}
- Body aches: ${aches}
- Night wakings: ${c.night_wakings ?? '—'}
- Sleep felt: ${pick(SLEEP_Q, c.sleep_rating)}
- Energy level: ${pick(ENERGY, c.energy_level)}
- Stress level: ${pick(STRESS, c.stress_level)}
- Motivation to train: ${pick(MOTIVATION, c.motivation_level)}

## Garmin Sleep Data
- Sleep score: ${sleep?.sleep_score ?? '—'}/100
- Total duration: ${fmtDur(sleep?.sleep_duration_seconds)}
- Deep sleep: ${fmtDur(sleep?.deep_sleep_seconds)}
- REM sleep: ${fmtDur(sleep?.rem_sleep_seconds)}
- Light sleep: ${fmtDur(sleep?.light_sleep_seconds)}
- Overnight HRV: ${health?.hrv_avg ?? '—'}ms
- Body battery now: ${health?.body_battery_end ?? '—'}/100

## Your Task
Write an uplifting personalised morning summary. Reference actual numbers. Find the positives in the data.

Return ONLY valid JSON (no markdown):
{
  "headline": "One punchy sentence (max 12 words) about how their night went",
  "sleep_overview": "2-3 sentences analysing sleep quality with the actual numbers. Highlight positives. If sleep was poor, acknowledge it but frame what their body achieved anyway.",
  "recommended_activity": "One specific activity recommendation for today based on their energy, motivation, and any aches. If they're on a rest day, enthusiastically recommend active recovery and list its benefits.",
  "quote": "A short original motivational quote tailored to their morning mood. Warm and personal, not generic."
}`

    try {
      const raw = await callGroq(prompt)
      const parsed = JSON.parse(raw)
      return NextResponse.json(parsed)
    } catch {
      return NextResponse.json({ error: 'Failed to generate morning summary' }, { status: 502 })
    }
  }

  // ── Evening summary ───────────────────────────────────────────────────────────
  if (type === 'evening') {
    const c = checkin as EveningCheckin
    const mc = morning_checkin as MorningCheckin | null | undefined

    const actLines = activities.length > 0
      ? activities.map(a => {
          const t = a.activity_type?.replace(/_/g, ' ') ?? 'activity'
          const dur = a.duration_sec ? `${Math.round(a.duration_sec / 60)} min` : ''
          const cal = a.calories ? `${Math.round(a.calories)} cal` : ''
          return `• ${t}: ${[dur, cal].filter(Boolean).join(', ')}`
        }).join('\n')
      : '• Rest day — no recorded workouts'

    const prompt = `You are a warm, positive personal coach generating a celebratory end-of-day summary. ALWAYS find positives — rest is a win, nutrition is a win, getting through a hard day is a win. Never be negative.

## Evening Check-in
- How was the day: ${pick(FEELING_E, c.feeling_score)}
- Workout: ${WORKOUT_ST[c.workout_status ?? -1] ?? '—'}
- Nutrition: ${pick(NUTRITION, c.nutrition_score)}
- Stress today: ${pick(STRESS, c.stress_level)}
- Energy during day: ${pick(ENERGY, c.energy_level)}
- Ready for tomorrow: ${pick(TOMORROW, c.motivation_level)}

## Morning Check-in (this morning)
- Felt this morning: ${mc ? pick(FEELING_M, mc.feeling_score) : '—'}
- Morning energy: ${mc ? pick(ENERGY, mc.energy_level) : '—'}
- Morning stress: ${mc ? pick(STRESS, mc.stress_level) : '—'}

## Today's Activities
${actLines}

## Health Metrics Today
- HRV: ${health?.hrv_avg ?? '—'}ms
- Body Battery: ${health?.body_battery_end ?? '—'}/100
- Avg stress: ${health?.stress_avg ?? '—'}/100
- Steps: ${health?.steps != null ? health.steps.toLocaleString() : '—'}

## Sleep Recommendation
Base your recommended sleep hours on: today's activity level, current body battery (${health?.body_battery_end ?? '—'}/100), stress level, and how ready they feel for tomorrow.

## Your Task
Generate a warm, celebratory day summary. Specific data references. Every section must be positive in framing.

Return ONLY valid JSON (no markdown):
{
  "headline": "One celebratory sentence (max 12 words) summing up their day",
  "day_summary": "2-3 sentences covering what was accomplished. Positive framing always. Reference actual activities or steps or health data.",
  "highlights": "3 specific highlights/wins from today as bullet points. Use • symbol. Include recovery, nutrition, activity, or mindset wins. Even small things count.",
  "sleep_recommendation": "1-2 sentences on how much sleep they need tonight and exactly why based on their data.",
  "recommended_sleep_hours": 8
}`

    try {
      const raw = await callGroq(prompt)
      const parsed = JSON.parse(raw)
      return NextResponse.json(parsed)
    } catch {
      return NextResponse.json({ error: 'Failed to generate evening summary' }, { status: 502 })
    }
  }

  return NextResponse.json({ error: 'Unknown type' }, { status: 400 })
}

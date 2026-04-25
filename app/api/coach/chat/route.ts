import { NextRequest, NextResponse } from 'next/server'

const GROQ_API_KEY = process.env.GROQ_API_KEY
const GROQ_MODEL = process.env.GROQ_MODEL ?? 'llama-3.3-70b-versatile'

type Message = { role: 'user' | 'assistant'; content: string }

type MetricsContext = {
  hrv: number | null
  hrvStatus: string | null
  sleepScore: number | null
  sleepDurationSeconds: number | null
  deepSleepSeconds: number | null
  remSleepSeconds: number | null
  bodyBattery: number | null
  stress: number | null
  restingHr: number | null
  respiration: number | null
  spo2: number | null
  steps: number | null
  activeMinutes: number | null
  moderateIntensityMinutes: number | null
  vigorousIntensityMinutes: number | null
  date: string
}

type TreadmillSegment = {
  start_min: number
  end_min: number
  incline_pct: number | null
  speed_kmh: number | null
  description: string
}

type ActivityContext = {
  type: string
  name: string
  date: string
  durationMin: number | null
  distanceKm: number | null
  avgHr: number | null
  calories: number | null
  trainingEffect: number | null
  treadmillSegments: TreadmillSegment[] | null
  notes: string | null
}

function buildSystemPrompt(metrics: MetricsContext | null, activities: ActivityContext[]): string {
  const today = new Date().toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' })

  let metricsSection = 'No health metrics available for today.'
  if (metrics) {
    const sleepDur = metrics.sleepDurationSeconds != null
      ? `${Math.floor(metrics.sleepDurationSeconds / 3600)}h ${Math.floor((metrics.sleepDurationSeconds % 3600) / 60)}m` : null
    const deepPct = metrics.deepSleepSeconds != null && metrics.sleepDurationSeconds != null && metrics.sleepDurationSeconds > 0
      ? `${Math.round((metrics.deepSleepSeconds / metrics.sleepDurationSeconds) * 100)}%` : null
    const remPct = metrics.remSleepSeconds != null && metrics.sleepDurationSeconds != null && metrics.sleepDurationSeconds > 0
      ? `${Math.round((metrics.remSleepSeconds / metrics.sleepDurationSeconds) * 100)}%` : null
    const intensityMin = metrics.moderateIntensityMinutes != null || metrics.vigorousIntensityMinutes != null
      ? (metrics.moderateIntensityMinutes ?? 0) + (metrics.vigorousIntensityMinutes ?? 0) * 2 : metrics.activeMinutes
    const lines = [
      metrics.hrv != null ? `- HRV: ${metrics.hrv}ms${metrics.hrvStatus ? ` (${metrics.hrvStatus})` : ''}` : null,
      metrics.sleepScore != null ? `- Sleep score: ${metrics.sleepScore}/100${sleepDur ? ` · ${sleepDur}` : ''}` : null,
      deepPct ? `- Deep sleep: ${deepPct}${remPct ? ` · REM: ${remPct}` : ''}` : null,
      metrics.bodyBattery != null ? `- Body Battery: ${metrics.bodyBattery}/100` : null,
      metrics.restingHr != null ? `- Resting HR: ${metrics.restingHr} bpm` : null,
      metrics.stress != null ? `- Avg stress: ${metrics.stress}/100` : null,
      metrics.respiration != null ? `- Respiration: ${metrics.respiration.toFixed(1)} brpm` : null,
      metrics.spo2 != null ? `- SpO2: ${metrics.spo2}%` : null,
      metrics.steps != null ? `- Steps today: ${metrics.steps.toLocaleString()}` : null,
      intensityMin != null ? `- Intensity load today: ${Math.round(intensityMin)} min` : null,
    ].filter(Boolean)
    metricsSection = lines.length > 0 ? lines.join('\n') : 'Metrics synced but values are empty.'
  }

  const recentSection = activities.length > 0
    ? activities.slice(0, 7).map(a => {
        const parts = [
          a.name || a.type,
          a.date,
          a.durationMin ? `${a.durationMin}min` : null,
          a.distanceKm ? `${a.distanceKm}km` : null,
          a.avgHr ? `${a.avgHr}bpm avg HR` : null,
          a.trainingEffect ? `TE ${a.trainingEffect.toFixed(1)}` : null,
        ].filter(Boolean)
        let line = `- ${parts.join(' · ')}`
        if (a.treadmillSegments && a.treadmillSegments.length > 0) {
          const segStr = a.treadmillSegments.map(s => {
            const inc = s.incline_pct != null ? (s.incline_pct === 0 ? 'flat' : `${s.incline_pct}% incline`) : ''
            const spd = s.speed_kmh != null ? `${s.speed_kmh}km/h` : ''
            return `${s.start_min}–${s.end_min}min: ${[inc, spd].filter(Boolean).join(', ') || s.description}`
          }).join(' | ')
          line += `\n  Treadmill segments: ${segStr}`
        }
        if (a.notes) line += `\n  Notes: ${a.notes}`
        return line
      }).join('\n')
    : 'No recent activities recorded.'

  return `You are an expert personal fitness coach and sports scientist. Today is ${today}.

## Athlete's Current Stats

${metricsSection}

## Recent Activities (last 7 days)

${recentSection}

## Your Role

Use the athlete's data above to give personalised, data-driven coaching advice. When they ask what to do today, consider:
- HRV below 50ms or dropping trend = prioritise recovery
- Body Battery below 40 = rest or light activity only
- Sleep score below 60 = low intensity day
- High stress + low body battery = active recovery (walk, yoga)
- Good HRV + high body battery = good day for hard training

Be conversational, encouraging, and specific. Reference their actual numbers. Keep responses concise (2-4 sentences unless they ask for more detail). Don't use excessive bullet points — talk like a real coach.`
}

export async function POST(req: NextRequest) {
  if (!GROQ_API_KEY) {
    return NextResponse.json({ error: 'GROQ_API_KEY not configured' }, { status: 503 })
  }

  let body: {
    messages: Message[]
    metrics: MetricsContext | null
    activities: ActivityContext[]
  }

  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
  }

  const { messages, metrics, activities } = body
  const systemPrompt = buildSystemPrompt(metrics ?? null, activities ?? [])

  let res: Response
  try {
    res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${GROQ_API_KEY}`,
      },
      body: JSON.stringify({
        model: GROQ_MODEL,
        messages: [
          { role: 'system', content: systemPrompt },
          ...messages,
        ],
        temperature: 0.75,
        max_tokens: 600,
      }),
    })
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e)
    return NextResponse.json({ error: `Cannot reach Groq: ${msg}` }, { status: 503 })
  }

  if (!res.ok) {
    const text = await res.text()
    return NextResponse.json({ error: `Groq error ${res.status}: ${text}` }, { status: 502 })
  }

  const data = await res.json() as { choices?: { message?: { content?: string } }[] }
  const reply = data.choices?.[0]?.message?.content

  if (!reply) return NextResponse.json({ error: 'No response from Groq' }, { status: 502 })

  return NextResponse.json({ reply: reply.trim() })
}

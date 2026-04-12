import { NextRequest, NextResponse } from 'next/server'

const GROQ_API_KEY = process.env.GROQ_API_KEY
const GROQ_MODEL = process.env.GROQ_MODEL ?? 'llama-3.3-70b-versatile'

type Message = { role: 'user' | 'assistant'; content: string }

type MetricsContext = {
  hrv: number | null
  sleepScore: number | null
  sleepMinutes: number | null
  bodyBattery: number | null
  stress: number | null
  restingHr: number | null
  steps: number | null
  date: string
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
}

function buildSystemPrompt(metrics: MetricsContext | null, activities: ActivityContext[]): string {
  const today = new Date().toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' })

  let metricsSection = 'No health metrics available for today.'
  if (metrics) {
    const lines = [
      metrics.hrv != null ? `- HRV (nightly avg): ${metrics.hrv} ms` : null,
      metrics.sleepScore != null ? `- Sleep score: ${metrics.sleepScore}/100` : null,
      metrics.sleepMinutes != null ? `- Sleep duration: ${Math.floor(metrics.sleepMinutes / 60)}h ${metrics.sleepMinutes % 60}m` : null,
      metrics.bodyBattery != null ? `- Body Battery: ${metrics.bodyBattery}/100` : null,
      metrics.stress != null ? `- Avg stress: ${metrics.stress}/100` : null,
      metrics.restingHr != null ? `- Resting HR: ${metrics.restingHr} bpm` : null,
      metrics.steps != null ? `- Steps today: ${metrics.steps.toLocaleString()}` : null,
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
        return `- ${parts.join(' · ')}`
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

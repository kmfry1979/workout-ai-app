import { NextRequest, NextResponse } from 'next/server'

const GROQ_API_KEY = process.env.GROQ_API_KEY
const GROQ_MODEL = process.env.GROQ_MODEL ?? 'llama-3.3-70b-versatile'

type PlanDay = {
  day: string
  session: string
  detail: string
  intensity: 'rest' | 'low' | 'moderate' | 'high'
}

type WeeklyPlanRequest = {
  acwr: number | null
  hrvTrend: number | null          // % change last 7 vs prior 7
  recovery: number | null
  strain: number
  bodyBattery: number | null
  recentActivities: {
    type: string
    durationMin: number | null
    date: string
  }[]
}

function buildWeeklyPlanPrompt(body: WeeklyPlanRequest): string {
  const { acwr, hrvTrend, recovery, strain, bodyBattery, recentActivities } = body

  const todayDow = new Date().getDay() // 0=Sun
  const monday = new Date()
  const daysUntilMonday = (8 - todayDow) % 7 || 7
  monday.setDate(monday.getDate() + (todayDow === 1 ? 0 : daysUntilMonday === 7 ? 0 : daysUntilMonday))
  const weekStart = monday.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })

  const actSection = recentActivities.slice(0, 7).map(a =>
    `- ${a.type}${a.durationMin ? ` ${a.durationMin}min` : ''} on ${a.date}`
  ).join('\n') || 'No recent activities'

  const signals = [
    acwr != null ? `ACWR: ${acwr.toFixed(2)} (${acwr > 1.3 ? 'high load — ease back' : acwr < 0.8 ? 'low load — can build' : 'optimal zone'})` : null,
    hrvTrend != null ? `HRV trend: ${hrvTrend > 0 ? '+' : ''}${hrvTrend.toFixed(0)}% vs prior week (${hrvTrend > 5 ? 'improving' : hrvTrend < -5 ? 'declining — watch fatigue' : 'stable'})` : null,
    recovery != null ? `Morning recovery: ${Math.round(recovery)}%` : null,
    bodyBattery != null ? `Body battery: ${bodyBattery}/100` : null,
    `Today's strain: ${strain.toFixed(1)}/21`,
  ].filter(Boolean).join('\n')

  return `You are an expert endurance coach. Generate a personalised 7-day training plan starting Monday ${weekStart}.

## Athlete Signals
${signals}

## Recent Training
${actSection}

## Rules
- Balance hard days with easy/rest days. Never more than 2 hard days in a row.
- If ACWR > 1.3, include extra rest or easy days to reduce fatigue risk.
- If HRV trend is declining, favour recovery sessions over hard efforts.
- Sessions must be specific (e.g. "30-40 min easy run at conversational pace" not just "easy run").
- Intensity levels: rest = complete rest, low = easy aerobic/mobility/walk, moderate = steady-state cardio, high = intervals/threshold/hard effort.

IMPORTANT: Respond with ONLY a valid JSON array. No explanation, no markdown, no code blocks — just the raw JSON array. Example format:
[{"day":"Mon","session":"Easy Run","detail":"30-40 min at conversational pace, keep HR in Z2","intensity":"low"},{"day":"Tue","session":"Rest","detail":"Full rest or light stretching","intensity":"rest"}]

Generate all 7 days (Mon through Sun) in that JSON format.`
}

export async function POST(req: NextRequest) {
  if (!GROQ_API_KEY) {
    return NextResponse.json({ error: 'GROQ_API_KEY not configured' }, { status: 503 })
  }

  let body: WeeklyPlanRequest
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
  }

  const prompt = buildWeeklyPlanPrompt(body)

  let res: Response
  try {
    res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${GROQ_API_KEY}`,
      },
      body: JSON.stringify({
        model: GROQ_MODEL,
        messages: [
          { role: 'system', content: 'You are a JSON-only response bot. Output ONLY valid JSON arrays, nothing else.' },
          { role: 'user', content: prompt },
        ],
        temperature: 0.5,
        max_tokens: 700,
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
  const raw = data.choices?.[0]?.message?.content?.trim()
  if (!raw) return NextResponse.json({ error: 'No response from Groq' }, { status: 502 })

  // Extract JSON array from response (in case model adds any wrapper text)
  const jsonMatch = raw.match(/\[[\s\S]*\]/)
  if (!jsonMatch) return NextResponse.json({ error: 'Could not parse plan from AI response' }, { status: 502 })

  let days: PlanDay[]
  try {
    days = JSON.parse(jsonMatch[0]) as PlanDay[]
  } catch {
    return NextResponse.json({ error: 'Invalid JSON in AI response' }, { status: 502 })
  }

  // Validate structure
  if (!Array.isArray(days) || days.length < 7) {
    return NextResponse.json({ error: 'Incomplete plan from AI' }, { status: 502 })
  }

  return NextResponse.json({
    days: days.slice(0, 7),
    generated_at: new Date().toISOString(),
    week_start: (() => {
      const d = new Date()
      const dow = d.getDay()
      const diff = dow === 1 ? 0 : dow === 0 ? -6 : 1 - dow
      d.setDate(d.getDate() + diff)
      return d.toISOString().split('T')[0]
    })(),
  })
}

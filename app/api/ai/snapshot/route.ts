import { NextRequest, NextResponse } from 'next/server'

const GROQ_API_KEY = process.env.GROQ_API_KEY
const GROQ_MODEL = process.env.GROQ_MODEL ?? 'llama-3.3-70b-versatile'

type HealthEngineRequest = {
  mode: 'health-engine'
  recovery: number | null
  strain: number | null
  hrv: number | null
  sleepScore: number | null
  respiration: number | null
  respirationBaseline: number | null
  hour: number
}

type SnapshotRequest = {
  metrics: {
    hrv: number | null
    hrvStatus: string | null
    sleepScore: number | null
    sleepDurationSeconds: number | null
    deepSeconds: number | null
    remSeconds: number | null
    bodyBatteryHigh: number | null
    bodyBatteryLow: number | null
    bodyBatteryEnd: number | null
    stressAvg: number | null
    stressMax: number | null
    restingHr: number | null
    steps: number | null
    stepGoal: number | null
    spo2: number | null
    respirationAwake: number | null
    respirationSleep: number | null
    intensityMinutes: number | null
    intensityGoal: number | null
    readinessScore: number | null
    readinessLabel: string | null
    date: string
    localHour?: number | null
  }
  activities: {
    type: string
    durationMin: number | null
    distanceKm: number | null
    avgHr: number | null
    calories: number | null
    trainingEffect: number | null
    date: string
  }[]
}

function buildPrompt(body: SnapshotRequest): string {
  const { metrics: m, activities } = body
  const today = new Date(m.date).toLocaleDateString('en-GB', {
    weekday: 'long', day: 'numeric', month: 'long',
  })

  const hour = typeof m.localHour === 'number' ? m.localHour : new Date().getHours()
  const timeOfDay =
    hour < 11 ? 'morning' :
    hour < 14 ? 'midday' :
    hour < 17 ? 'afternoon' :
    hour < 20 ? 'early evening' :
    'late evening'

  // Did the athlete already train today?
  const todayStr = new Date(m.date).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })
  const trainedToday = activities.some(a => a.date === todayStr && (a.durationMin ?? 0) > 0)

  const lines: string[] = []

  // Readiness
  if (m.readinessScore != null)
    lines.push(`- Overall readiness: ${m.readinessScore}/100 (${m.readinessLabel ?? 'unknown'})`)

  // Body battery
  if (m.bodyBatteryHigh != null || m.bodyBatteryEnd != null)
    lines.push(`- Body Battery: peak ${m.bodyBatteryHigh ?? '?'}, current/end-of-day ${m.bodyBatteryEnd ?? '?'}, low ${m.bodyBatteryLow ?? '?'}`)

  // HRV
  if (m.hrv != null)
    lines.push(`- HRV last night: ${m.hrv}ms — status: ${m.hrvStatus ?? 'unknown'}`)

  // Sleep
  if (m.sleepScore != null || m.sleepDurationSeconds != null) {
    const durH = m.sleepDurationSeconds ? Math.floor(m.sleepDurationSeconds / 3600) : null
    const durM = m.sleepDurationSeconds ? Math.floor((m.sleepDurationSeconds % 3600) / 60) : null
    const durStr = durH != null ? `${durH}h ${durM}m` : 'unknown duration'
    lines.push(`- Sleep: score ${m.sleepScore ?? 'n/a'}, duration ${durStr}`)
    if (m.deepSeconds != null || m.remSeconds != null)
      lines.push(`  Deep sleep: ${m.deepSeconds != null ? Math.round(m.deepSeconds / 60) + 'm' : '?'}, REM: ${m.remSeconds != null ? Math.round(m.remSeconds / 60) + 'm' : '?'}`)
  }

  // Stress
  if (m.stressAvg != null)
    lines.push(`- Avg stress: ${m.stressAvg}${m.stressMax != null ? `, max ${m.stressMax}` : ''}`)

  // Resting HR
  if (m.restingHr != null)
    lines.push(`- Resting heart rate: ${m.restingHr} bpm`)

  // SpO2 / Respiration
  if (m.spo2 != null)
    lines.push(`- SpO2: ${m.spo2}%`)
  if (m.respirationAwake != null || m.respirationSleep != null)
    lines.push(`- Respiration: awake ${m.respirationAwake ?? '?'} brpm, sleep ${m.respirationSleep ?? '?'} brpm`)

  // Steps
  if (m.steps != null)
    lines.push(`- Steps: ${m.steps.toLocaleString()}${m.stepGoal ? ` / ${m.stepGoal.toLocaleString()} goal` : ''}`)

  // Intensity minutes
  if (m.intensityMinutes != null)
    lines.push(`- Intensity minutes: ${m.intensityMinutes}${m.intensityGoal ? ` / ${m.intensityGoal} goal` : ''}`)

  const metricsSection = lines.length > 0 ? lines.join('\n') : 'No metrics available.'

  const actSection = activities.length > 0
    ? activities.slice(0, 7).map(a => {
        const parts = [
          a.type,
          a.date,
          a.durationMin ? `${a.durationMin}min` : null,
          a.distanceKm ? `${a.distanceKm.toFixed(1)}km` : null,
          a.avgHr ? `${a.avgHr}bpm` : null,
          a.trainingEffect ? `TE ${a.trainingEffect.toFixed(1)}` : null,
        ].filter(Boolean)
        return `- ${parts.join(' · ')}`
      }).join('\n')
    : 'No recent activities.'

  const contextLine = `It is the ${timeOfDay} (local hour ${hour}:00). ${
    trainedToday
      ? 'The athlete has already completed at least one activity today.'
      : 'No activity has been logged yet today.'
  }`

  // Recommendation framing changes by time of day. After ~18:00 it's too late
  // to prescribe a hard session — validate rest if it fits and pivot to
  // tomorrow's plan + a light evening option.
  const recommendationGuidance =
    hour >= 18
      ? `
**Tonight & Tomorrow**
It is the ${timeOfDay}, so don't prescribe a hard workout for today.
- If no training happened and recovery signals are only moderate, explicitly validate rest: a well-timed rest day supports adaptation. Say so plainly.
- Suggest ONE gentle evening option the athlete can do now if they want movement: a 15–20 min easy walk, mobility/stretching, or breath-work for sleep.
- Then prescribe the main session FOR TOMORROW — pick ONE of: full rest, active recovery, easy aerobic, moderate run/cycle, tempo/threshold, intervals, or strength. Be specific ("tomorrow: 30–40 min easy run at conversational pace" or "tomorrow: 5x800m at 5k pace, 90s rest").`
      : `
**Today's Recommendation**
Pick ONE of: full rest, active recovery (light walk/yoga), easy aerobic, moderate run/cycle, tempo/threshold, intervals, or strength. State which and why with numbers. Give a specific session (e.g. "30–40 min easy run at conversational pace" or "5x800m intervals with 90s rest").${
          trainedToday
            ? ' The athlete already trained today, so frame this as "for the rest of the day" — likely recovery, mobility, or hydration/fuel focus rather than another hard session.'
            : ''
        }`

  return `You are an expert sports scientist giving a daily training snapshot. Today is ${today}. ${contextLine}

## Today's Metrics
${metricsSection}

## Recent Activities (last 7 days)
${actSection}

## Instructions
Analyse the data and respond in EXACTLY this format (including the bold section headers):

**Current Status**
One sentence on overall recovery and readiness today, referencing actual numbers.

**Key Signals**
• [Most important positive or negative signal with the number]
• [Second most important signal with the number]
• [Third signal if relevant, or omit]
${recommendationGuidance}

**Watch Out For**
One sentence risk or focus area.

Be direct, warm, and non-preachy. Reference specific numbers. Never prescribe a hard workout later than the current time of day. Total response under 240 words.`
}

function buildHealthEnginePrompt(body: HealthEngineRequest): string {
  const { recovery, strain, hrv, sleepScore, respiration, respirationBaseline, hour } = body
  const timeLabel = hour < 12 ? 'morning' : hour < 17 ? 'afternoon' : 'evening'
  const lines = [
    recovery != null ? `Recovery score: ${Math.round(recovery)}/100` : null,
    strain != null ? `Strain score: ${strain.toFixed(1)}/21` : null,
    hrv != null ? `HRV: ${hrv}ms` : null,
    sleepScore != null ? `Sleep score: ${sleepScore}/100` : null,
    respiration != null ? `Respiration: ${respiration} brpm${respirationBaseline ? ` (baseline ${respirationBaseline.toFixed(1)})` : ''}` : null,
  ].filter(Boolean).join('\n')

  return `You are a world-class human performance coach. It is the ${timeLabel}. Give EXACTLY 2 sentences as a coach speaking directly to the athlete. First sentence: describe their current recovery/readiness state with a specific number. Second sentence: one concrete, specific recommendation (training or recovery). Be direct, warm, and human. No bullet points, no headers, no labels.\n\nMetrics:\n${lines}`
}

export async function POST(req: NextRequest) {
  if (!GROQ_API_KEY) {
    return NextResponse.json({ error: 'GROQ_API_KEY not configured' }, { status: 503 })
  }

  let rawBody: Record<string, unknown>
  try {
    rawBody = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
  }

  const isHealthEngine = rawBody.mode === 'health-engine'
  const systemPrompt = isHealthEngine
    ? buildHealthEnginePrompt(rawBody as unknown as HealthEngineRequest)
    : buildPrompt(rawBody as unknown as SnapshotRequest)

  let groqRes: Response
  try {
    groqRes = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${GROQ_API_KEY}`,
      },
      body: JSON.stringify({
        model: GROQ_MODEL,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: 'Give me my daily snapshot.' },
        ],
        temperature: 0.6,
        max_tokens: 500,
      }),
    })
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e)
    return NextResponse.json({ error: `Cannot reach Groq: ${msg}` }, { status: 503 })
  }

  if (!groqRes.ok) {
    const text = await groqRes.text()
    return NextResponse.json({ error: `Groq error ${groqRes.status}: ${text}` }, { status: 502 })
  }

  const data = await groqRes.json() as { choices?: { message?: { content?: string } }[] }
  const reply = data.choices?.[0]?.message?.content

  if (!reply) {
    return NextResponse.json({ error: 'No response from Groq' }, { status: 502 })
  }

  return NextResponse.json({ insight: reply.trim() })
}

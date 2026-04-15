import { NextRequest, NextResponse } from 'next/server'

const GROQ_API_KEY = process.env.GROQ_API_KEY
const GROQ_MODEL = process.env.GROQ_MODEL ?? 'llama-3.3-70b-versatile'

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

  return `You are an expert sports scientist giving a daily training snapshot. Today is ${today}.

## Today's Metrics
${metricsSection}

## Recent Activities (last 7 days)
${actSection}

## Instructions
Analyse all the data above and give a concise, data-driven daily snapshot in exactly this format:

**Current Status**
One sentence describing the athlete's overall recovery and readiness state today, referencing actual numbers.

**Key Signals**
• [Most important positive or negative signal with the number]
• [Second most important signal with the number]
• [Third signal if relevant, or omit]

**Today's Recommendation**
Specific recommendation — choose ONE of: full rest, active recovery (light walk/yoga), easy aerobic session, moderate run/cycle, tempo/threshold session, interval session, or strength training. State exactly which and why, referencing the metrics. If conditions are good, suggest a specific workout (e.g. "30-40 min easy run at conversational pace" or "5x800m intervals with 90s rest").

**Watch Out For**
One sentence risk or focus area for today.

Be direct. Reference specific numbers. Total response under 220 words.`
}

export async function POST(req: NextRequest) {
  if (!GROQ_API_KEY) {
    return NextResponse.json({ error: 'GROQ_API_KEY not configured' }, { status: 503 })
  }

  let body: SnapshotRequest
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
  }

  const systemPrompt = buildPrompt(body)

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

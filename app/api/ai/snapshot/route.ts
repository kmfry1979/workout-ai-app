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
  bodyBatteryEnd: number | null
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

  // Late-day depletion: the readiness/readiness score is locked in from overnight signals.
  // If it's afternoon/evening, they've trained, and battery is depleted, that score is stale.
  const lateDayDepleted = hour >= 14 && trainedToday && m.bodyBatteryEnd != null && m.bodyBatteryEnd < 45

  const lines: string[] = []

  // Readiness — label as stale when late-day depleted so the AI doesn't lead with it
  if (m.readinessScore != null)
    lines.push(`- Morning readiness score: ${m.readinessScore}/100 (${m.readinessLabel ?? 'unknown'})${lateDayDepleted ? ' ⚠️ STALE — calculated from overnight data before training; does NOT reflect current state' : ''}`)

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

  const contextLine = lateDayDepleted
    ? `It is the ${timeOfDay} (local hour ${hour}:00). CRITICAL CONTEXT: The athlete has already trained today and their body battery is now depleted at ${m.bodyBatteryEnd}. The morning readiness score (${m.readinessScore ?? '—'}) was calculated from overnight data BEFORE training — it is now outdated and must NOT be used as the primary indicator. The body battery and training activity are the honest signals right now.`
    : `It is the ${timeOfDay} (local hour ${hour}:00). ${trainedToday ? 'The athlete has already completed at least one activity today.' : 'No activity has been logged yet today.'}`

  // Recommendation framing changes by time of day. After ~18:00 it's too late
  // to prescribe a hard session — validate rest if it fits and pivot to
  // tomorrow's plan + a light evening option.
  const recommendationGuidance = lateDayDepleted
    ? `
**Tonight & Tomorrow**
Training is done for today. Do NOT recommend another session.
- Acknowledge what the athlete has achieved today.
- Give ONE specific recovery action for tonight (e.g. protein-rich meal, 10 min stretching, prioritise 8h sleep, avoid screens before bed).
- Then prescribe the main session FOR TOMORROW based on their morning recovery signals — pick ONE of: full rest, active recovery, easy aerobic, moderate run/cycle, tempo/threshold, intervals, or strength. Be specific with duration and intensity.`
    : hour >= 18
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

  const currentStatusInstruction = lateDayDepleted
    ? `**Current Status**\nOne sentence spoken directly to the athlete (use "you/your") describing where they are RIGHT NOW — reference body battery (${m.bodyBatteryEnd}) and the hard training already done today. Warm and honest, not clinical. Do NOT lead with the morning readiness score.`
    : `**Current Status**\nOne sentence spoken directly to the athlete (use "you/your") on their overall recovery and readiness today, referencing actual numbers. Warm and direct.`

  return `You are a warm, knowledgeable personal coach giving a daily training snapshot. Speak directly to the athlete — always use "you" and "your", never "the athlete". Sound like a trusted coach, not a report. Today is ${today}. ${contextLine}

## Today's Metrics
${metricsSection}

## Recent Activities (last 7 days)
${actSection}

## Instructions
Analyse the data and respond in EXACTLY this format (including the bold section headers):

${currentStatusInstruction}

**Key Signals**
• [Most important positive or negative signal with the number — use "your"]
• [Second most important signal with the number]
• [Third signal if relevant, or omit]
${recommendationGuidance}

**Watch Out For**
One sentence, spoken to the athlete directly, on the key risk or focus area tonight.

Be warm, direct, and human — like a coach who knows you well. Reference specific numbers. Never prescribe a hard workout later than the current time of day. Total response under 240 words.`
}

function buildHealthEnginePrompt(body: HealthEngineRequest): string {
  const { recovery, strain, hrv, sleepScore, respiration, respirationBaseline, bodyBatteryEnd, hour } = body
  const timeLabel = hour < 12 ? 'morning' : hour < 17 ? 'afternoon' : 'evening'

  // Late-day depletion: recovery is locked in from overnight — it doesn't update
  // when the athlete trains. By afternoon, strain + body battery tell the real story.
  const lateDayDone = hour >= 14 && strain != null && strain > 12 && bodyBatteryEnd != null && bodyBatteryEnd < 45

  const lines = [
    recovery != null ? `Morning recovery score: ${Math.round(recovery)}/100 (calculated from overnight HRV/sleep — does NOT update during the day)` : null,
    strain != null ? `Today's strain: ${strain.toFixed(1)}/21` : null,
    bodyBatteryEnd != null ? `Body battery (current): ${bodyBatteryEnd}/100` : null,
    hrv != null ? `HRV last night: ${hrv}ms` : null,
    sleepScore != null ? `Sleep score: ${sleepScore}/100` : null,
    respiration != null ? `Respiration: ${respiration} brpm${respirationBaseline ? ` (baseline ${respirationBaseline.toFixed(1)})` : ''}` : null,
  ].filter(Boolean).join('\n')

  const context = lateDayDone
    ? `IMPORTANT CONTEXT: It is the ${timeLabel} and the athlete has already trained hard today (strain ${strain?.toFixed(1)}/21) with their body battery now depleted at ${bodyBatteryEnd}. The morning recovery score of ${recovery != null ? Math.round(recovery) : '—'} was accurate at wake-up but is now outdated — it does NOT reflect the current state. Do NOT recommend more training. Instead, validate the work done and focus entirely on recovery: rest, nutrition, hydration, and sleep.`
    : `It is the ${timeLabel}.`

  return `You are a warm, trusted personal coach. ${context} Speak directly to the athlete — use "you" and "your", never "the athlete". Give EXACTLY 2 sentences. First sentence: describe their current state with a specific number (if late-day depleted, reference strain and body battery, not just morning recovery). Second sentence: one concrete, specific recommendation (training if fresh, recovery if depleted). Sound like a coach who genuinely cares, not a report. No bullet points, no headers, no labels.\n\nMetrics:\n${lines}`
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

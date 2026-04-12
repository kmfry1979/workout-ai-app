import { NextRequest, NextResponse } from 'next/server'

const OLLAMA_BASE_URL = process.env.OLLAMA_BASE_URL ?? 'http://localhost:11434'
const OLLAMA_MODEL = process.env.OLLAMA_MODEL ?? 'gemma3'

function buildPrompt(activity: Record<string, unknown>): string {
  const type = String(activity.activity_type ?? 'workout').replace(/_/g, ' ')
  const durationMin = activity.duration_sec ? Math.round(Number(activity.duration_sec) / 60) : null
  const distanceKm = activity.distance_m ? (Number(activity.distance_m) / 1000).toFixed(2) : null
  const avgHr = activity.avg_hr ?? null
  const maxHr = activity.max_hr ?? null
  const calories = activity.calories ? Math.round(Number(activity.calories)) : null
  const trainingEffect = activity.training_effect ?? null

  // Pull extra fields from raw_payload if available
  const raw = (activity.raw_payload ?? {}) as Record<string, unknown>
  const avgPaceSecPerKm = raw.averageSpeed
    ? Math.round(1000 / Number(raw.averageSpeed))
    : null
  const avgPaceStr = avgPaceSecPerKm
    ? `${Math.floor(avgPaceSecPerKm / 60)}:${String(avgPaceSecPerKm % 60).padStart(2, '0')}/km`
    : null
  const vo2max = raw.vO2MaxValue ?? raw.vo2MaxValue ?? null
  const aerobicTE = raw.aerobicTrainingEffect ?? trainingEffect
  const anaerobicTE = raw.anaerobicTrainingEffect ?? null

  const lines = [
    `Activity type: ${type}`,
    durationMin ? `Duration: ${durationMin} minutes` : null,
    distanceKm ? `Distance: ${distanceKm} km` : null,
    avgPaceStr ? `Average pace: ${avgPaceStr}` : null,
    avgHr ? `Average heart rate: ${avgHr} bpm` : null,
    maxHr ? `Max heart rate: ${maxHr} bpm` : null,
    calories ? `Calories burned: ${calories} kcal` : null,
    aerobicTE ? `Aerobic training effect: ${Number(aerobicTE).toFixed(1)} / 5.0` : null,
    anaerobicTE ? `Anaerobic training effect: ${Number(anaerobicTE).toFixed(1)} / 5.0` : null,
    vo2max ? `VO2 Max estimate: ${vo2max}` : null,
  ].filter(Boolean).join('\n')

  return `You are an expert personal fitness coach providing post-activity feedback in the style of Strava's Athlete Intelligence feature.

The athlete just completed the following activity:

${lines}

Write a 2–3 paragraph coaching summary. Be:
- Encouraging and specific — reference actual numbers from the data
- Analytical — highlight what the heart rate zones, pace, and training effect tell you
- Forward-looking — end with one practical takeaway or suggestion for the next session

Keep your response to around 150–200 words. Do not use bullet points or headers — write in flowing paragraphs like a real coach would speak.`
}

export async function POST(req: NextRequest) {
  let body: { activity: Record<string, unknown> }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
  }

  const { activity } = body
  if (!activity) {
    return NextResponse.json({ error: 'activity is required' }, { status: 400 })
  }

  const prompt = buildPrompt(activity)

  let ollamaRes: Response
  try {
    ollamaRes = await fetch(`${OLLAMA_BASE_URL}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: OLLAMA_MODEL,
        prompt,
        stream: false,
        options: {
          temperature: 0.7,
          top_p: 0.9,
          num_predict: 300,
        },
      }),
    })
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'Unknown error'
    return NextResponse.json(
      { error: `Cannot reach Ollama at ${OLLAMA_BASE_URL}. Is it running? (${msg})` },
      { status: 503 }
    )
  }

  if (!ollamaRes.ok) {
    const text = await ollamaRes.text()
    return NextResponse.json(
      { error: `Ollama error ${ollamaRes.status}: ${text}` },
      { status: 502 }
    )
  }

  const data = await ollamaRes.json() as { response?: string; error?: string }

  if (!data.response) {
    return NextResponse.json(
      { error: data.error ?? 'No response from model' },
      { status: 502 }
    )
  }

  return NextResponse.json({ analysis: data.response.trim() })
}

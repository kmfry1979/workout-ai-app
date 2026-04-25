import { NextRequest, NextResponse } from 'next/server'

const GROQ_API_KEY = process.env.GROQ_API_KEY
const GROQ_MODEL = process.env.GROQ_MODEL ?? 'llama-3.3-70b-versatile'

function fmtPace(mps: number): string {
  const spk = Math.round(1000 / mps)
  return `${Math.floor(spk / 60)}:${String(spk % 60).padStart(2, '0')}/km`
}

type TreadmillSegment = { start_min: number; end_min: number; incline_pct: number | null; speed_kmh: number | null; description: string }

function treadmillSegmentsToText(segments: TreadmillSegment[]): string {
  const parts = segments.map(s => {
    const incline = s.incline_pct != null ? (s.incline_pct === 0 ? 'flat (0%)' : `${s.incline_pct}% incline`) : ''
    const speed = s.speed_kmh != null ? `${s.speed_kmh} km/h` : ''
    const detail = [incline, speed].filter(Boolean).join(', ')
    return `${s.start_min}–${s.end_min} min: ${detail || s.description}`
  })
  return parts.join(' | ')
}

function buildPrompt(activity: Record<string, unknown>, recentActivities: Record<string, unknown>[], treadmillSegments?: TreadmillSegment[] | null): string {
  const raw = (activity.raw_payload ?? {}) as Record<string, unknown>

  const rawTypeKey = (raw.activityType as Record<string, unknown> | undefined)?.typeKey as string | undefined
  const type = rawTypeKey?.replace(/_/g, ' ') ?? String(activity.activity_type ?? 'workout').replace(/_/g, ' ')
  const name = (raw.activityName as string | undefined) ?? type
  const durationMin = activity.duration_sec ? Math.round(Number(activity.duration_sec) / 60) : null
  const distanceKm = activity.distance_m ? (Number(activity.distance_m) / 1000).toFixed(2) : null
  const avgHr = activity.avg_hr as number | null
  const maxHr = activity.max_hr as number | null
  const calories = activity.calories ? Math.round(Number(activity.calories)) : null
  const avgSpeed = raw.averageSpeed as number | undefined
  const avgPaceStr = avgSpeed && Number(distanceKm) > 0.1 ? fmtPace(avgSpeed) : null
  const vo2max = raw.vO2MaxValue ?? raw.vo2MaxValue ?? null
  const aerobicTE = Number(raw.aerobicTrainingEffect ?? activity.training_effect ?? 0)
  const anaerobicTE = Number(raw.anaerobicTrainingEffect ?? 0)
  const avgCadence = raw.averageRunningCadenceInStepsPerMinute as number | undefined
  const relativeEffort = raw.lactateThresholdHeartRate ? null : (raw.trainingStressScore ?? null)
  const elevGain = raw.elevationGain ?? raw.totalElevationGain ?? null

  // HR zones
  const zones = [1,2,3,4,5].map(i => {
    const v = raw[`hrTimeInZone_${i}`] ?? raw[`timeInHRZone${i}`]
    return v != null ? Math.round(Number(v) / 60) : 0
  })
  const totalZoneMin = zones.reduce((s,v) => s+v, 0)
  const dominantZone = totalZoneMin > 0 ? zones.indexOf(Math.max(...zones)) + 1 : null
  const zoneStr = totalZoneMin > 0
    ? zones.map((m,i) => m > 0 ? `Z${i+1}: ${m}min` : null).filter(Boolean).join(', ')
    : null

  // Compare to recent activities (same rough type filter)
  const isRunType = type.toLowerCase().includes('run') || type.toLowerCase().includes('jog') || type.toLowerCase().includes('treadmill')
  const sametype = recentActivities.filter(r => {
    const rRaw = (r.raw_payload ?? {}) as Record<string, unknown>
    const rType = ((rRaw.activityType as Record<string, unknown> | undefined)?.typeKey as string ?? '')
      .replace(/_/g, ' ').toLowerCase()
    return isRunType
      ? rType.includes('run') || rType.includes('jog') || rType.includes('treadmill')
      : rType.includes(type.toLowerCase().split(' ')[0])
  })

  let comparisonStr = ''
  if (sametype.length >= 3) {
    const avgDurMin = Math.round(sametype.reduce((s,r) => s + (Number(r.duration_sec ?? 0)/60), 0) / sametype.length)
    const avgDistKm = sametype.reduce((s,r) => s + Number(r.distance_m ?? 0)/1000, 0) / sametype.length
    const speedSamples = sametype.map(r => (r.raw_payload as Record<string,unknown>)?.averageSpeed as number | undefined).filter((v): v is number => v != null && v > 0)
    const avgPaceRecent = speedSamples.length > 0 ? fmtPace(speedSamples.reduce((s,v)=>s+v,0)/speedSamples.length) : null
    const avgHrRecent = Math.round(sametype.filter(r => r.avg_hr != null).reduce((s,r)=>s+Number(r.avg_hr),0) / sametype.filter(r=>r.avg_hr!=null).length)
    const parts = [
      `based on ${sametype.length} recent ${type} sessions`,
      durationMin ? `avg duration ${avgDurMin}min (today: ${durationMin}min, ${durationMin > avgDurMin ? '+' : ''}${durationMin - avgDurMin}min)` : null,
      avgDistKm > 0.1 && distanceKm ? `avg distance ${avgDistKm.toFixed(2)}km (today: ${distanceKm}km, ${Number(distanceKm) > avgDistKm ? 'above' : 'below'} avg)` : null,
      avgPaceRecent && avgPaceStr ? `avg pace ${avgPaceRecent} (today: ${avgPaceStr}, ${avgSpeed && speedSamples.reduce((s,v)=>s+v,0)/speedSamples.length < avgSpeed ? 'faster' : 'slower'} than usual)` : null,
      !isNaN(avgHrRecent) && avgHr ? `avg HR ${avgHrRecent}bpm (today: ${avgHr}bpm)` : null,
    ].filter(Boolean)
    comparisonStr = parts.join('; ')
  }

  const lines = [
    `Activity: ${name} (${type})`,
    durationMin ? `Duration: ${durationMin} min` : null,
    distanceKm ? `Distance: ${distanceKm} km` : null,
    avgPaceStr ? `Avg pace: ${avgPaceStr}` : null,
    avgHr ? `Avg HR: ${avgHr} bpm${maxHr ? ` (max ${maxHr} bpm)` : ''}` : null,
    avgCadence ? `Avg cadence: ${Math.round(avgCadence)} spm` : null,
    calories ? `Calories: ${calories} kcal` : null,
    aerobicTE > 0 ? `Aerobic TE: ${aerobicTE.toFixed(1)}/5.0` : null,
    anaerobicTE > 0 ? `Anaerobic TE: ${anaerobicTE.toFixed(1)}/5.0` : null,
    zoneStr ? `HR zones: ${zoneStr}` : null,
    dominantZone ? `Dominant zone: Z${dominantZone}` : null,
    vo2max ? `VO2 Max: ${vo2max} ml/kg/min` : null,
    elevGain ? `Elevation gain: ${Math.round(Number(elevGain))}m` : null,
    comparisonStr ? `Comparison (${comparisonStr})` : null,
    treadmillSegments && treadmillSegments.length > 0
      ? `Treadmill segments (user-recorded): ${treadmillSegmentsToText(treadmillSegments)}`
      : null,
  ].filter(Boolean).join('\n')

  return `You are an expert coach providing post-activity feedback. The athlete just completed:

${lines}

Write a coaching summary in EXACTLY this format:

HEADLINE: [One punchy sentence (max 15 words) comparing this session to their typical performance — reference a specific number like pace, distance, or HR. Be direct and specific like "Solid ${durationMin}min ${type} — ${avgPaceStr ? `${avgPaceStr} pace is` : 'effort is'} ${comparisonStr.includes('faster') ? 'faster than your recent average' : comparisonStr.includes('above avg') ? 'above your recent average' : 'consistent with your recent form'}".]

BODY:
[Paragraph 1 — 3-4 sentences: Describe what the data says. Reference HR zones (which zone dominated, what that means physiologically), pace/distance vs recent average if available, training effect score and what it means (1=minor benefit, 5=overreaching), and whether the effort was appropriate for the day. Be specific with numbers.]

[Paragraph 2 — 2-3 sentences: Recovery and next steps. Based on the aerobic/anaerobic TE scores and HR data, what should the athlete do next? Mention timeline (e.g. "take 24h easy") and one specific session recommendation for their next workout.]

Keep the total body to 150-180 words. Do not use bullet points. Write like a knowledgeable coach who reviewed the data.`
}

export async function POST(req: NextRequest) {
  if (!GROQ_API_KEY) {
    return NextResponse.json({ error: 'GROQ_API_KEY is not configured' }, { status: 503 })
  }

  let body: { activity: Record<string, unknown>; recentActivities?: Record<string, unknown>[]; treadmillSegments?: TreadmillSegment[] | null }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
  }

  const { activity, recentActivities = [], treadmillSegments } = body
  if (!activity) {
    return NextResponse.json({ error: 'activity is required' }, { status: 400 })
  }

  const prompt = buildPrompt(activity, recentActivities, treadmillSegments)

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
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.65,
        max_tokens: 500,
      }),
    })
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e)
    return NextResponse.json({ error: `Cannot reach Groq API: ${msg}` }, { status: 503 })
  }

  if (!res.ok) {
    const text = await res.text()
    return NextResponse.json({ error: `Groq error ${res.status}: ${text}` }, { status: 502 })
  }

  const data = await res.json() as { choices?: { message?: { content?: string } }[]; error?: { message?: string } }
  const text = data.choices?.[0]?.message?.content
  if (!text) return NextResponse.json({ error: data.error?.message ?? 'No response from Groq' }, { status: 502 })

  // Parse headline and body from the structured response
  const headlineMatch = text.match(/HEADLINE:\s*(.+?)(?:\n|$)/i)
  const bodyMatch = text.match(/BODY:\s*([\s\S]+)/i)
  const headline = headlineMatch?.[1]?.trim() ?? text.split('\n')[0].trim()
  const bodyText = bodyMatch?.[1]?.trim() ?? text.replace(/HEADLINE:.+\n?/i, '').trim()

  return NextResponse.json({ headline, analysis: bodyText })
}

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

const GROQ_API_KEY = process.env.GROQ_API_KEY
const GROQ_MODEL = process.env.GROQ_MODEL ?? 'qwen/qwen3-32b'
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!

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

type BrainInsightContext = {
  headline: string
  insight: string
  suggested_focus: string
  readiness_score: number
  readiness_label: 'green' | 'amber' | 'red'
}

type CoachMemoryFacts = {
  name?: string | null
  weight_kg?: number | null
  weight_date?: string | null
  body_fat_pct?: number | null
  threshold_5k_formatted?: string | null
  threshold_5k_pace?: string | null
  threshold_10k_formatted?: string | null
  hrv_today?: number | null
  hrv_7day_avg?: number | null
  body_battery?: number | null
  stress_avg?: number | null
  resting_hr?: number | null
  training_readiness?: number | null
  sleep_score?: number | null
  sleep_duration_hours?: number | null
  steps_today?: number | null
  weekly_runs?: number | null
  weekly_run_distance_km?: number | null
  weekly_run_duration_min?: number | null
  weekly_strength_sessions?: number | null
  weekly_total_activities?: number | null
  last_run_date?: string | null
  last_run_type?: string | null
  last_run_distance_km?: number | null
  last_run_duration_min?: number | null
  last_run_avg_hr?: number | null
  updated_at?: string | null
}

function buildMemorySection(facts: CoachMemoryFacts): string {
  const lines: string[] = []

  if (facts.weight_kg) lines.push(`- Weight: ${facts.weight_kg}kg${facts.body_fat_pct ? ` · Body fat: ${facts.body_fat_pct}%` : ''}${facts.weight_date ? ` (${facts.weight_date})` : ''}`)
  if (facts.threshold_5k_formatted) lines.push(`- 5K time: ${facts.threshold_5k_formatted}${facts.threshold_5k_pace ? ` (${facts.threshold_5k_pace} pace)` : ''}`)
  if (facts.threshold_10k_formatted) lines.push(`- 10K time: ${facts.threshold_10k_formatted}`)
  if (facts.hrv_today) lines.push(`- HRV today: ${facts.hrv_today}ms${facts.hrv_7day_avg ? ` (7-day avg: ${facts.hrv_7day_avg}ms)` : ''}`)
  if (facts.body_battery) lines.push(`- Body Battery: ${facts.body_battery}/100`)
  if (facts.resting_hr) lines.push(`- Resting HR: ${facts.resting_hr} bpm`)
  if (facts.sleep_score) lines.push(`- Sleep score: ${facts.sleep_score}/100${facts.sleep_duration_hours ? ` · ${facts.sleep_duration_hours}h` : ''}`)
  if (facts.training_readiness) lines.push(`- Training Readiness: ${facts.training_readiness}/100`)
  if (facts.steps_today) lines.push(`- Steps today: ${facts.steps_today.toLocaleString()}`)
  if (facts.weekly_runs != null) {
    lines.push(`- This week: ${facts.weekly_runs} runs · ${facts.weekly_run_distance_km ?? 0}km · ${facts.weekly_run_duration_min ?? 0} min${facts.weekly_strength_sessions ? ` · ${facts.weekly_strength_sessions} strength sessions` : ''}`)
  }
  if (facts.last_run_date) {
    const runParts = [
      facts.last_run_date,
      facts.last_run_type,
      facts.last_run_distance_km ? `${facts.last_run_distance_km}km` : null,
      facts.last_run_duration_min ? `${facts.last_run_duration_min}min` : null,
      facts.last_run_avg_hr ? `avg HR ${facts.last_run_avg_hr}bpm` : null,
    ].filter(Boolean)
    lines.push(`- Last run: ${runParts.join(' · ')}`)
  }

  return lines.length > 0 ? lines.join('\n') : 'No stored facts yet.'
}

function buildSystemPrompt(
  metrics: MetricsContext | null,
  activities: ActivityContext[],
  brain?: BrainInsightContext | null,
  memoryFacts?: CoachMemoryFacts | null
): string {
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

  const memorySection = memoryFacts ? buildMemorySection(memoryFacts) : null

  return `You are an expert personal fitness coach and sports scientist. Today is ${today}.
${memorySection ? `
## Athlete Profile & Key Stats (from memory — always up to date)

${memorySection}
` : ''}
## Today's Live Metrics

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

Be conversational, encouraging, and specific. Reference their actual numbers. Keep responses concise (2-4 sentences unless they ask for more detail). Don't use excessive bullet points — talk like a real coach.${brain ? `

## AI Brain Insight (generated from full 7-day analysis)

Label: ${brain.readiness_label.toUpperCase()} (score: ${brain.readiness_score}/100)
Headline: ${brain.headline}
Analysis: ${brain.insight}
Today's recommendation: ${brain.suggested_focus}

Use this Brain Insight as authoritative context — it reflects a deep 7-day analysis. Reference it naturally when relevant.` : ''}`
}

export async function POST(req: NextRequest) {
  if (!GROQ_API_KEY) {
    return NextResponse.json({ error: 'GROQ_API_KEY not configured' }, { status: 503 })
  }

  let body: {
    messages: Message[]
    metrics: MetricsContext | null
    activities: ActivityContext[]
    brainInsight?: BrainInsightContext | null
    conversationId?: string | null
  }

  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
  }

  const { messages, metrics, activities, brainInsight, conversationId } = body

  // Get auth token if present (for saving to DB)
  const authHeader = req.headers.get('authorization')
  const userToken = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null

  let userId: string | null = null
  let activeConversationId: string | null = conversationId ?? null
  let memoryFacts: CoachMemoryFacts | null = null

  if (userToken) {
    try {
      const userClient = createClient(supabaseUrl, anonKey, {
        global: { headers: { Authorization: `Bearer ${userToken}` } },
      })
      const { data: { user } } = await userClient.auth.getUser()
      userId = user?.id ?? null

      if (userId) {
        const sb = createClient(supabaseUrl, serviceKey)

        // Read coach_memory for fast context
        const { data: memRow } = await sb
          .from('coach_memory')
          .select('facts')
          .eq('user_id', userId)
          .single()
        memoryFacts = memRow?.facts as CoachMemoryFacts ?? null

        // Ensure conversation exists
        if (!activeConversationId) {
          const { data: newConv } = await sb
            .from('coach_conversations')
            .insert({ user_id: userId, title: null })
            .select('id')
            .single()
          activeConversationId = newConv?.id ?? null
        }

        // Save the latest user message to DB
        const lastUserMsg = [...messages].reverse().find(m => m.role === 'user')
        if (lastUserMsg && activeConversationId) {
          await sb.from('coach_messages').insert({
            conversation_id: activeConversationId,
            user_id: userId,
            role: 'user',
            content: lastUserMsg.content,
          })
        }
      }
    } catch (e) {
      console.error('Auth/DB error (non-fatal):', e)
    }
  }

  const systemPrompt = buildSystemPrompt(metrics ?? null, activities ?? [], brainInsight, memoryFacts)

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
        max_tokens: 800,
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

  const trimmedReply = reply.trim()

  // Save assistant reply + auto-title conversation
  if (userId && activeConversationId) {
    try {
      const sb = createClient(supabaseUrl, serviceKey)

      await sb.from('coach_messages').insert({
        conversation_id: activeConversationId,
        user_id: userId,
        role: 'assistant',
        content: trimmedReply,
      })

      // Auto-title: use first user message (first 60 chars) if title is null
      const firstUserMsg = messages.find(m => m.role === 'user')
      if (firstUserMsg) {
        await sb
          .from('coach_conversations')
          .update({
            updated_at: new Date().toISOString(),
            title: firstUserMsg.content.slice(0, 60).trim(),
          })
          .eq('id', activeConversationId)
          .is('title', null)

        // Always update updated_at
        await sb
          .from('coach_conversations')
          .update({ updated_at: new Date().toISOString() })
          .eq('id', activeConversationId)
      }
    } catch (e) {
      console.error('Save reply error (non-fatal):', e)
    }
  }

  return NextResponse.json({ reply: trimmedReply, conversationId: activeConversationId })
}

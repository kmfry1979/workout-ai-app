import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase/server'

const GROQ_API_KEY = process.env.GROQ_API_KEY
const GROQ_MODEL = process.env.GROQ_MODEL ?? 'llama-3.3-70b-versatile'

export type TreadmillSegment = {
  start_min: number
  end_min: number
  incline_pct: number | null
  speed_kmh: number | null
  description: string
}

type ParseResult = {
  segments: TreadmillSegment[]
  notes: string
  confidence: 'high' | 'medium' | 'low'
}

async function parseWithAI(userText: string, durationMin: number | null): Promise<ParseResult> {
  const system = `You are a treadmill workout data parser. The user will describe what they did during a treadmill run in plain English. Extract each distinct segment.

Return ONLY valid JSON matching this exact structure (no markdown, no explanation):
{
  "segments": [
    {
      "start_min": 0,
      "end_min": 20,
      "incline_pct": 1.0,
      "speed_kmh": null,
      "description": "1% incline"
    }
  ],
  "notes": "One-sentence summary of the full session",
  "confidence": "high"
}

Rules:
- start_min / end_min are integers (minutes from start of workout)
- incline_pct: the gradient percentage (0 = flat, 1 = 1%, null = not mentioned)
- speed_kmh: speed in km/h if mentioned (null if not mentioned)
- Segments must be contiguous and not exceed total duration (${durationMin ?? 'unknown'} min)
- confidence: "high" if the text is clear, "medium" if some assumptions were made, "low" if very ambiguous
- "flat", "0%", "no incline" all = incline_pct: 0`

  const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${GROQ_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: GROQ_MODEL,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: userText },
      ],
      temperature: 0.1,
      max_tokens: 600,
    }),
  })

  if (!res.ok) throw new Error('AI parse request failed')
  const groqData = await res.json() as { choices?: { message?: { content?: string } }[] }
  const raw = groqData.choices?.[0]?.message?.content ?? '{}'

  // Extract JSON even if wrapped in markdown
  const jsonMatch = raw.match(/\{[\s\S]*\}/)
  if (!jsonMatch) throw new Error('Could not extract JSON from AI response')

  const parsed = JSON.parse(jsonMatch[0]) as ParseResult
  if (!Array.isArray(parsed.segments)) throw new Error('Invalid AI response structure')
  return parsed
}

export async function POST(req: NextRequest) {
  try {
    const { activityId, userText, durationMin, confirmSave } = await req.json() as {
      activityId: string
      userText: string
      durationMin: number | null
      confirmSave?: boolean
    }

    if (!activityId || !userText?.trim()) {
      return NextResponse.json({ error: 'activityId and userText are required' }, { status: 400 })
    }

    // 1. Parse text with AI
    const parsed = await parseWithAI(userText.trim(), durationMin)

    // 2. If confirmSave=true, write to DB
    if (confirmSave) {
      const supabase = await createSupabaseServerClient()
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })

      const { error: dbErr } = await supabase
        .from('garmin_activities')
        .update({
          treadmill_segments: parsed.segments,
          user_activity_notes: userText.trim(),
          user_edited_at: new Date().toISOString(),
          ai_activity_summary: parsed.notes,
        })
        .eq('id', activityId)
        .eq('user_id', user.id)

      if (dbErr) return NextResponse.json({ error: dbErr.message }, { status: 500 })
    }

    return NextResponse.json({ segments: parsed.segments, notes: parsed.notes, confidence: parsed.confidence })
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'Unknown error'
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}

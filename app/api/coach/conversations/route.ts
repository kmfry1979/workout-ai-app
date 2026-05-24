import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!

function getUserClient(token: string) {
  return createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: `Bearer ${token}` } },
  })
}

function getToken(req: NextRequest) {
  const auth = req.headers.get('authorization')
  return auth?.startsWith('Bearer ') ? auth.slice(7) : null
}

// GET /api/coach/conversations — list all conversations for the user
export async function GET(req: NextRequest) {
  const token = getToken(req)
  if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const sb = getUserClient(token)

  // Get conversations with last message preview
  const { data, error } = await sb
    .from('coach_conversations')
    .select(`
      id,
      title,
      created_at,
      updated_at,
      coach_messages (
        role,
        content,
        created_at
      )
    `)
    .order('updated_at', { ascending: false })
    .limit(50)

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  // Shape: add message_count and last_message preview
  const conversations = (data ?? []).map(c => {
    const msgs = (c.coach_messages ?? []) as { role: string; content: string; created_at: string }[]
    const sorted = [...msgs].sort((a, b) => a.created_at.localeCompare(b.created_at))
    const lastMsg = sorted[sorted.length - 1]
    return {
      id: c.id,
      title: c.title,
      created_at: c.created_at,
      updated_at: c.updated_at,
      message_count: msgs.length,
      last_message: lastMsg?.content?.slice(0, 120) ?? null,
      last_role: lastMsg?.role ?? null,
    }
  })

  return NextResponse.json({ conversations })
}

// POST /api/coach/conversations — create a new conversation
export async function POST(req: NextRequest) {
  const token = getToken(req)
  if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const sb = getUserClient(token)
  const { data: { user } } = await sb.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let title: string | null = null
  try {
    const body = await req.json()
    title = body.title ?? null
  } catch { /* no body */ }

  const { data, error } = await sb
    .from('coach_conversations')
    .insert({ user_id: user.id, title })
    .select('id, title, created_at, updated_at')
    .single()

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ conversation: data })
}

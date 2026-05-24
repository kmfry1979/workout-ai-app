'use client'

import { useEffect, useRef, useState, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '../../lib/supabase'
import { BottomNav } from '../../components/BottomNav'

// ── Types ────────────────────────────────────────────────────────────────────

type Message = { role: 'user' | 'assistant'; content: string }

type Conversation = {
  id: string
  title: string | null
  created_at: string
  updated_at: string
  message_count: number
  last_message: string | null
  last_role: string | null
}

type MemoryFacts = {
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
  updated_at?: string | null
}

type MetricsCtx = {
  hrv: number | null; hrvStatus: string | null; sleepScore: number | null
  sleepDurationSeconds: number | null; deepSleepSeconds: number | null; remSleepSeconds: number | null
  bodyBattery: number | null; stress: number | null; restingHr: number | null
  respiration: number | null; spo2: number | null; steps: number | null
  activeMinutes: number | null; moderateIntensityMinutes: number | null
  vigorousIntensityMinutes: number | null; date: string
}

type ActivityCtx = {
  type: string; name: string; date: string; durationMin: number | null
  distanceKm: number | null; avgHr: number | null; calories: number | null
  trainingEffect: number | null; treadmillSegments: null; notes: string | null
}

const QUICK_PROMPTS = [
  "What should I do today?",
  "Am I overtraining?",
  "How's my recovery looking?",
  "What type of run should I do today?",
  "Should I do strength or cardio today?",
  "How can I improve my HRV?",
]

// ── Memory Panel ─────────────────────────────────────────────────────────────

function MemoryStat({ label, value, sub }: { label: string; value: string | null; sub?: string }) {
  if (!value) return null
  return (
    <div className="bg-gray-800/60 rounded-xl px-3 py-2 shrink-0">
      <p className="text-[10px] text-gray-500 uppercase tracking-wider">{label}</p>
      <p className="text-sm font-bold text-white mt-0.5">{value}</p>
      {sub && <p className="text-[10px] text-gray-500 mt-0.5">{sub}</p>}
    </div>
  )
}

function MemoryPanel({ facts, updatedAt, onRefresh, refreshing }: {
  facts: MemoryFacts | null
  updatedAt: string | null
  onRefresh: () => void
  refreshing: boolean
}) {
  if (!facts) return null

  const relativeTime = (iso: string | null) => {
    if (!iso) return null
    const diff = Date.now() - new Date(iso).getTime()
    const mins = Math.floor(diff / 60000)
    if (mins < 1) return 'just now'
    if (mins < 60) return `${mins}m ago`
    const hrs = Math.floor(mins / 60)
    if (hrs < 24) return `${hrs}h ago`
    return `${Math.floor(hrs / 24)}d ago`
  }

  const weekStr = facts.weekly_runs != null
    ? `${facts.weekly_runs} runs · ${facts.weekly_run_distance_km ?? 0}km`
    : null

  return (
    <div className="px-4 pb-3">
      <div className="flex items-center justify-between mb-2">
        <p className="text-[10px] text-gray-500 uppercase tracking-wider font-semibold">Coach Memory</p>
        <button
          onClick={onRefresh}
          disabled={refreshing}
          className="flex items-center gap-1 text-[10px] text-gray-600 hover:text-orange-400 transition-colors disabled:opacity-40"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}
            className={`w-3 h-3 ${refreshing ? 'animate-spin' : ''}`}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
          </svg>
          {refreshing ? 'Refreshing…' : updatedAt ? `Updated ${relativeTime(updatedAt)}` : 'Refresh'}
        </button>
      </div>
      <div className="flex gap-2 overflow-x-auto scrollbar-none pb-1">
        <MemoryStat label="Weight" value={facts.weight_kg ? `${facts.weight_kg}kg` : null}
          sub={facts.body_fat_pct ? `${facts.body_fat_pct}% fat` : undefined} />
        <MemoryStat label="5K Time" value={facts.threshold_5k_formatted ?? null}
          sub={facts.threshold_5k_pace ?? undefined} />
        <MemoryStat label="10K Time" value={facts.threshold_10k_formatted ?? null} />
        <MemoryStat label="This Week" value={weekStr}
          sub={facts.weekly_strength_sessions ? `+ ${facts.weekly_strength_sessions} strength` : undefined} />
        <MemoryStat label="HRV" value={facts.hrv_today ? `${facts.hrv_today}ms` : null}
          sub={facts.hrv_7day_avg ? `7d avg ${facts.hrv_7day_avg}ms` : undefined} />
        <MemoryStat label="Body Battery" value={facts.body_battery ? `${facts.body_battery}%` : null} />
        <MemoryStat label="Sleep" value={facts.sleep_score ? `${facts.sleep_score}/100` : null}
          sub={facts.sleep_duration_hours ? `${facts.sleep_duration_hours}h` : undefined} />
        <MemoryStat label="Last Run" value={facts.last_run_distance_km ? `${facts.last_run_distance_km}km` : null}
          sub={facts.last_run_date ?? undefined} />
      </div>
    </div>
  )
}

// ── Conversation List Item ────────────────────────────────────────────────────

function ConvItem({ conv, onClick }: { conv: Conversation; onClick: () => void }) {
  const relDate = (iso: string) => {
    const d = new Date(iso)
    const now = new Date()
    const diff = now.getTime() - d.getTime()
    const days = Math.floor(diff / 86400000)
    if (days === 0) return d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })
    if (days === 1) return 'Yesterday'
    if (days < 7) return d.toLocaleDateString('en-GB', { weekday: 'short' })
    return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
  }

  return (
    <button
      onClick={onClick}
      className="w-full text-left bg-gray-900 hover:bg-gray-800/80 rounded-2xl p-4 transition-colors"
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1 min-w-0">
          <p className="text-white text-sm font-medium leading-snug line-clamp-1">
            {conv.title ?? 'Untitled chat'}
          </p>
          {conv.last_message && (
            <p className="text-gray-500 text-xs mt-1 line-clamp-2 leading-relaxed">
              {conv.last_role === 'assistant' ? '🤖 ' : '👤 '}
              {conv.last_message}
            </p>
          )}
        </div>
        <div className="shrink-0 text-right">
          <p className="text-gray-600 text-[10px]">{relDate(conv.updated_at)}</p>
          {conv.message_count > 0 && (
            <p className="text-gray-700 text-[10px] mt-1">{conv.message_count} msgs</p>
          )}
        </div>
      </div>
    </button>
  )
}

// ── Main Component ────────────────────────────────────────────────────────────

export default function CoachPage() {
  const router = useRouter()
  const bottomRef = useRef<HTMLDivElement>(null)

  // Auth
  const [token, setToken] = useState<string | null>(null)
  const [displayName, setDisplayName] = useState('')

  // View state
  const [view, setView] = useState<'list' | 'chat'>('list')

  // List view state
  const [conversations, setConversations] = useState<Conversation[]>([])
  const [convsLoading, setConvsLoading] = useState(true)
  const [memory, setMemory] = useState<MemoryFacts | null>(null)
  const [memoryUpdatedAt, setMemoryUpdatedAt] = useState<string | null>(null)
  const [refreshing, setRefreshing] = useState(false)

  // Chat view state
  const [activeConvId, setActiveConvId] = useState<string | null>(null)
  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput] = useState('')
  const [sending, setSending] = useState(false)
  const [msgsLoading, setMsgsLoading] = useState(false)

  // Live metrics context (for current session)
  const [metricsCtx, setMetricsCtx] = useState<MetricsCtx | null>(null)
  const [activitiesCtx, setActivitiesCtx] = useState<ActivityCtx[]>([])
  const [contextReady, setContextReady] = useState(false)

  // ── Auth + initial load ──────────────────────────────────────────────────

  useEffect(() => {
    const init = async () => {
      const { data } = await supabase.auth.getSession()
      if (!data.session) { router.push('/login'); return }
      const sess = data.session
      setToken(sess.access_token)

      const { data: profile } = await supabase.from('profiles')
        .select('display_name, name').eq('user_id', sess.user.id).maybeSingle()
      setDisplayName(profile?.display_name ?? profile?.name ?? '')

      // Load memory from DB
      const { data: memRow } = await supabase.from('coach_memory')
        .select('facts, updated_at').eq('user_id', sess.user.id).maybeSingle()
      if (memRow?.facts) {
        setMemory(memRow.facts as MemoryFacts)
        setMemoryUpdatedAt(memRow.updated_at ?? null)
      }

      // Load conversations
      await loadConversations(sess.access_token)

      // Load live metrics context (background)
      loadLiveContext(sess.user.id)
    }
    init()
  }, [router])

  const loadConversations = async (tok: string) => {
    setConvsLoading(true)
    try {
      const res = await fetch('/api/coach/conversations', {
        headers: { Authorization: `Bearer ${tok}` },
      })
      if (res.ok) {
        const { conversations: convs } = await res.json()
        setConversations(convs ?? [])
      }
    } finally {
      setConvsLoading(false)
    }
  }

  const refreshMemory = async () => {
    if (!token || refreshing) return
    setRefreshing(true)
    try {
      const res = await fetch('/api/coach/refresh-memory', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      })
      if (res.ok) {
        const { facts } = await res.json()
        setMemory(facts)
        setMemoryUpdatedAt(new Date().toISOString())
      }
    } finally {
      setRefreshing(false)
    }
  }

  const loadLiveContext = async (userId: string) => {
    const today = new Date().toISOString().split('T')[0]
    const sevenAgo = new Date(Date.now() - 7 * 86400000).toISOString().split('T')[0]

    const [garminHealth, legacyHealth, sleepData, stepsData, actsData] = await Promise.all([
      supabase.from('garmin_daily_health_metrics')
        .select('hrv_avg,hrv_status,respiration_avg_bpm,stress_avg,body_battery_end,spo2_avg')
        .eq('user_id', userId).eq('metric_date', today).maybeSingle(),
      supabase.from('daily_health_metrics')
        .select('garmin_hrv_nightly_avg,garmin_sleep_score,garmin_body_battery_high,garmin_stress_avg,resting_hr,resting_heart_rate_bpm,steps')
        .eq('user_id', userId).eq('metric_date', today).maybeSingle(),
      supabase.from('garmin_sleep_data')
        .select('sleep_score,sleep_duration_seconds,deep_sleep_seconds,rem_sleep_seconds')
        .eq('user_id', userId).gte('sleep_date', sevenAgo)
        .order('sleep_date', { ascending: false }).limit(1).maybeSingle(),
      supabase.from('garmin_daily_steps')
        .select('total_steps,active_minutes,moderate_intensity_minutes,vigorous_intensity_minutes')
        .eq('user_id', userId).eq('step_date', today).maybeSingle(),
      supabase.from('garmin_activities')
        .select('activity_type,start_time,duration_sec,distance_m,avg_hr,calories,training_effect,raw_payload,treadmill_segments,user_activity_notes')
        .eq('user_id', userId).gte('start_time', new Date(Date.now() - 7 * 86400000).toISOString())
        .order('start_time', { ascending: false }),
    ])

    const gh = garminHealth.data as Record<string, unknown> | null
    const leg = legacyHealth.data as Record<string, unknown> | null
    const sl = sleepData.data as Record<string, unknown> | null
    const st = stepsData.data as Record<string, unknown> | null

    setMetricsCtx({
      hrv: (gh?.hrv_avg ?? leg?.garmin_hrv_nightly_avg ?? null) as number | null,
      hrvStatus: (gh?.hrv_status ?? null) as string | null,
      sleepScore: (sl?.sleep_score ?? leg?.garmin_sleep_score ?? null) as number | null,
      sleepDurationSeconds: (sl?.sleep_duration_seconds ?? null) as number | null,
      deepSleepSeconds: (sl?.deep_sleep_seconds ?? null) as number | null,
      remSleepSeconds: (sl?.rem_sleep_seconds ?? null) as number | null,
      bodyBattery: (gh?.body_battery_end ?? leg?.garmin_body_battery_high ?? null) as number | null,
      stress: (gh?.stress_avg ?? leg?.garmin_stress_avg ?? null) as number | null,
      restingHr: (leg?.resting_hr ?? leg?.resting_heart_rate_bpm ?? null) as number | null,
      respiration: (gh?.respiration_avg_bpm ?? null) as number | null,
      spo2: (gh?.spo2_avg ?? null) as number | null,
      steps: (st?.total_steps ?? leg?.steps ?? null) as number | null,
      activeMinutes: (st?.active_minutes ?? null) as number | null,
      moderateIntensityMinutes: (st?.moderate_intensity_minutes ?? null) as number | null,
      vigorousIntensityMinutes: (st?.vigorous_intensity_minutes ?? null) as number | null,
      date: today,
    })

    const acts: ActivityCtx[] = ((actsData.data ?? []) as Record<string, unknown>[]).map(a => {
      const raw = (a.raw_payload ?? {}) as Record<string, unknown>
      const typeKey = (raw.activityType as Record<string, unknown> | undefined)?.typeKey as string | undefined
      return {
        type: typeKey?.replace(/_/g, ' ') ?? String(a.activity_type ?? 'activity'),
        name: raw.activityName as string ?? '',
        date: new Date(a.start_time as string).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' }),
        durationMin: a.duration_sec ? Math.round(Number(a.duration_sec) / 60) : null,
        distanceKm: a.distance_m && Number(a.distance_m) > 100 ? Math.round(Number(a.distance_m) / 100) / 10 : null,
        avgHr: (a.avg_hr ?? null) as number | null,
        calories: (a.calories ?? null) as number | null,
        trainingEffect: (a.training_effect ?? null) as number | null,
        treadmillSegments: null,
        notes: (a.user_activity_notes ?? null) as string | null,
      }
    })
    setActivitiesCtx(acts)
    setContextReady(true)
  }

  // ── Scroll to bottom on new messages ────────────────────────────────────

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, sending])

  // ── Open conversation ────────────────────────────────────────────────────

  const openConversation = useCallback(async (convId: string) => {
    if (!token) return
    setActiveConvId(convId)
    setMessages([])
    setMsgsLoading(true)
    setView('chat')

    const res = await fetch(`/api/coach/conversations/${convId}/messages`, {
      headers: { Authorization: `Bearer ${token}` },
    })
    if (res.ok) {
      const { messages: dbMsgs } = await res.json()
      setMessages((dbMsgs ?? []).map((m: { role: string; content: string }) => ({
        role: m.role as 'user' | 'assistant',
        content: m.content,
      })))
    }
    setMsgsLoading(false)
  }, [token])

  // ── New conversation ─────────────────────────────────────────────────────

  const startNewChat = useCallback(() => {
    setActiveConvId(null)
    setMessages([])
    setView('chat')
  }, [])

  // ── Send message ─────────────────────────────────────────────────────────

  const sendMessage = useCallback(async (text: string) => {
    if (!text.trim() || sending) return
    const userMsg: Message = { role: 'user', content: text.trim() }
    const newMessages = [...messages, userMsg]
    setMessages(newMessages)
    setInput('')
    setSending(true)

    try {
      const headers: Record<string, string> = { 'Content-Type': 'application/json' }
      if (token) headers['Authorization'] = `Bearer ${token}`

      const res = await fetch('/api/coach/chat', {
        method: 'POST',
        headers,
        body: JSON.stringify({
          messages: newMessages,
          metrics: metricsCtx,
          activities: activitiesCtx,
          conversationId: activeConvId,
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? 'Coach unavailable')

      setMessages(m => [...m, { role: 'assistant', content: data.reply }])

      // Update conversationId if server created one
      if (data.conversationId && !activeConvId) {
        setActiveConvId(data.conversationId)
      }

      // Refresh conversation list in background
      if (token) {
        loadConversations(token)
      }
    } catch (e: unknown) {
      setMessages(m => [...m, {
        role: 'assistant',
        content: e instanceof Error ? e.message : 'Something went wrong. Try again.',
      }])
    } finally {
      setSending(false)
    }
  }, [messages, sending, token, metricsCtx, activitiesCtx, activeConvId])

  // ── Back to list ─────────────────────────────────────────────────────────

  const goToList = useCallback(() => {
    setView('list')
    setActiveConvId(null)
    setMessages([])
    if (token) loadConversations(token)
  }, [token])

  // ── Render: Chat view ────────────────────────────────────────────────────

  if (view === 'chat') {
    return (
      <main className="min-h-screen bg-gray-950 flex flex-col pb-16">
        {/* Header */}
        <div className="bg-gray-900 border-b border-gray-800 px-4 py-3 flex items-center gap-3">
          <button onClick={goToList} className="text-gray-400 hover:text-white transition-colors p-1">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-5 h-5">
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
            </svg>
          </button>
          <div className="flex-1 min-w-0">
            <h1 className="text-white font-semibold text-sm">AI Coach</h1>
            <p className="text-gray-500 text-xs">
              {contextReady ? 'Live data connected' : 'Loading your stats…'}
            </p>
          </div>
          {/* Live metric pills */}
          <div className="flex items-center gap-1.5 overflow-x-auto scrollbar-none">
            {metricsCtx?.bodyBattery != null && (
              <span className="shrink-0 bg-green-900/40 text-green-400 text-[10px] px-2 py-0.5 rounded-full">🔋{metricsCtx.bodyBattery}</span>
            )}
            {metricsCtx?.hrv != null && (
              <span className="shrink-0 bg-blue-900/40 text-blue-400 text-[10px] px-2 py-0.5 rounded-full">💓{metricsCtx.hrv}ms</span>
            )}
            {metricsCtx?.sleepScore != null && (
              <span className="shrink-0 bg-purple-900/40 text-purple-400 text-[10px] px-2 py-0.5 rounded-full">😴{metricsCtx.sleepScore}</span>
            )}
          </div>
        </div>

        {/* Messages */}
        <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3">
          {msgsLoading && (
            <div className="flex justify-center py-8">
              <span className="w-5 h-5 border-2 border-orange-400 border-t-transparent rounded-full animate-spin" />
            </div>
          )}

          {!msgsLoading && messages.length === 0 && (
            <div className="space-y-4 py-4">
              <div className="bg-gray-900 rounded-2xl p-4">
                <div className="flex items-center gap-2 mb-2">
                  <div className="w-7 h-7 bg-orange-500 rounded-full flex items-center justify-center text-xs font-bold text-white shrink-0">A</div>
                  <p className="text-orange-400 text-xs font-bold uppercase tracking-wider">AI Coach · Qwen3</p>
                </div>
                <p className="text-gray-200 text-sm leading-relaxed">
                  Hey{displayName ? ` ${displayName.split(' ')[0]}` : ''}! I&apos;ve got your latest stats loaded.
                  {memory?.weekly_runs != null ? ` You&apos;ve done ${memory.weekly_runs} run${memory.weekly_runs !== 1 ? 's' : ''} this week.` : ''}
                  {' '}Ask me anything about training, recovery, or what to do today.
                </p>
              </div>
              <div>
                <p className="text-gray-600 text-xs mb-2 px-1">Quick questions</p>
                <div className="flex flex-wrap gap-2">
                  {QUICK_PROMPTS.map(p => (
                    <button key={p} onClick={() => sendMessage(p)}
                      className="bg-gray-800 hover:bg-gray-700 text-gray-300 text-xs px-3 py-2 rounded-xl transition-colors">
                      {p}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}

          {messages.map((msg, i) => (
            <div key={i} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
              {msg.role === 'assistant' && (
                <div className="w-7 h-7 bg-orange-500 rounded-full flex items-center justify-center text-xs font-bold text-white shrink-0 mt-0.5 mr-2">A</div>
              )}
              <div className={`max-w-[80%] rounded-2xl px-4 py-3 text-sm leading-relaxed ${
                msg.role === 'user'
                  ? 'bg-orange-500 text-white rounded-br-sm'
                  : 'bg-gray-800 text-gray-200 rounded-bl-sm'
              }`}>
                {msg.content}
              </div>
            </div>
          ))}

          {sending && (
            <div className="flex justify-start">
              <div className="w-7 h-7 bg-orange-500 rounded-full flex items-center justify-center text-xs font-bold text-white shrink-0 mt-0.5 mr-2">A</div>
              <div className="bg-gray-800 rounded-2xl rounded-bl-sm px-4 py-3">
                <div className="flex gap-1 items-center h-4">
                  <span className="w-1.5 h-1.5 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
                  <span className="w-1.5 h-1.5 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
                  <span className="w-1.5 h-1.5 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
                </div>
              </div>
            </div>
          )}
          <div ref={bottomRef} />
        </div>

        {/* Input */}
        <div className="bg-gray-900 border-t border-gray-800 px-4 py-3">
          <div className="flex gap-2 items-end max-w-2xl mx-auto">
            <textarea
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(input) }
              }}
              placeholder="Ask your coach…"
              rows={1}
              className="flex-1 bg-gray-800 text-white text-sm rounded-xl px-4 py-3 resize-none outline-none placeholder-gray-500 focus:ring-1 focus:ring-orange-500"
            />
            <button
              onClick={() => sendMessage(input)}
              disabled={!input.trim() || sending}
              className="bg-orange-500 hover:bg-orange-400 disabled:opacity-40 text-white rounded-xl p-3 transition-colors shrink-0"
            >
              <svg viewBox="0 0 24 24" fill="currentColor" className="w-5 h-5">
                <path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z" />
              </svg>
            </button>
          </div>
        </div>

        <BottomNav />
      </main>
    )
  }

  // ── Render: List view ────────────────────────────────────────────────────

  return (
    <main className="min-h-screen bg-gray-950 flex flex-col pb-16">
      {/* Header */}
      <div className="bg-gray-900 border-b border-gray-800 px-4 pt-4 pb-3">
        <div className="flex items-center justify-between mb-3">
          <div>
            <h1 className="text-white font-bold text-lg">AI Coach</h1>
            <p className="text-gray-500 text-xs">Powered by Qwen3 · Garmin data</p>
          </div>
          <button
            onClick={startNewChat}
            className="flex items-center gap-1.5 bg-orange-500 hover:bg-orange-400 text-white text-sm font-semibold px-4 py-2 rounded-xl transition-colors"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} className="w-4 h-4">
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
            </svg>
            New Chat
          </button>
        </div>
      </div>

      {/* Memory panel */}
      <div className="bg-gray-900 border-b border-gray-800 px-0 pt-3">
        <MemoryPanel
          facts={memory}
          updatedAt={memoryUpdatedAt}
          onRefresh={refreshMemory}
          refreshing={refreshing}
        />
        {!memory && (
          <div className="px-4 pb-3">
            <button
              onClick={refreshMemory}
              disabled={refreshing}
              className="w-full bg-gray-800 hover:bg-gray-700 text-gray-400 text-sm rounded-xl py-3 transition-colors flex items-center justify-center gap-2"
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}
                className={`w-4 h-4 ${refreshing ? 'animate-spin' : ''}`}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
              </svg>
              {refreshing ? 'Building memory…' : 'Build coach memory from your data'}
            </button>
          </div>
        )}
      </div>

      {/* Conversation list */}
      <div className="flex-1 overflow-y-auto px-4 py-3 space-y-2">
        {convsLoading ? (
          <div className="flex justify-center py-12">
            <span className="w-6 h-6 border-2 border-orange-400 border-t-transparent rounded-full animate-spin" />
          </div>
        ) : conversations.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <div className="w-16 h-16 bg-gray-800 rounded-full flex items-center justify-center mb-4">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} className="w-8 h-8 text-gray-600">
                <path strokeLinecap="round" strokeLinejoin="round" d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
              </svg>
            </div>
            <p className="text-gray-400 text-sm font-medium">No conversations yet</p>
            <p className="text-gray-600 text-xs mt-1">Start a chat to get personalised coaching</p>
            <button
              onClick={startNewChat}
              className="mt-4 bg-orange-500 hover:bg-orange-400 text-white text-sm font-semibold px-6 py-2.5 rounded-xl transition-colors"
            >
              Start your first chat
            </button>
          </div>
        ) : (
          <>
            <p className="text-gray-600 text-xs uppercase tracking-wider font-semibold px-1 pb-1">
              Recent chats — {conversations.length} conversation{conversations.length !== 1 ? 's' : ''}
            </p>
            {conversations.map(conv => (
              <ConvItem
                key={conv.id}
                conv={conv}
                onClick={() => openConversation(conv.id)}
              />
            ))}
          </>
        )}
      </div>

      <BottomNav />
    </main>
  )
}

'use client'

import { useEffect, useRef, useState, useCallback } from 'react'
import { supabase } from '../lib/supabase'

type Message = { role: 'user' | 'assistant'; content: string }

type Metrics = Record<string, unknown>
type ActRow = Record<string, unknown>

type BrainInsight = {
  headline: string
  insight: string
  suggested_focus: string
  readiness_score: number
  readiness_label: 'green' | 'amber' | 'red'
  insight_date: string
}

const STORAGE_KEY = 'coach_memory_v1'
const MAX_MEMORY = 10 // messages to persist

function timeGreeting(): string {
  const h = new Date().getHours()
  if (h < 12) return 'Good morning'
  if (h < 17) return 'Good afternoon'
  return 'Good evening'
}

function suggestedQuestions(metrics: Metrics | null): string[] {
  const qs: string[] = []
  const bb = metrics?.body_battery as number | null
  const hrv = metrics?.hrv as number | null
  const sleep = metrics?.sleep_score as number | null

  if (bb != null && bb < 40) qs.push('My body battery is low — should I still train?')
  if (hrv != null && hrv < 50) qs.push('My HRV is down — what does that mean for today?')
  if (sleep != null && sleep < 65) qs.push('I slept poorly — how should I adjust training?')

  qs.push('What should I do today?')
  qs.push('How is my recovery looking?')
  if (!qs.find(q => q.includes('run'))) qs.push('What type of run should I do today?')
  qs.push('Am I overtraining?')
  qs.push('How can I improve my HRV?')

  return qs.slice(0, 5)
}

function buildContext(metrics: Metrics | null, activities: ActRow[]) {
  const metricsCtx = metrics ? {
    hrv: metrics.hrv as number | null,
    hrvStatus: metrics.hrv_status as string | null,
    sleepScore: metrics.sleep_score as number | null,
    sleepDurationSeconds: metrics.sleep_duration_seconds as number | null,
    deepSleepSeconds: metrics.deep_sleep_seconds as number | null,
    remSleepSeconds: metrics.rem_sleep_seconds as number | null,
    bodyBattery: metrics.body_battery as number | null,
    stress: metrics.stress as number | null,
    restingHr: metrics.resting_hr as number | null,
    respiration: metrics.respiration as number | null,
    spo2: metrics.spo2 as number | null,
    steps: metrics.steps as number | null,
    activeMinutes: metrics.active_minutes as number | null,
    moderateIntensityMinutes: metrics.moderate_intensity_minutes as number | null,
    vigorousIntensityMinutes: metrics.vigorous_intensity_minutes as number | null,
    date: metrics.metric_date as string,
  } : null

  const actsCtx = activities.map(a => {
    const raw = (a.raw_payload ?? {}) as Record<string, unknown>
    const typeKey = (raw.activityType as Record<string, unknown> | undefined)?.typeKey as string | undefined
    const segments = a.treadmill_segments as { start_min: number; end_min: number; incline_pct: number | null; speed_kmh: number | null; description: string }[] | null
    return {
      type: typeKey?.replace(/_/g, ' ') ?? String(a.activity_type ?? 'activity'),
      name: (raw.activityName as string) ?? '',
      date: new Date(a.start_time as string).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' }),
      durationMin: a.duration_sec ? Math.round(Number(a.duration_sec) / 60) : null,
      distanceKm: a.distance_m && Number(a.distance_m) > 100 ? Math.round(Number(a.distance_m) / 100) / 10 : null,
      avgHr: a.avg_hr as number | null,
      calories: a.calories as number | null,
      trainingEffect: a.training_effect as number | null,
      treadmillSegments: segments && segments.length > 0 ? segments : null,
      notes: (a.user_activity_notes as string | null) ?? null,
    }
  })

  return { metricsCtx, actsCtx }
}

export function CoachFAB() {
  const [open, setOpen] = useState(false)
  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [ctxLoading, setCtxLoading] = useState(false)
  const [metrics, setMetrics] = useState<Metrics | null>(null)
  const [activities, setActivities] = useState<ActRow[]>([])
  const [displayName, setDisplayName] = useState('')
  const [greeting, setGreeting] = useState('')
  const [contextReady, setContextReady] = useState(false)
  const [brainInsight, setBrainInsight] = useState<BrainInsight | null>(null)
  const bottomRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  // Load persisted memory on mount
  useEffect(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY)
      if (saved) {
        const parsed = JSON.parse(saved) as Message[]
        setMessages(parsed.slice(-MAX_MEMORY))
      }
    } catch { /* ignore */ }
    setGreeting(timeGreeting())
  }, [])

  // Fetch health context once when modal first opens
  const fetchContext = useCallback(async () => {
    if (contextReady) return
    setCtxLoading(true)

    const { data: session } = await supabase.auth.getSession()
    if (!session.session) { setCtxLoading(false); return }
    const user = session.session.user

    const { data: profile } = await supabase
      .from('profiles').select('display_name, name').eq('user_id', user.id).maybeSingle()
    setDisplayName(profile?.display_name ?? profile?.name ?? '')

    const today = new Date().toISOString().split('T')[0]
    const sevenAgo = new Date(Date.now() - 7 * 86400000).toISOString().split('T')[0]

    const [gh, leg, sl, st, acts] = await Promise.all([
      supabase.from('garmin_daily_health_metrics')
        .select('hrv_avg, hrv_status, respiration_avg_bpm, stress_avg, body_battery_end, spo2_avg')
        .eq('user_id', user.id).eq('metric_date', today).maybeSingle(),
      supabase.from('daily_health_metrics')
        .select('garmin_hrv_nightly_avg, garmin_sleep_score, garmin_body_battery_high, garmin_stress_avg, resting_hr, resting_heart_rate_bpm, steps')
        .eq('user_id', user.id).eq('metric_date', today).maybeSingle(),
      supabase.from('garmin_sleep_data')
        .select('sleep_score, sleep_duration_seconds, deep_sleep_seconds, rem_sleep_seconds')
        .eq('user_id', user.id).gte('sleep_date', sevenAgo)
        .order('sleep_date', { ascending: false }).limit(1).maybeSingle(),
      supabase.from('garmin_daily_steps')
        .select('total_steps, active_minutes, moderate_intensity_minutes, vigorous_intensity_minutes')
        .eq('user_id', user.id).eq('step_date', today).maybeSingle(),
      supabase.from('garmin_activities')
        .select('activity_type, start_time, duration_sec, distance_m, avg_hr, calories, training_effect, raw_payload, treadmill_segments, user_activity_notes')
        .eq('user_id', user.id).gte('start_time', new Date(Date.now() - 7 * 86400000).toISOString())
        .order('start_time', { ascending: false }),
    ])

    const g = gh.data as Record<string, unknown> | null
    const l = leg.data as Record<string, unknown> | null
    const s = sl.data as Record<string, unknown> | null
    const step = st.data as Record<string, unknown> | null

    const merged: Metrics = {
      metric_date: today,
      hrv: g?.hrv_avg ?? l?.garmin_hrv_nightly_avg ?? null,
      hrv_status: g?.hrv_status ?? null,
      sleep_score: s?.sleep_score ?? l?.garmin_sleep_score ?? null,
      sleep_duration_seconds: s?.sleep_duration_seconds ?? null,
      deep_sleep_seconds: s?.deep_sleep_seconds ?? null,
      rem_sleep_seconds: s?.rem_sleep_seconds ?? null,
      body_battery: g?.body_battery_end ?? l?.garmin_body_battery_high ?? null,
      stress: g?.stress_avg ?? l?.garmin_stress_avg ?? null,
      resting_hr: l?.resting_hr ?? l?.resting_heart_rate_bpm ?? null,
      respiration: g?.respiration_avg_bpm ?? null,
      spo2: g?.spo2_avg ?? null,
      steps: step?.total_steps ?? l?.steps ?? null,
      active_minutes: step?.active_minutes ?? null,
      moderate_intensity_minutes: step?.moderate_intensity_minutes ?? null,
      vigorous_intensity_minutes: step?.vigorous_intensity_minutes ?? null,
    }
    setMetrics(merged)
    setActivities((acts.data ?? []) as ActRow[])

    // Fetch today's brain insight (stored from last sync)
    try {
      const { data: insightRow } = await supabase
        .from('daily_insights')
        .select('insight_date, insight_text, readiness_score, readiness_label, suggested_focus, raw_context')
        .eq('user_id', user.id)
        .order('insight_date', { ascending: false })
        .limit(1)
        .maybeSingle()
      if (insightRow) {
        const r = insightRow as {
          insight_date: string; insight_text: string; readiness_score: number
          readiness_label: 'green' | 'amber' | 'red'; suggested_focus: string
          raw_context: { headline?: string } | null
        }
        setBrainInsight({
          headline: r.raw_context?.headline ?? '',
          insight: r.insight_text,
          suggested_focus: r.suggested_focus,
          readiness_score: r.readiness_score,
          readiness_label: r.readiness_label,
          insight_date: r.insight_date,
        })
      }
    } catch { /* brain insight is optional */ }

    setContextReady(true)
    setCtxLoading(false)
  }, [contextReady])

  useEffect(() => {
    if (open) {
      fetchContext()
      setTimeout(() => inputRef.current?.focus(), 300)
    }
  }, [open, fetchContext])

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, loading])

  const sendMessage = async (text: string) => {
    if (!text.trim() || loading) return
    const userMsg: Message = { role: 'user', content: text.trim() }
    const newMessages = [...messages, userMsg]
    setMessages(newMessages)
    setInput('')
    setLoading(true)

    const { metricsCtx, actsCtx } = buildContext(metrics, activities)

    try {
      const res = await fetch('/api/coach/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: newMessages,
          metrics: metricsCtx,
          activities: actsCtx,
          brainInsight: brainInsight ? {
            headline: brainInsight.headline,
            insight: brainInsight.insight,
            suggested_focus: brainInsight.suggested_focus,
            readiness_score: brainInsight.readiness_score,
            readiness_label: brainInsight.readiness_label,
          } : null,
        }),
      })
      const data = await res.json() as { reply?: string; error?: string }
      if (!res.ok) throw new Error(data.error ?? 'Coach unavailable')
      const updated = [...newMessages, { role: 'assistant' as const, content: data.reply! }]
      setMessages(updated)
      // Persist memory
      try { localStorage.setItem(STORAGE_KEY, JSON.stringify(updated.slice(-MAX_MEMORY))) } catch { /* ignore */ }
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Could not reach coach'
      setMessages(m => [...m, { role: 'assistant', content: `⚠️ ${msg}` }])
    }
    setLoading(false)
  }

  const clearMemory = () => {
    setMessages([])
    try { localStorage.removeItem(STORAGE_KEY) } catch { /* ignore */ }
  }

  const suggestions = suggestedQuestions(metrics)
  const hasMessages = messages.length > 0

  return (
    <>
      {/* Floating button — fixed bottom-right, above nav */}
      <button
        onClick={() => setOpen(o => !o)}
        aria-label="Open AI Coach"
        className="fixed z-[60] shadow-2xl transition-transform duration-200 active:scale-95"
        style={{ bottom: '76px', right: '16px' }}
      >
        <div className="w-14 h-14 rounded-full bg-orange-600 flex items-center justify-center shadow-xl ring-2 ring-orange-500/40">
          <svg viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth={2} className="w-7 h-7">
            <path strokeLinecap="round" strokeLinejoin="round" d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
          </svg>
        </div>
        {!open && (
          <span className="absolute inset-0 rounded-full bg-orange-500 opacity-25 animate-ping pointer-events-none" />
        )}
      </button>

      {/* Full-screen modal overlay */}
      {open && (
        <div
          className="fixed inset-0 z-[70] flex items-center justify-center p-4"
          style={{ background: 'rgba(0,0,0,0.75)', backdropFilter: 'blur(4px)' }}
          onClick={() => setOpen(false)}
        >
          {/* Modal panel — sits centred, fills most of the screen on mobile */}
          <div
            className="relative flex flex-col bg-gray-950 rounded-3xl border border-gray-800 shadow-2xl w-full"
            style={{ maxWidth: 480, height: 'min(82vh, 720px)' }}
            onClick={e => e.stopPropagation()}
          >
            {/* Header gradient strip */}
            <div className="flex-shrink-0 rounded-t-3xl px-5 pt-4 pb-3 border-b border-gray-800"
              style={{ background: 'linear-gradient(135deg, #1a0a00 0%, #111827 100%)' }}>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-2xl bg-orange-600 flex items-center justify-center shadow-lg">
                    <svg viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth={2} className="w-5 h-5">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
                    </svg>
                  </div>
                  <div>
                    <p className="text-white font-semibold text-sm leading-tight">AI Coach</p>
                    <p className="text-[10px] mt-0.5">
                      {ctxLoading
                        ? <span className="text-orange-400/70">Loading your stats…</span>
                        : contextReady
                        ? <span className="text-green-400/80">● Live data connected</span>
                        : <span className="text-gray-500">Personal fitness coach</span>}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  {hasMessages && (
                    <button
                      onClick={clearMemory}
                      className="text-gray-500 hover:text-gray-300 text-[10px] px-2.5 py-1 rounded-lg border border-gray-700 hover:border-gray-500 transition-colors"
                    >
                      Clear chat
                    </button>
                  )}
                  <button
                    onClick={() => setOpen(false)}
                    className="w-8 h-8 flex items-center justify-center rounded-xl bg-gray-800/60 hover:bg-gray-700 text-gray-400 hover:text-white transition-colors"
                  >
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-4 h-4">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                </div>
              </div>
            </div>

            {/* Messages scroll area */}
            <div className="flex-1 overflow-y-auto px-4 py-4 space-y-3 min-h-0">
              {/* Greeting + brain insight */}
              {!hasMessages && (
                <div className="space-y-3">
                  <div className="flex gap-2.5">
                    <div className="w-7 h-7 rounded-xl bg-orange-600/20 border border-orange-600/30 flex items-center justify-center flex-shrink-0 mt-0.5">
                      <svg viewBox="0 0 24 24" fill="none" stroke="#f97316" strokeWidth={2} className="w-3.5 h-3.5">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
                      </svg>
                    </div>
                    <div className="flex-1">
                      <div className="bg-gray-800/70 rounded-2xl rounded-tl-sm px-4 py-3">
                        <p className="text-white text-sm font-medium">
                          {greeting}{displayName ? `, ${displayName}` : ''}! 👋
                        </p>

                        {ctxLoading ? (
                          <div className="flex items-center gap-2 mt-2">
                            <div className="flex gap-1">
                              <span className="w-1.5 h-1.5 bg-orange-400 rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
                              <span className="w-1.5 h-1.5 bg-orange-400 rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
                              <span className="w-1.5 h-1.5 bg-orange-400 rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
                            </div>
                            <span className="text-gray-400 text-xs">Loading your stats…</span>
                          </div>
                        ) : brainInsight ? (
                          <div className={`mt-3 rounded-xl p-3 border ${
                            brainInsight.readiness_label === 'green' ? 'border-green-500/30 bg-green-950/40' :
                            brainInsight.readiness_label === 'amber' ? 'border-orange-500/30 bg-orange-950/40' :
                            'border-red-500/30 bg-red-950/40'
                          }`}>
                            <div className="flex items-center gap-1.5 mb-1.5">
                              <span className={`w-2 h-2 rounded-full flex-shrink-0 ${
                                brainInsight.readiness_label === 'green' ? 'bg-green-400' :
                                brainInsight.readiness_label === 'amber' ? 'bg-orange-400' : 'bg-red-400'
                              }`} />
                              <span className={`text-[10px] font-bold uppercase tracking-wider ${
                                brainInsight.readiness_label === 'green' ? 'text-green-400' :
                                brainInsight.readiness_label === 'amber' ? 'text-orange-400' : 'text-red-400'
                              }`}>
                                {brainInsight.readiness_label === 'green' ? 'In the Green' :
                                 brainInsight.readiness_label === 'amber' ? 'Amber — Moderate Day' : 'Red — Rest Day'}
                                {' '}· {brainInsight.readiness_score}/100
                              </span>
                            </div>
                            {brainInsight.headline && (
                              <p className="text-white text-xs font-semibold leading-snug mb-1">{brainInsight.headline}</p>
                            )}
                            <p className="text-gray-300 text-xs leading-relaxed">{brainInsight.insight}</p>
                            {brainInsight.suggested_focus && (
                              <p className="text-gray-400 text-[11px] mt-2 pt-2 border-t border-white/10">
                                <span className="text-gray-500">Focus: </span>{brainInsight.suggested_focus}
                              </p>
                            )}
                          </div>
                        ) : (
                          <p className="text-gray-400 text-sm mt-1">
                            {(() => {
                              const bb = metrics?.body_battery as number | null
                              const hrv = metrics?.hrv as number | null
                              const bits: string[] = []
                              if (bb != null) bits.push(`Body Battery ${bb}%`)
                              if (hrv != null) bits.push(`HRV ${hrv}ms`)
                              return bits.length > 0
                                ? `Stats loaded — ${bits.slice(0, 2).join(', ')}. What would you like to know?`
                                : "I'm ready to help with your training. What would you like to know?"
                            })()}
                          </p>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Suggested questions */}
                  {!ctxLoading && (
                    <div className="flex flex-wrap gap-2 pl-9">
                      {suggestions.map(q => (
                        <button
                          key={q}
                          onClick={() => sendMessage(q)}
                          className="text-xs px-3 py-1.5 rounded-full border border-orange-600/40 text-orange-400 bg-orange-950/20 hover:bg-orange-600/20 transition-colors"
                        >
                          {q}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {/* Chat history */}
              {messages.map((m, i) => (
                <div key={i} className={`flex gap-2.5 ${m.role === 'user' ? 'flex-row-reverse' : ''}`}>
                  {m.role === 'assistant' && (
                    <div className="w-7 h-7 rounded-xl bg-orange-600/20 border border-orange-600/30 flex items-center justify-center flex-shrink-0 mt-0.5">
                      <svg viewBox="0 0 24 24" fill="none" stroke="#f97316" strokeWidth={2} className="w-3.5 h-3.5">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
                      </svg>
                    </div>
                  )}
                  <div
                    className={`max-w-[80%] rounded-2xl px-4 py-2.5 text-sm leading-relaxed ${
                      m.role === 'user'
                        ? 'bg-orange-600 text-white rounded-br-sm'
                        : 'bg-gray-800/80 text-gray-100 rounded-tl-sm'
                    }`}
                  >
                    {m.content}
                  </div>
                </div>
              ))}

              {/* Loading dots */}
              {loading && (
                <div className="flex gap-2.5">
                  <div className="w-7 h-7 rounded-xl bg-orange-600/20 border border-orange-600/30 flex items-center justify-center flex-shrink-0">
                    <svg viewBox="0 0 24 24" fill="none" stroke="#f97316" strokeWidth={2} className="w-3.5 h-3.5">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
                    </svg>
                  </div>
                  <div className="bg-gray-800/80 rounded-2xl rounded-tl-sm px-4 py-3">
                    <div className="flex gap-1 items-center">
                      <span className="w-1.5 h-1.5 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
                      <span className="w-1.5 h-1.5 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
                      <span className="w-1.5 h-1.5 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
                    </div>
                  </div>
                </div>
              )}

              {/* Follow-up chips */}
              {hasMessages && messages[messages.length - 1]?.role === 'assistant' && !loading && (
                <div className="flex flex-wrap gap-2 pl-9 pt-1">
                  {['Tell me more', 'What about tomorrow?', 'Give me a workout plan'].map(q => (
                    <button
                      key={q}
                      onClick={() => sendMessage(q)}
                      className="text-xs px-3 py-1.5 rounded-full border border-gray-700 text-gray-400 hover:border-orange-600/50 hover:text-orange-400 transition-colors"
                    >
                      {q}
                    </button>
                  ))}
                </div>
              )}

              <div ref={bottomRef} />
            </div>

            {/* Input bar */}
            <div className="flex-shrink-0 px-4 pb-4 pt-3 border-t border-gray-800 rounded-b-3xl bg-gray-950/90">
              <div className="flex gap-2 items-center">
                <input
                  ref={inputRef}
                  type="text"
                  value={input}
                  onChange={e => setInput(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(input) } }}
                  placeholder="Ask your coach anything…"
                  className="flex-1 bg-gray-800 text-white text-sm rounded-2xl px-4 py-3 outline-none focus:ring-2 focus:ring-orange-500 placeholder-gray-600 resize-none"
                />
                <button
                  onClick={() => sendMessage(input)}
                  disabled={!input.trim() || loading}
                  className="w-11 h-11 rounded-full bg-orange-600 flex items-center justify-center disabled:opacity-40 transition-opacity flex-shrink-0"
                >
                  <svg viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth={2.5} className="w-5 h-5">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 19V5M5 12l7-7 7 7" />
                  </svg>
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  )
}

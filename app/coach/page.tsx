'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '../../lib/supabase'
import { BottomNav } from '../../components/BottomNav'

type Message = { role: 'user' | 'assistant'; content: string }

const QUICK_PROMPTS = [
  "What should I do today?",
  "Am I overtraining?",
  "How's my recovery looking?",
  "What type of run should I do today?",
  "Should I do strength or cardio today?",
  "How can I improve my HRV?",
]

export default function CoachPage() {
  const router = useRouter()
  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [contextLoading, setContextLoading] = useState(true)
  const [metrics, setMetrics] = useState<Record<string, unknown> | null>(null)
  const [activities, setActivities] = useState<Record<string, unknown>[]>([])
  const [displayName, setDisplayName] = useState('')
  const bottomRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const load = async () => {
      const { data } = await supabase.auth.getSession()
      if (!data.session) { router.push('/login'); return }
      const user = data.session.user

      const { data: profile } = await supabase
        .from('profiles')
        .select('display_name, name')
        .eq('user_id', user.id)
        .maybeSingle()
      setDisplayName(profile?.display_name ?? profile?.name ?? '')

      // Fetch today's metrics
      const today = new Date().toISOString().split('T')[0]
      const { data: m } = await supabase
        .from('daily_health_metrics')
        .select('metric_date, garmin_hrv_nightly_avg, garmin_sleep_score, sleep_minutes, garmin_body_battery_high, garmin_stress_avg, resting_hr, resting_heart_rate_bpm, steps')
        .eq('user_id', user.id)
        .eq('metric_date', today)
        .maybeSingle()
      setMetrics(m ?? null)

      // Fetch last 7 days of activities
      const weekAgo = new Date()
      weekAgo.setDate(weekAgo.getDate() - 7)
      const { data: acts } = await supabase
        .from('garmin_activities')
        .select('activity_type, start_time, duration_sec, distance_m, avg_hr, calories, training_effect, raw_payload')
        .eq('user_id', user.id)
        .gte('start_time', weekAgo.toISOString())
        .order('start_time', { ascending: false })
      setActivities((acts ?? []) as Record<string, unknown>[])
      setContextLoading(false)
    }
    load()
  }, [router])

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, loading])

  const buildContext = () => {
    const metricsCtx = metrics ? {
      hrv: metrics.garmin_hrv_nightly_avg as number | null,
      sleepScore: metrics.garmin_sleep_score as number | null,
      sleepMinutes: metrics.sleep_minutes as number | null,
      bodyBattery: metrics.garmin_body_battery_high as number | null,
      stress: metrics.garmin_stress_avg as number | null,
      restingHr: (metrics.resting_hr ?? metrics.resting_heart_rate_bpm) as number | null,
      steps: metrics.steps as number | null,
      date: metrics.metric_date as string,
    } : null

    const actsCtx = activities.map(a => {
      const raw = (a.raw_payload ?? {}) as Record<string, unknown>
      const typeKey = (raw.activityType as Record<string, unknown> | undefined)?.typeKey as string | undefined
      return {
        type: typeKey?.replace(/_/g, ' ') ?? String(a.activity_type ?? 'activity'),
        name: raw.activityName as string ?? '',
        date: new Date(a.start_time as string).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' }),
        durationMin: a.duration_sec ? Math.round(Number(a.duration_sec) / 60) : null,
        distanceKm: a.distance_m && Number(a.distance_m) > 100 ? Math.round(Number(a.distance_m) / 100) / 10 : null,
        avgHr: a.avg_hr as number | null,
        calories: a.calories as number | null,
        trainingEffect: a.training_effect as number | null,
      }
    })

    return { metricsCtx, actsCtx }
  }

  const sendMessage = async (text: string) => {
    if (!text.trim() || loading) return
    const userMsg: Message = { role: 'user', content: text.trim() }
    const newMessages = [...messages, userMsg]
    setMessages(newMessages)
    setInput('')
    setLoading(true)

    const { metricsCtx, actsCtx } = buildContext()

    try {
      const res = await fetch('/api/coach/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: newMessages,
          metrics: metricsCtx,
          activities: actsCtx,
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? 'Coach unavailable')
      setMessages(m => [...m, { role: 'assistant', content: data.reply }])
    } catch (e: unknown) {
      setMessages(m => [...m, { role: 'assistant', content: e instanceof Error ? e.message : 'Something went wrong. Try again.' }])
    } finally {
      setLoading(false)
    }
  }

  return (
    <main className="min-h-screen bg-gray-950 flex flex-col pb-16">
      {/* Header */}
      <div className="bg-gray-900 border-b border-gray-800 px-4 py-4 flex items-center justify-between">
        <div>
          <h1 className="text-white font-bold text-lg">AI Coach</h1>
          <p className="text-gray-500 text-xs">Powered by your Garmin data</p>
        </div>
        {displayName && <p className="text-gray-500 text-sm">{displayName}</p>}
      </div>

      {/* Context status */}
      {!contextLoading && (
        <div className="px-4 py-2 flex gap-2 flex-wrap">
          {metrics ? (
            <>
              {(metrics.garmin_body_battery_high as number | null) != null && (
                <span className="bg-green-900/40 text-green-400 text-xs px-2 py-1 rounded-full">
                  🔋 Battery {metrics.garmin_body_battery_high as number}
                </span>
              )}
              {(metrics.garmin_hrv_nightly_avg as number | null) != null && (
                <span className="bg-blue-900/40 text-blue-400 text-xs px-2 py-1 rounded-full">
                  💓 HRV {metrics.garmin_hrv_nightly_avg as number}ms
                </span>
              )}
              {(metrics.garmin_sleep_score as number | null) != null && (
                <span className="bg-purple-900/40 text-purple-400 text-xs px-2 py-1 rounded-full">
                  😴 Sleep {metrics.garmin_sleep_score as number}
                </span>
              )}
            </>
          ) : (
            <span className="text-gray-600 text-xs">No metrics today — coach will use recent activity data</span>
          )}
          {activities.length > 0 && (
            <span className="bg-orange-900/40 text-orange-400 text-xs px-2 py-1 rounded-full">
              ⚡ {activities.length} recent activities
            </span>
          )}
        </div>
      )}

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-4 py-2 space-y-3">
        {messages.length === 0 && !contextLoading && (
          <div className="space-y-4 py-4">
            <div className="bg-gray-900 rounded-2xl p-4">
              <div className="flex items-center gap-2 mb-2">
                <div className="w-7 h-7 bg-orange-500 rounded-full flex items-center justify-center text-xs font-bold text-white shrink-0">A</div>
                <p className="text-orange-400 text-xs font-bold uppercase tracking-wider">AI Coach</p>
              </div>
              <p className="text-gray-200 text-sm leading-relaxed">
                Hey {displayName ? displayName.split(' ')[0] : 'there'}! I&apos;ve loaded your latest Garmin data. Ask me anything about your training, recovery, or what you should do today.
              </p>
            </div>

            {/* Quick prompts */}
            <div>
              <p className="text-gray-600 text-xs mb-2 px-1">Quick questions</p>
              <div className="flex flex-wrap gap-2">
                {QUICK_PROMPTS.map(p => (
                  <button
                    key={p}
                    onClick={() => sendMessage(p)}
                    className="bg-gray-800 hover:bg-gray-700 text-gray-300 text-xs px-3 py-2 rounded-xl transition-colors"
                  >
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

        {loading && (
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
      <div className="bg-gray-900 border-t border-gray-800 px-4 py-3 pb-safe">
        <div className="flex gap-2 items-end max-w-2xl mx-auto">
          <textarea
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault()
                sendMessage(input)
              }
            }}
            placeholder="Ask your coach..."
            rows={1}
            className="flex-1 bg-gray-800 text-white text-sm rounded-xl px-4 py-3 resize-none outline-none placeholder-gray-500 focus:ring-1 focus:ring-orange-500"
          />
          <button
            onClick={() => sendMessage(input)}
            disabled={!input.trim() || loading}
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

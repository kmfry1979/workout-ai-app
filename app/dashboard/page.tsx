'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '../../lib/supabase'
import { BottomNav } from '../../components/BottomNav'

type DailyMetrics = {
  metric_date: string
  steps: number | null
  sleep_minutes: number | null
  resting_hr: number | null
  resting_heart_rate_bpm: number | null
  pulse_ox: number | null
  garmin_spo2_avg: number | null
  garmin_hrv_nightly_avg: number | null
  garmin_hrv_status: string | null
  garmin_sleep_score: number | null
  garmin_body_battery_high: number | null
  garmin_body_battery_eod: number | null
  garmin_stress_avg: number | null
  active_calories_kcal: number | null
  calories: number | null
  distance_m: number | null
}

type SleepData = {
  sleep_date: string
  sleep_duration_seconds: number | null
  sleep_score: number | null
  sleep_quality_score: number | null
  awake_seconds: number | null
  light_sleep_seconds: number | null
  deep_sleep_seconds: number | null
  rem_sleep_seconds: number | null
  avg_spO2: number | null
  avg_heart_rate_bpm: number | null
  sleep_start: string | null
  sleep_end: string | null
}

type DailyHealthMetrics = {
  metric_date: string
  body_battery_start: number | null
  body_battery_end: number | null
  body_battery_peak: number | null
  body_battery_low: number | null
  stress_avg: number | null
  stress_max: number | null
  hrv_avg: number | null
  hrv_status: string | null
  respiration_avg_bpm: number | null
  spo2_avg: number | null
  hydration_intake_ml: number | null
  hydration_goal_ml: number | null
  hydration_remaining_ml: number | null
}

type DailySteps = {
  step_date: string
  total_steps: number | null
  total_distance_meters: number | null
  total_calories: number | null
  active_minutes: number | null
}

type ActivitySummary = {
  duration_sec: number | null
  activity_type: string | null
  start_time: string
}

function clamp(val: number, min: number, max: number) {
  return Math.max(min, Math.min(max, val))
}

function computeScores(m: DailyMetrics, recentActivities: ActivitySummary[]) {
  const hrv = m.garmin_hrv_nightly_avg
  const sleepScore = m.garmin_sleep_score
  const sleepMin = m.sleep_minutes
  const rhr = m.resting_hr ?? m.resting_heart_rate_bpm
  const spo2 = m.pulse_ox ?? m.garmin_spo2_avg

  // Total exercise minutes today
  const exerciseMin = recentActivities
    .filter(a => {
      const d = new Date(a.start_time)
      const today = new Date()
      return d.toDateString() === today.toDateString()
    })
    .reduce((s, a) => s + (a.duration_sec ?? 0) / 60, 0)

  const hrvScore = hrv != null ? clamp(((hrv - 20) / 60) * 100, 0, 100) : null
  const sleep = sleepScore ?? (sleepMin != null ? clamp((sleepMin / 480) * 100, 0, 100) : null)
  const hrScore = rhr != null ? clamp(((80 - rhr) / 40) * 100, 0, 100) : null
  const spo2Score = spo2 != null ? clamp(((spo2 - 90) / 10) * 100, 0, 100) : null
  const loadScore = exerciseMin > 0 ? clamp(100 - (exerciseMin - 30) * 0.5, 40, 100) : 85

  const scores = [hrvScore, sleep, hrScore, spo2Score, loadScore].filter(s => s != null) as number[]
  const readiness = scores.length > 0
    ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length)
    : null

  return {
    readiness,
    radar: {
      hrv: Math.round(hrvScore ?? 0),
      sleep: Math.round(sleep ?? 0),
      heartRate: Math.round(hrScore ?? 0),
      spo2: Math.round(spo2Score ?? 0),
      load: Math.round(loadScore),
    },
    keyFactor: getKeyFactor({ hrv: hrvScore, sleep, heartRate: hrScore, spo2: spo2Score }),
    exerciseMin: Math.round(exerciseMin),
  }
}

function getKeyFactor(scores: Record<string, number | null>) {
  const labels: Record<string, string> = {
    hrv: 'HRV variability',
    sleep: 'Sleep quality',
    heartRate: 'Resting heart rate',
    spo2: 'Blood oxygen',
  }
  let lowest: string | null = null
  let lowestVal = Infinity
  for (const [k, v] of Object.entries(scores)) {
    if (v != null && v < lowestVal) { lowestVal = v; lowest = k }
  }
  return lowest ? labels[lowest] : null
}

function readinessLabel(score: number) {
  if (score >= 85) return 'Excellent'
  if (score >= 70) return 'Good'
  if (score >= 55) return 'Moderate'
  if (score >= 40) return 'Low'
  return 'Poor'
}

function readinessColor(score: number) {
  if (score >= 85) return '#22c55e'
  if (score >= 70) return '#84cc16'
  if (score >= 55) return '#eab308'
  return '#ef4444'
}

function RadarBar({ label, value, icon }: { label: string; value: number; icon: string }) {
  const color = value >= 70 ? '#22c55e' : value >= 45 ? '#eab308' : '#ef4444'
  return (
    <div className="flex items-center gap-3">
      <span className="text-base w-5">{icon}</span>
      <span className="text-sm text-gray-300 w-24 shrink-0">{label}</span>
      <div className="flex-1 bg-gray-700 rounded-full h-2">
        <div
          className="h-2 rounded-full transition-all duration-500"
          style={{ width: `${value}%`, backgroundColor: color }}
        />
      </div>
      <span className="text-sm font-bold w-8 text-right" style={{ color }}>{value}</span>
    </div>
  )
}

function StatCard({ label, value, icon }: { label: string; value: string; icon: string }) {
  return (
    <div className="bg-gray-800 rounded-2xl p-4">
      <div className="flex items-center gap-2 text-gray-400 text-xs mb-2">
        <span>{icon}</span> {label}
      </div>
      <p className="text-2xl font-bold text-white">{value}</p>
    </div>
  )
}

function getGreeting() {
  const h = new Date().getHours()
  if (h < 12) return 'Good morning'
  if (h < 17) return 'Good afternoon'
  return 'Good evening'
}

export default function DashboardPage() {
  const router = useRouter()
  const [loading, setLoading] = useState(true)
  const [displayName, setDisplayName] = useState('')
  const [metrics, setMetrics] = useState<DailyMetrics | null>(null)
  const [sleepData, setSleepData] = useState<SleepData | null>(null)
  const [dailyHealth, setDailyHealth] = useState<DailyHealthMetrics | null>(null)
  const [dailySteps, setDailySteps] = useState<DailySteps | null>(null)
  const [activities, setActivities] = useState<ActivitySummary[]>([])
  const [aiExpanded, setAiExpanded] = useState(false)
  const [aiLoading, setAiLoading] = useState(false)
  const [aiInsight, setAiInsight] = useState<string | null>(null)

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
      setDisplayName(profile?.display_name ?? profile?.name ?? user.email ?? '')

      const today = new Date().toISOString().split('T')[0]

      // Load daily health metrics (existing table)
      const { data: m } = await supabase
        .from('daily_health_metrics')
        .select(`metric_date, steps, sleep_minutes, resting_hr, resting_heart_rate_bpm,
          pulse_ox, garmin_spo2_avg, garmin_hrv_nightly_avg, garmin_hrv_status,
          garmin_sleep_score, garmin_body_battery_high, garmin_body_battery_eod,
          garmin_stress_avg, active_calories_kcal, calories, distance_m`)
        .eq('user_id', user.id)
        .eq('metric_date', today)
        .maybeSingle()

      setMetrics(m as DailyMetrics | null)

      // Load detailed sleep data
      const { data: sleep } = await supabase
        .from('garmin_sleep_data')
        .select(`sleep_date, sleep_duration_seconds, sleep_score, sleep_quality_score,
          awake_seconds, light_sleep_seconds, deep_sleep_seconds, rem_sleep_seconds,
          avg_spO2, avg_heart_rate_bpm, sleep_start, sleep_end`)
        .eq('user_id', user.id)
        .eq('sleep_date', today)
        .maybeSingle()

      setSleepData(sleep as SleepData | null)

      // Load extended daily health metrics
      const { data: health } = await supabase
        .from('garmin_daily_health_metrics')
        .select(`metric_date, body_battery_start, body_battery_end, body_battery_peak,
          body_battery_low, stress_avg, stress_max, hrv_avg, hrv_status,
          respiration_avg_bpm, spo2_avg, hydration_intake_ml, hydration_goal_ml`)
        .eq('user_id', user.id)
        .eq('metric_date', today)
        .maybeSingle()

      setDailyHealth(health as DailyHealthMetrics | null)

      // Load daily steps
      const { data: steps } = await supabase
        .from('garmin_daily_steps')
        .select(`step_date, total_steps, total_distance_meters, total_calories, active_minutes`)
        .eq('user_id', user.id)
        .eq('step_date', today)
        .maybeSingle()

      setDailySteps(steps as DailySteps | null)

      const weekAgo = new Date(Date.now() - 7 * 86400000).toISOString()
      const { data: acts } = await supabase
        .from('garmin_activities')
        .select('duration_sec, activity_type, start_time')
        .eq('user_id', user.id)
        .gte('start_time', weekAgo)
        .order('start_time', { ascending: false })

      setActivities((acts ?? []) as ActivitySummary[])
      setLoading(false)
    }
    load()
  }, [router])

  if (loading) {
    return (
      <main className="min-h-screen bg-gray-950 flex items-center justify-center">
        <p className="text-gray-400">Loading...</p>
      </main>
    )
  }

  const fetchAIInsight = async () => {
    if (aiInsight || aiLoading) return
    setAiLoading(true)
    try {
      const today = new Date().toISOString().split('T')[0]
      const stepsVal = dailySteps?.total_steps ?? metrics?.steps ?? null
      const bodyBatteryEnd = dailyHealth?.body_battery_end ?? metrics?.garmin_body_battery_eod ?? null

      const recentActs = activities.slice(0, 7).map(a => ({
        type: a.activity_type?.replace(/_/g, ' ') ?? 'activity',
        durationMin: a.duration_sec ? Math.round(a.duration_sec / 60) : null,
        distanceKm: null as number | null,
        avgHr: null as number | null,
        calories: null as number | null,
        trainingEffect: null as number | null,
        date: new Date(a.start_time).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' }),
      }))

      const readinessScore = metrics ? computeScores(metrics, activities).readiness : null
      const readinessLbl = readinessScore != null ? readinessLabel(readinessScore) : null

      const res = await fetch('/api/ai/snapshot', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          metrics: {
            hrv: dailyHealth?.hrv_avg ?? metrics?.garmin_hrv_nightly_avg ?? null,
            hrvStatus: dailyHealth?.hrv_status ?? metrics?.garmin_hrv_status ?? null,
            sleepScore: sleepData?.sleep_score ?? metrics?.garmin_sleep_score ?? null,
            sleepDurationSeconds: sleepData?.sleep_duration_seconds ?? (metrics?.sleep_minutes != null ? metrics.sleep_minutes * 60 : null),
            deepSeconds: sleepData?.deep_sleep_seconds ?? null,
            remSeconds: sleepData?.rem_sleep_seconds ?? null,
            bodyBatteryHigh: dailyHealth?.body_battery_peak ?? metrics?.garmin_body_battery_high ?? null,
            bodyBatteryLow: dailyHealth?.body_battery_low ?? null,
            bodyBatteryEnd: bodyBatteryEnd,
            stressAvg: dailyHealth?.stress_avg ?? metrics?.garmin_stress_avg ?? null,
            stressMax: dailyHealth?.stress_max ?? null,
            restingHr: metrics?.resting_hr ?? metrics?.resting_heart_rate_bpm ?? null,
            steps: stepsVal,
            stepGoal: null,
            spo2: dailyHealth?.spo2_avg ?? metrics?.garmin_spo2_avg ?? metrics?.pulse_ox ?? null,
            respirationAwake: dailyHealth?.respiration_avg_bpm ?? null,
            respirationSleep: null,
            intensityMinutes: null,
            intensityGoal: null,
            readinessScore,
            readinessLabel: readinessLbl,
            date: today,
          },
          activities: recentActs,
        }),
      })

      const data = await res.json()
      if (res.ok && data.insight) {
        setAiInsight(data.insight)
      } else {
        setAiInsight('Could not generate insight. Check your Groq API key is set in Vercel.')
      }
    } catch {
      setAiInsight('Could not reach the AI. Please try again.')
    } finally {
      setAiLoading(false)
    }
  }

  const scores = metrics ? computeScores(metrics, activities) : null
  const readiness = scores?.readiness ?? null
  const color = readiness != null ? readinessColor(readiness) : '#6b7280'
  const today = new Date()
  const dateStr = today.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })

  const sleepHours = sleepData?.sleep_duration_seconds
    ? `${Math.floor(sleepData.sleep_duration_seconds / 3600)}h ${Math.floor((sleepData.sleep_duration_seconds % 3600) / 60)}m`
    : metrics?.sleep_minutes
    ? `${Math.floor(metrics.sleep_minutes / 60)}h ${metrics.sleep_minutes % 60}m`
    : '—'
  const stepsVal = dailySteps?.total_steps ?? metrics?.steps
  const steps = stepsVal ? `${(stepsVal / 1000).toFixed(1)}k` : '—'
  const cals = metrics?.active_calories_kcal ?? metrics?.calories
  const calStr = cals ? Math.round(cals) + ' kcal' : '—'
  const distKm = dailySteps?.total_distance_meters
    ? (dailySteps.total_distance_meters / 1000).toFixed(1) + ' km'
    : metrics?.distance_m
    ? (metrics.distance_m / 1000).toFixed(1) + ' km'
    : '—'

  const todayActivities = activities.filter(a => {
    const d = new Date(a.start_time)
    return d.toDateString() === today.toDateString()
  })
  const exerciseStr = scores?.exerciseMin ? `${scores.exerciseMin} min` : '—'

  return (
    <main className="min-h-screen bg-gray-950 p-4 md:p-8 pb-24">
      <div className="mx-auto max-w-2xl space-y-4">

        {/* Header */}
        <div className="flex items-start justify-between">
          <div>
            <p className="text-gray-400 text-sm">{dateStr}</p>
            <h1 className="text-2xl font-bold text-white mt-1">
              {getGreeting()}{displayName ? `, ${displayName.split(' ')[0]}` : ''}
            </h1>
          </div>
          <div className="flex gap-2">
            <a href="/activities" className="text-xs bg-gray-800 text-gray-300 px-3 py-1.5 rounded-lg">
              Activities
            </a>
            <button
              onClick={async () => { await supabase.auth.signOut(); router.push('/login') }}
              className="text-xs bg-gray-800 text-gray-400 px-3 py-1.5 rounded-lg"
            >
              Sign out
            </button>
          </div>
        </div>

        {/* Readiness card */}
        <div className="bg-gray-900 rounded-3xl p-6">
          <div className="flex items-center gap-6">
            {/* Circle */}
            <div className="relative shrink-0">
              <svg width="100" height="100" viewBox="0 0 100 100">
                <circle cx="50" cy="50" r="42" fill="none" stroke="#374151" strokeWidth="8" />
                {readiness != null && (
                  <circle
                    cx="50" cy="50" r="42" fill="none"
                    stroke={color} strokeWidth="8"
                    strokeLinecap="round"
                    strokeDasharray={`${(readiness / 100) * 263.9} 263.9`}
                    transform="rotate(-90 50 50)"
                  />
                )}
                <text x="50" y="46" textAnchor="middle" fill="white" fontSize="22" fontWeight="bold">
                  {readiness ?? '—'}
                </text>
                <text x="50" y="62" textAnchor="middle" fill="#9ca3af" fontSize="9">
                  READY
                </text>
              </svg>
            </div>

            {/* Label + key factor */}
            <div>
              <p className="text-xs text-gray-500 uppercase tracking-wider mb-1">Readiness</p>
              <p className="text-2xl font-bold text-white">
                {readiness != null ? readinessLabel(readiness) : 'No data'}
              </p>
              {scores?.keyFactor && (
                <>
                  <p className="text-xs text-gray-500 mt-2">Key factor</p>
                  <p className="text-sm font-medium mt-0.5" style={{ color }}>
                    {scores.keyFactor}
                  </p>
                </>
              )}
              {metrics?.garmin_hrv_status && (
                <span className="mt-2 inline-block text-xs bg-gray-800 text-gray-300 px-2 py-0.5 rounded-full">
                  HRV {metrics.garmin_hrv_status}
                </span>
              )}
            </div>
          </div>

          {/* Radar bars */}
          {scores && (
            <div className="mt-6 space-y-3">
              <p className="text-xs text-gray-500 uppercase tracking-wider mb-3">Readiness Radar</p>
              <RadarBar label="HRV" value={scores.radar.hrv} icon="💚" />
              <RadarBar label="Sleep" value={scores.radar.sleep} icon="🌙" />
              <RadarBar label="Heart Rate" value={scores.radar.heartRate} icon="❤️" />
              <RadarBar label="SpO2" value={scores.radar.spo2} icon="🩸" />
              <RadarBar label="Load" value={scores.radar.load} icon="⚡" />
              <p className="text-xs text-gray-600 text-right mt-1">
                {[scores.radar.hrv, scores.radar.sleep, scores.radar.heartRate, scores.radar.spo2, scores.radar.load]
                  .filter(v => v >= 70).length} of 5 metrics in good range
              </p>
            </div>
          )}
        </div>

        {/* AI Insights Section */}
        <div className="bg-gradient-to-r from-orange-900/40 to-purple-900/40 rounded-3xl p-6 border border-orange-500/20">
          <button
            onClick={() => {
              const next = !aiExpanded
              setAiExpanded(next)
              if (next && !aiInsight && !aiLoading) fetchAIInsight()
            }}
            className="w-full flex items-center justify-between"
          >
            <div className="flex items-center gap-3">
              <span className="text-2xl">✨</span>
              <div className="text-left">
                <p className="text-sm font-bold text-white">AI Insights</p>
                <p className="text-xs text-gray-400">Personalized analysis & recommendations</p>
              </div>
            </div>
            <svg
              className={`w-6 h-6 text-gray-400 transition-transform ${aiExpanded ? 'rotate-180' : ''}`}
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
            </svg>
          </button>

          {aiExpanded && (
            <div className="mt-4 pt-4 border-t border-orange-500/20">
              {aiLoading ? (
                <div className="space-y-2">
                  <div className="h-3 bg-orange-900/40 rounded animate-pulse w-3/4" />
                  <div className="h-3 bg-orange-900/40 rounded animate-pulse w-full" />
                  <div className="h-3 bg-orange-900/40 rounded animate-pulse w-5/6" />
                  <div className="h-3 bg-orange-900/40 rounded animate-pulse w-2/3" />
                  <p className="text-xs text-gray-500 mt-2">Analysing your metrics...</p>
                </div>
              ) : aiInsight ? (
                <div className="text-sm text-gray-200 leading-relaxed space-y-2">
                  {aiInsight.split('\n').map((line, i) => {
                    const boldMatch = line.match(/^\*\*(.+?)\*\*(.*)/)
                    if (boldMatch) {
                      return (
                        <p key={i} className="mt-3 first:mt-0">
                          <span className="font-bold text-white">{boldMatch[1]}</span>
                          <span className="text-gray-300">{boldMatch[2]}</span>
                        </p>
                      )
                    }
                    if (line.startsWith('•') || line.startsWith('-')) {
                      return <p key={i} className="pl-3 text-gray-300">{line}</p>
                    }
                    return line.trim() ? <p key={i} className="text-gray-300">{line}</p> : null
                  })}
                </div>
              ) : (
                <p className="text-gray-500 text-sm">Tap above to generate your AI snapshot.</p>
              )}
            </div>
          )}
        </div>

        {/* Quick stats */}
        <div className="grid grid-cols-2 gap-3">
          <StatCard label="Sleep" value={sleepHours} icon="🌙" />
          <StatCard label="Steps" value={steps} icon="🦶" />
          <StatCard label="Exercise" value={exerciseStr} icon="🏃" />
          <StatCard label="Active Cal" value={calStr} icon="🔥" />
        </div>

        {/* Daily Steps - detailed, shown prominently after quick stats */}
        {(dailySteps?.total_steps != null || metrics?.steps != null) && (() => {
          const totalSteps = dailySteps?.total_steps ?? metrics?.steps ?? 0
          const distKmSteps = dailySteps?.total_distance_meters
            ? (dailySteps.total_distance_meters / 1000).toFixed(1)
            : metrics?.distance_m
            ? (metrics.distance_m / 1000).toFixed(1)
            : null
          return (
            <div className="bg-gray-900 rounded-2xl p-4">
              <div className="flex items-center justify-between mb-3">
                <div>
                  <p className="text-xs text-gray-500 uppercase tracking-wider">Daily Steps</p>
                  <p className="text-3xl font-bold text-white mt-1">
                    {totalSteps.toLocaleString()}
                  </p>
                  {distKmSteps && (
                    <p className="text-xs text-gray-500 mt-0.5">{distKmSteps} km covered</p>
                  )}
                </div>
                <div className="text-5xl">🦶</div>
              </div>
              <div className="bg-gray-700 rounded-full h-2 mt-2">
                <div
                  className="h-2 rounded-full transition-all duration-500"
                  style={{
                    width: `${Math.min(100, (totalSteps / 10000) * 100)}%`,
                    backgroundColor: totalSteps >= 10000 ? '#22c55e' : '#f97316',
                  }}
                />
              </div>
              <div className="flex justify-between text-xs text-gray-500 mt-1">
                <span>{Math.round((totalSteps / 10000) * 100)}% of 10k goal</span>
                {dailySteps?.active_minutes != null && (
                  <span>{dailySteps.active_minutes} active min</span>
                )}
              </div>
            </div>
          )
        })()}

        {/* Body Battery - Extended */}
        {(metrics?.garmin_body_battery_high != null || dailyHealth?.body_battery_start != null) && (
          <div className="bg-gray-900 rounded-2xl p-4">
            <div className="flex items-center justify-between mb-3">
              <div>
                <p className="text-xs text-gray-500 uppercase tracking-wider">Body Battery</p>
                <p className="text-3xl font-bold text-white mt-1">
                  {dailyHealth?.body_battery_end ?? metrics?.garmin_body_battery_eod ?? metrics?.garmin_body_battery_high}
                </p>
              </div>
              <div className="text-5xl">⚡</div>
            </div>
            <div className="grid grid-cols-3 gap-2">
              <div className="bg-gray-800 rounded-lg p-2 text-center">
                <p className="text-xs text-gray-500">Start</p>
                <p className="text-lg font-bold text-green-400">{dailyHealth?.body_battery_start ?? metrics?.garmin_body_battery_high ?? '—'}</p>
              </div>
              <div className="bg-gray-800 rounded-lg p-2 text-center">
                <p className="text-xs text-gray-500">Peak</p>
                <p className="text-lg font-bold text-blue-400">{dailyHealth?.body_battery_peak ?? metrics?.garmin_body_battery_high ?? '—'}</p>
              </div>
              <div className="bg-gray-800 rounded-lg p-2 text-center">
                <p className="text-xs text-gray-500">Low</p>
                <p className="text-lg font-bold text-red-400">{dailyHealth?.body_battery_low ?? '—'}</p>
              </div>
            </div>
          </div>
        )}

        {/* Sleep Analysis */}
        {sleepData && (sleepData.sleep_score != null || sleepData.sleep_duration_seconds != null) && (
          <div className="bg-gray-900 rounded-2xl p-4">
            <div className="flex items-center justify-between mb-3">
              <div>
                <p className="text-xs text-gray-500 uppercase tracking-wider">Sleep Analysis</p>
                <p className="text-3xl font-bold text-white mt-1">
                  {sleepData.sleep_score ?? '—'}
                </p>
              </div>
              <div className="text-5xl">🌙</div>
            </div>
            <div className="grid grid-cols-2 gap-2 mb-3">
              <div className="bg-gray-800 rounded-lg p-2">
                <p className="text-xs text-gray-500">Duration</p>
                <p className="text-lg font-bold text-white">
                  {sleepData.sleep_duration_seconds
                    ? `${Math.floor(sleepData.sleep_duration_seconds / 3600)}h ${Math.floor((sleepData.sleep_duration_seconds % 3600) / 60)}m`
                    : '—'}
                </p>
              </div>
              <div className="bg-gray-800 rounded-lg p-2">
                <p className="text-xs text-gray-500">Quality</p>
                <p className="text-lg font-bold text-white">{sleepData.sleep_quality_score ?? '—'}</p>
              </div>
            </div>
            {/* Sleep stages bar */}
            {(sleepData.awake_seconds != null || sleepData.light_sleep_seconds != null || sleepData.deep_sleep_seconds != null || sleepData.rem_sleep_seconds != null) && (
              <div className="mt-3">
                <p className="text-xs text-gray-500 mb-1">Sleep Stages</p>
                <div className="flex h-3 rounded-full overflow-hidden">
                  {sleepData.awake_seconds != null && sleepData.awake_seconds > 0 && (
                    <div className="bg-gray-500" style={{ width: `${(sleepData.awake_seconds / (sleepData.sleep_duration_seconds || 1)) * 100}%` }} />
                  )}
                  {sleepData.light_sleep_seconds != null && sleepData.light_sleep_seconds > 0 && (
                    <div className="bg-blue-400" style={{ width: `${(sleepData.light_sleep_seconds / (sleepData.sleep_duration_seconds || 1)) * 100}%` }} />
                  )}
                  {sleepData.deep_sleep_seconds != null && sleepData.deep_sleep_seconds > 0 && (
                    <div className="bg-purple-600" style={{ width: `${(sleepData.deep_sleep_seconds / (sleepData.sleep_duration_seconds || 1)) * 100}%` }} />
                  )}
                  {sleepData.rem_sleep_seconds != null && sleepData.rem_sleep_seconds > 0 && (
                    <div className="bg-yellow-400" style={{ width: `${(sleepData.rem_sleep_seconds / (sleepData.sleep_duration_seconds || 1)) * 100}%` }} />
                  )}
                </div>
                <div className="flex gap-3 mt-2 text-xs">
                  <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-gray-500" /> Awake</span>
                  <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-blue-400" /> Light</span>
                  <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-purple-600" /> Deep</span>
                  <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-yellow-400" /> REM</span>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Stress - Extended */}
        {(metrics?.garmin_stress_avg != null || dailyHealth?.stress_avg != null) && (
          <div className="bg-gray-900 rounded-2xl p-4">
            <div className="flex items-center justify-between mb-3">
              <div>
                <p className="text-xs text-gray-500 uppercase tracking-wider">Stress Levels</p>
                <p className="text-3xl font-bold text-white mt-1">
                  {dailyHealth?.stress_avg ?? metrics?.garmin_stress_avg}
                </p>
              </div>
              <div
                className="text-sm font-medium px-3 py-1 rounded-full"
                style={{
                  background: (dailyHealth?.stress_avg ?? metrics?.garmin_stress_avg ?? 0) < 26 ? '#14532d' : (dailyHealth?.stress_avg ?? metrics?.garmin_stress_avg ?? 0) < 51 ? '#713f12' : '#7f1d1d',
                  color: (dailyHealth?.stress_avg ?? metrics?.garmin_stress_avg ?? 0) < 26 ? '#86efac' : (dailyHealth?.stress_avg ?? metrics?.garmin_stress_avg ?? 0) < 51 ? '#fde68a' : '#fca5a5'
                }}
              >
                {(dailyHealth?.stress_avg ?? metrics?.garmin_stress_avg ?? 0) < 26 ? 'Low' : (dailyHealth?.stress_avg ?? metrics?.garmin_stress_avg ?? 0) < 51 ? 'Medium' : 'High'}
              </div>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div className="bg-gray-800 rounded-lg p-2 text-center">
                <p className="text-xs text-gray-500">Max</p>
                <p className="text-lg font-bold text-red-400">{dailyHealth?.stress_max ?? '—'}</p>
              </div>
              <div className="bg-gray-800 rounded-lg p-2 text-center">
                <p className="text-xs text-gray-500">HRV Avg</p>
                <p className="text-lg font-bold text-green-400">{dailyHealth?.hrv_avg ?? metrics?.garmin_hrv_nightly_avg ?? '—'}</p>
              </div>
            </div>
          </div>
        )}


        {/* Hydration */}
        {dailyHealth?.hydration_goal_ml != null && (
          <div className="bg-gray-900 rounded-2xl p-4">
            <div className="flex items-center justify-between mb-3">
              <div>
                <p className="text-xs text-gray-500 uppercase tracking-wider">Hydration</p>
                <p className="text-3xl font-bold text-white mt-1">
                  {dailyHealth.hydration_intake_ml
                    ? `${(dailyHealth.hydration_intake_ml / 1000).toFixed(1)}L`
                    : '—'}
                </p>
              </div>
              <div className="text-5xl">💧</div>
            </div>
            {dailyHealth.hydration_goal_ml && (
              <div className="mt-2">
                <div className="flex justify-between text-xs text-gray-400 mb-1">
                  <span>Goal: {(dailyHealth.hydration_goal_ml / 1000).toFixed(1)}L</span>
                  {dailyHealth.hydration_remaining_ml != null && (
                    <span>Remaining: {(dailyHealth.hydration_remaining_ml / 1000).toFixed(1)}L</span>
                  )}
                </div>
                <div className="w-full bg-gray-800 rounded-full h-2">
                  <div
                    className="bg-blue-500 h-2 rounded-full transition-all"
                    style={{ width: `${Math.min(100, ((dailyHealth.hydration_intake_ml ?? 0) / (dailyHealth.hydration_goal_ml || 1)) * 100)}%` }}
                  />
                </div>
              </div>
            )}
          </div>
        )}

        {/* No data state */}
        {!metrics && (
          <div className="bg-gray-900 rounded-2xl p-6 text-center">
            <p className="text-gray-500 text-sm">No health data for today yet.</p>
            <p className="text-gray-600 text-xs mt-1">
              Sync your Garmin or open the Android app to populate data.
            </p>
          </div>
        )}

        {/* Recent activity */}
        {todayActivities.length > 0 && (
          <div className="bg-gray-900 rounded-2xl p-4">
            <p className="text-xs text-gray-500 uppercase tracking-wider mb-3">Today&apos;s Activities</p>
            <div className="space-y-2">
              {todayActivities.map((a, i) => (
                <div key={i} className="flex items-center justify-between">
                  <p className="text-white text-sm font-medium capitalize">
                    {a.activity_type?.replace(/_/g, ' ') ?? 'Activity'}
                  </p>
                  <p className="text-gray-400 text-sm">
                    {a.duration_sec ? `${Math.round(a.duration_sec / 60)} min` : ''}
                  </p>
                </div>
              ))}
            </div>
            <a href="/activities" className="block text-center text-xs text-orange-400 mt-3">
              View all activities →
            </a>
          </div>
        )}

      </div>
      <BottomNav />
    </main>
  )
}

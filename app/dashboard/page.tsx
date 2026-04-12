'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '../../lib/supabase'

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
  const [activities, setActivities] = useState<ActivitySummary[]>([])

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

  const scores = metrics ? computeScores(metrics, activities) : null
  const readiness = scores?.readiness ?? null
  const color = readiness != null ? readinessColor(readiness) : '#6b7280'
  const today = new Date()
  const dateStr = today.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })

  const sleepHours = metrics?.sleep_minutes
    ? `${Math.floor(metrics.sleep_minutes / 60)}h ${metrics.sleep_minutes % 60}m`
    : '—'
  const steps = metrics?.steps ? (metrics.steps / 1000).toFixed(1) + 'k' : '—'
  const cals = metrics?.active_calories_kcal ?? metrics?.calories
  const calStr = cals ? Math.round(cals) + ' kcal' : '—'
  const distKm = metrics?.distance_m ? (metrics.distance_m / 1000).toFixed(1) + ' km' : '—'

  const todayActivities = activities.filter(a => {
    const d = new Date(a.start_time)
    return d.toDateString() === today.toDateString()
  })
  const exerciseStr = scores?.exerciseMin ? `${scores.exerciseMin} min` : '—'

  return (
    <main className="min-h-screen bg-gray-950 p-4 md:p-8">
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

        {/* Quick stats */}
        <div className="grid grid-cols-2 gap-3">
          <StatCard label="Sleep" value={sleepHours} icon="🌙" />
          <StatCard label="Steps" value={steps} icon="🦶" />
          <StatCard label="Exercise" value={exerciseStr} icon="🏃" />
          <StatCard label="Active Cal" value={calStr} icon="🔥" />
        </div>

        {/* Body Battery */}
        {metrics?.garmin_body_battery_high != null && (
          <div className="bg-gray-900 rounded-2xl p-4 flex items-center justify-between">
            <div>
              <p className="text-xs text-gray-500 uppercase tracking-wider">Body Battery</p>
              <p className="text-3xl font-bold text-white mt-1">
                {metrics.garmin_body_battery_eod ?? metrics.garmin_body_battery_high}
              </p>
              <p className="text-xs text-gray-500 mt-1">
                Peak: {metrics.garmin_body_battery_high} today
              </p>
            </div>
            <div className="text-5xl">⚡</div>
          </div>
        )}

        {/* Stress */}
        {metrics?.garmin_stress_avg != null && (
          <div className="bg-gray-900 rounded-2xl p-4 flex items-center justify-between">
            <div>
              <p className="text-xs text-gray-500 uppercase tracking-wider">Avg Stress</p>
              <p className="text-3xl font-bold text-white mt-1">{metrics.garmin_stress_avg}</p>
            </div>
            <div
              className="text-sm font-medium px-3 py-1 rounded-full"
              style={{
                background: metrics.garmin_stress_avg < 26 ? '#14532d' : metrics.garmin_stress_avg < 51 ? '#713f12' : '#7f1d1d',
                color: metrics.garmin_stress_avg < 26 ? '#86efac' : metrics.garmin_stress_avg < 51 ? '#fde68a' : '#fca5a5'
              }}
            >
              {metrics.garmin_stress_avg < 26 ? 'Low' : metrics.garmin_stress_avg < 51 ? 'Medium' : 'High'}
            </div>
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

        <div className="text-center pb-4">
          <a href="/activities" className="text-xs text-gray-600 underline">Activities & Coach</a>
        </div>
      </div>
    </main>
  )
}

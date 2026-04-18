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
  avg_spo2: number | null
  min_spo2: number | null
  avg_respiration_bpm: number | null
  avg_heart_rate_bpm: number | null
  max_heart_rate_bpm: number | null
  sleep_stress_score: number | null
  sleep_hr_avg: number | null
  sleep_hr_max: number | null
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

function RadarBar({ label, value, icon, tooltip }: { label: string; value: number; icon: string; tooltip?: string }) {
  const color = value >= 70 ? '#22c55e' : value >= 45 ? '#eab308' : '#ef4444'
  return (
    <div className="flex items-center gap-3">
      <span className="text-base w-5">{icon}</span>
      <span className="text-sm text-gray-300 w-24 shrink-0 flex items-center gap-1">{label}{tooltip && <InfoTooltip text={tooltip} />}</span>
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

function SleepStat({
  label, value, unit, color = 'text-white',
}: { label: string; value: number | string | null | undefined; unit?: string; color?: string }) {
  const display = value == null || value === '' ? '—' : value
  return (
    <div className="bg-gray-800 rounded-lg p-2">
      <p className={`text-lg font-bold ${color}`}>
        {display}
        {display !== '—' && unit && <span className="text-xs text-gray-500 font-normal ml-0.5">{unit}</span>}
      </p>
      <p className="text-[10px] text-gray-500 mt-0.5 leading-tight">{label}</p>
    </div>
  )
}

function StageBox({
  label, seconds, color, textColor,
}: { label: string; seconds: number | null | undefined; color: string; textColor: string }) {
  const mins = seconds != null ? Math.round(seconds / 60) : null
  const h = mins != null ? Math.floor(mins / 60) : null
  const m = mins != null ? mins % 60 : null
  const display = mins != null ? (h! > 0 ? `${h}h ${m}m` : `${m}m`) : '—'
  return (
    <div className="bg-gray-800 rounded-lg p-2 text-center">
      <div className={`w-2 h-2 rounded-full ${color} mx-auto mb-1`} />
      <p className={`text-sm font-bold ${textColor}`}>{display}</p>
      <p className="text-[10px] text-gray-500">{label}</p>
    </div>
  )
}

function MetricTile({
  label,
  icon,
  value,
  unit,
  tooltip,
  trend,
  trendColor = '#f97316',
  invert = false,
}: {
  label: string
  icon: string
  value: number | string | null | undefined
  unit?: string
  tooltip?: string
  trend?: (number | null)[]
  trendColor?: string
  invert?: boolean
}) {
  const display = value == null || value === '' ? '—' : value
  return (
    <div className="bg-gray-800 rounded-2xl p-3 flex flex-col justify-between min-h-[100px]">
      <div className="flex items-center justify-between text-gray-400 text-xs">
        <span className="flex items-center gap-1">
          <span className="text-base">{icon}</span>
          <span>{label}</span>
        </span>
        {tooltip && <InfoTooltip text={tooltip} />}
      </div>
      <div className="flex items-end justify-between mt-2">
        <p className="text-2xl font-bold text-white leading-none">
          {display}
          {display !== '—' && unit && (
            <span className="text-xs text-gray-500 font-normal ml-0.5">{unit}</span>
          )}
        </p>
      </div>
      {trend && trend.length > 0 && (
        <div className="mt-2">
          <Sparkline values={trend} color={trendColor} width={90} height={18} invert={invert} />
        </div>
      )}
    </div>
  )
}

function StatCard({ label, value, icon, tooltip }: { label: string; value: string; icon: string; tooltip?: string }) {
  return (
    <div className="bg-gray-800 rounded-2xl p-4">
      <div className="flex items-center gap-2 text-gray-400 text-xs mb-2">
        <span>{icon}</span> <span>{label}</span>
        {tooltip && <InfoTooltip text={tooltip} />}
      </div>
      <p className="text-2xl font-bold text-white">{value}</p>
    </div>
  )
}

function InfoTooltip({ text }: { text: string }) {
  return (
    <span className="relative inline-flex items-center group ml-0.5">
      <span className="w-3.5 h-3.5 flex items-center justify-center rounded-full bg-gray-700 text-gray-300 text-[9px] font-bold cursor-help leading-none">
        i
      </span>
      <span
        className="pointer-events-none absolute left-1/2 -translate-x-1/2 bottom-full mb-1 w-52 px-2.5 py-1.5 rounded-lg bg-gray-950 border border-gray-700 text-[11px] text-gray-200 leading-snug opacity-0 group-hover:opacity-100 transition-opacity z-20 shadow-lg"
        role="tooltip"
      >
        {text}
      </span>
    </span>
  )
}

// Central dictionary of metric explanations so we can reuse and tweak in one place.
const METRIC_INFO = {
  readiness:
    'A 0–100 overall readiness score averaged from HRV, sleep, resting HR, SpO2 and training load. 85+ Excellent, 70+ Good, 55+ Moderate.',
  hrv:
    'Heart Rate Variability (ms) measured during last night\'s sleep. Higher usually means better recovery. This is Garmin\'s "Last Night Avg" value.',
  hrvRadar:
    'HRV scaled to 0–100 for the readiness radar. It is NOT the raw ms number — 20ms ≈ 0, 80ms ≈ 100.',
  sleep:
    'Garmin\'s 0–100 sleep score combining duration, stages (deep/REM/light) and restlessness.',
  bodyBattery:
    'Garmin Body Battery energy reserve (0–100). Peak is today\'s highest, Low is today\'s lowest, current is end-of-day.',
  stress:
    'All-day average stress (0–100). Under 26 is low/resting, 26–50 medium, 51+ high stress.',
  steps:
    'Total steps walked today measured by your watch. Default goal is 10,000.',
  exercise: 'Total exercise time logged today from Garmin activities.',
  calories: 'Active calories burned today (excludes basal/BMR).',
  spo2: 'Blood oxygen saturation percentage. 95–100% is normal at sea level.',
  restingHr: 'Resting heart rate (bpm) — lower is typically fitter. Measured during rest.',
  hydration: 'Water intake logged in Garmin Connect vs. daily goal.',
} as const

function Sparkline({
  values,
  width = 80,
  height = 24,
  color = '#f97316',
  invert = false,
}: {
  values: (number | null)[]
  width?: number
  height?: number
  color?: string
  invert?: boolean // true for metrics where lower is better (resting HR)
}) {
  const clean = values.filter((v): v is number => v != null && !isNaN(v))
  if (clean.length < 2) {
    return (
      <div style={{ width, height }} className="flex items-center justify-center">
        <span className="text-[10px] text-gray-600">not enough data</span>
      </div>
    )
  }
  const min = Math.min(...clean)
  const max = Math.max(...clean)
  const range = max - min || 1
  const step = width / (values.length - 1)
  const points = values.map((v, i) => {
    if (v == null) return null
    const x = i * step
    const y = height - ((v - min) / range) * (height - 4) - 2
    return `${x.toFixed(1)},${y.toFixed(1)}`
  }).filter(Boolean).join(' ')

  const first = clean[0]
  const last = clean[clean.length - 1]
  const up = last > first
  const trendColor = (up !== invert) ? '#22c55e' : '#ef4444'
  const delta = last - first
  const deltaPct = Math.abs((delta / (first || 1)) * 100)

  return (
    <div className="flex items-center gap-2">
      <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} className="overflow-visible">
        <polyline
          points={points}
          fill="none"
          stroke={color}
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        {/* Last-point dot */}
        {(() => {
          const lastIdx = values.length - 1
          const lastVal = values[lastIdx]
          if (lastVal == null) return null
          const x = lastIdx * step
          const y = height - ((lastVal - min) / range) * (height - 4) - 2
          return <circle cx={x} cy={y} r="2" fill={color} />
        })()}
      </svg>
      <span className="text-[10px] font-medium" style={{ color: trendColor }}>
        {up ? '▲' : '▼'} {deltaPct.toFixed(0)}%
      </span>
    </div>
  )
}

function formatRelative(iso: string | null): string {
  if (!iso) return 'never'
  const t = new Date(iso).getTime()
  if (isNaN(t)) return 'never'
  const diff = Date.now() - t
  if (diff < 60_000) return 'just now'
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`
  return `${Math.floor(diff / 86_400_000)}d ago`
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
  const [syncing, setSyncing] = useState(false)
  const [syncMessage, setSyncMessage] = useState<string | null>(null)
  const [lastSyncAt, setLastSyncAt] = useState<string | null>(null)
  const [sleepDetailOpen, setSleepDetailOpen] = useState(false)
  const [trends, setTrends] = useState<{
    hrv: (number | null)[]
    sleep: (number | null)[]
    bodyBattery: (number | null)[]
    restingHr: (number | null)[]
    stress: (number | null)[]
    steps: (number | null)[]
  }>({ hrv: [], sleep: [], bodyBattery: [], restingHr: [], stress: [], steps: [] })

  const loadLastSync = async (userId: string) => {
    const { data } = await supabase
      .from('provider_connections')
      .select('last_successful_sync_at')
      .eq('user_id', userId)
      .eq('provider_type', 'garmin')
      .maybeSingle()
    setLastSyncAt(data?.last_successful_sync_at ?? null)
  }

  const loadDashboardData = async (userId: string) => {
    const today = new Date().toISOString().split('T')[0]

    // Load daily health metrics (existing table)
    const { data: m } = await supabase
      .from('daily_health_metrics')
      .select(`metric_date, steps, sleep_minutes, resting_hr, resting_heart_rate_bpm,
        pulse_ox, garmin_spo2_avg, garmin_hrv_nightly_avg, garmin_hrv_status,
        garmin_sleep_score, garmin_body_battery_high, garmin_body_battery_eod,
        garmin_stress_avg, active_calories_kcal, calories, distance_m`)
      .eq('user_id', userId)
      .eq('metric_date', today)
      .maybeSingle()

    setMetrics(m as DailyMetrics | null)

    // Load detailed sleep data — fall back to the most recent night with actual data.
    // Garmin sometimes returns an empty placeholder row for the current day before
    // overnight sleep is recorded; skip those (sleep_score AND duration both null).
    const sevenAgo = new Date(Date.now() - 7 * 86400000).toISOString().split('T')[0]
    const { data: sleepRows } = await supabase
      .from('garmin_sleep_data')
      .select(`sleep_date, sleep_duration_seconds, sleep_score, sleep_quality_score,
        awake_seconds, light_sleep_seconds, deep_sleep_seconds, rem_sleep_seconds,
        avg_spo2, min_spo2, avg_respiration_bpm, avg_heart_rate_bpm, max_heart_rate_bpm,
        sleep_stress_score, sleep_hr_avg, sleep_hr_max, sleep_start, sleep_end`)
      .eq('user_id', userId)
      .gte('sleep_date', sevenAgo)
      .order('sleep_date', { ascending: false })
      .limit(7)

    const firstRealSleep = (sleepRows ?? []).find(
      r => r.sleep_score != null || (r.sleep_duration_seconds != null && r.sleep_duration_seconds > 0)
    )
    setSleepData((firstRealSleep ?? null) as SleepData | null)

    // Load extended daily health metrics
    const { data: health } = await supabase
      .from('garmin_daily_health_metrics')
      .select(`metric_date, body_battery_start, body_battery_end, body_battery_peak,
        body_battery_low, stress_avg, stress_max, hrv_avg, hrv_status,
        respiration_avg_bpm, spo2_avg, hydration_intake_ml, hydration_goal_ml`)
      .eq('user_id', userId)
      .eq('metric_date', today)
      .maybeSingle()

    setDailyHealth(health as DailyHealthMetrics | null)

    // Load daily steps
    const { data: steps } = await supabase
      .from('garmin_daily_steps')
      .select(`step_date, total_steps, total_distance_meters, total_calories, active_minutes`)
      .eq('user_id', userId)
      .eq('step_date', today)
      .maybeSingle()

    setDailySteps(steps as DailySteps | null)

    const weekAgo = new Date(Date.now() - 7 * 86400000).toISOString()
    const { data: acts } = await supabase
      .from('garmin_activities')
      .select('duration_sec, activity_type, start_time')
      .eq('user_id', userId)
      .gte('start_time', weekAgo)
      .order('start_time', { ascending: false })

    setActivities((acts ?? []) as ActivitySummary[])

    // --- 7-day trends ---------------------------------------------------
    const sevenAgoDate = new Date(Date.now() - 6 * 86400000).toISOString().split('T')[0]
    const dates: string[] = []
    for (let i = 6; i >= 0; i--) {
      dates.push(new Date(Date.now() - i * 86400000).toISOString().split('T')[0])
    }

    const [healthHist, sleepHist, legacyHist] = await Promise.all([
      supabase
        .from('garmin_daily_health_metrics')
        .select('metric_date, hrv_avg, body_battery_end, stress_avg')
        .eq('user_id', userId)
        .gte('metric_date', sevenAgoDate)
        .order('metric_date', { ascending: true }),
      supabase
        .from('garmin_sleep_data')
        .select('sleep_date, sleep_score')
        .eq('user_id', userId)
        .gte('sleep_date', sevenAgoDate)
        .order('sleep_date', { ascending: true }),
      supabase
        .from('daily_health_metrics')
        .select('metric_date, resting_hr, resting_heart_rate_bpm, steps, garmin_hrv_nightly_avg, garmin_body_battery_eod, garmin_stress_avg, garmin_sleep_score')
        .eq('user_id', userId)
        .gte('metric_date', sevenAgoDate)
        .order('metric_date', { ascending: true }),
    ])

    const healthByDate = new Map<string, { hrv_avg: number | null; body_battery_end: number | null; stress_avg: number | null }>()
    ;(healthHist.data ?? []).forEach(r => healthByDate.set(r.metric_date, r))
    const sleepByDate = new Map<string, number | null>()
    ;(sleepHist.data ?? []).forEach(r => {
      // Skip empty placeholder rows (Garmin returns these for tonight when nothing's recorded yet)
      if (r.sleep_score != null) sleepByDate.set(r.sleep_date, r.sleep_score)
    })
    const legacyByDate = new Map<string, { resting_hr: number | null; resting_heart_rate_bpm: number | null; steps: number | null; garmin_hrv_nightly_avg: number | null; garmin_body_battery_eod: number | null; garmin_stress_avg: number | null; garmin_sleep_score: number | null }>()
    ;(legacyHist.data ?? []).forEach(r => legacyByDate.set(r.metric_date, r))

    setTrends({
      hrv: dates.map(d => healthByDate.get(d)?.hrv_avg ?? legacyByDate.get(d)?.garmin_hrv_nightly_avg ?? null),
      sleep: dates.map(d => sleepByDate.get(d) ?? legacyByDate.get(d)?.garmin_sleep_score ?? null),
      bodyBattery: dates.map(d => healthByDate.get(d)?.body_battery_end ?? legacyByDate.get(d)?.garmin_body_battery_eod ?? null),
      restingHr: dates.map(d => {
        const l = legacyByDate.get(d)
        return l?.resting_hr ?? l?.resting_heart_rate_bpm ?? null
      }),
      stress: dates.map(d => healthByDate.get(d)?.stress_avg ?? legacyByDate.get(d)?.garmin_stress_avg ?? null),
      steps: dates.map(d => legacyByDate.get(d)?.steps ?? null),
    })
  }

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

      await Promise.all([loadDashboardData(user.id), loadLastSync(user.id)])
      setLoading(false)
    }
    load()
  }, [router])

  const handleSyncNow = async () => {
    if (syncing) return
    setSyncing(true)
    setSyncMessage('Triggering sync…')
    try {
      const res = await fetch('/api/integrations/garmin/sync', { method: 'POST' })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        setSyncMessage(body.error ?? `Sync failed (${res.status})`)
        setSyncing(false)
        return
      }

      // Poll provider_connections.status until it flips back from "syncing"
      const { data: auth } = await supabase.auth.getSession()
      const userId = auth.session?.user.id
      if (!userId) { setSyncing(false); return }

      setSyncMessage('Syncing with Garmin… this usually takes about a minute.')
      const startedAt = Date.now()
      const poll = async (): Promise<void> => {
        const { data: conn } = await supabase
          .from('provider_connections')
          .select('status, last_successful_sync_at, last_error')
          .eq('user_id', userId)
          .eq('provider_type', 'garmin')
          .maybeSingle()

        if (conn?.last_error) {
          setSyncMessage(`Sync error: ${conn.last_error}`)
          setSyncing(false)
          return
        }
        if (conn?.status === 'connected' && conn.last_successful_sync_at) {
          const finishedAt = new Date(conn.last_successful_sync_at).getTime()
          if (finishedAt >= startedAt - 2000) {
            await Promise.all([loadDashboardData(userId), loadLastSync(userId)])
            setSyncMessage('Synced.')
            setSyncing(false)
            setTimeout(() => setSyncMessage(null), 4000)
            return
          }
        }
        if (Date.now() - startedAt > 5 * 60_000) {
          setSyncMessage('Still syncing — data will appear shortly.')
          setSyncing(false)
          return
        }
        setTimeout(poll, 4000)
      }
      setTimeout(poll, 5000)
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Sync failed'
      setSyncMessage(msg)
      setSyncing(false)
    }
  }

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
            localHour: new Date().getHours(),
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
      {/* AI Insights Modal Overlay */}
      {aiExpanded && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm"
          onClick={() => setAiExpanded(false)}
          role="dialog"
          aria-modal="true"
        >
          <div
            className="relative w-full max-w-lg max-h-[85vh] overflow-y-auto bg-gradient-to-br from-orange-950/90 via-gray-900 to-purple-950/90 rounded-3xl p-6 border border-orange-500/30 shadow-2xl"
            onClick={e => e.stopPropagation()}
          >
            {/* Close button */}
            <button
              onClick={() => setAiExpanded(false)}
              aria-label="Close AI insights"
              className="absolute top-3 right-3 w-8 h-8 rounded-full bg-gray-800/80 hover:bg-gray-700 text-gray-300 hover:text-white flex items-center justify-center transition-colors"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>

            <div className="flex items-center gap-3 mb-4">
              <span className="text-2xl">✨</span>
              <div>
                <p className="text-base font-bold text-white">AI Insights</p>
                <p className="text-xs text-gray-400">Personalised analysis & recommendations</p>
              </div>
            </div>

            <div className="pt-4 border-t border-orange-500/20">
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
                <p className="text-gray-500 text-sm">Generating your AI snapshot...</p>
              )}
            </div>

            {/* Footer close action */}
            <button
              onClick={() => setAiExpanded(false)}
              className="mt-5 w-full bg-gray-800/80 hover:bg-gray-700 text-gray-200 text-sm py-2 rounded-xl transition-colors"
            >
              Back to dashboard
            </button>
          </div>
        </div>
      )}

      {/* Sleep Detail Modal Overlay */}
      {sleepDetailOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm"
          onClick={() => setSleepDetailOpen(false)}
          role="dialog"
          aria-modal="true"
        >
          <div
            className="relative w-full max-w-lg max-h-[85vh] overflow-y-auto bg-gradient-to-br from-purple-950/90 via-gray-900 to-blue-950/90 rounded-3xl p-6 border border-purple-500/30 shadow-2xl"
            onClick={e => e.stopPropagation()}
          >
            <button
              onClick={() => setSleepDetailOpen(false)}
              aria-label="Close sleep detail"
              className="absolute top-3 right-3 w-8 h-8 rounded-full bg-gray-800/80 hover:bg-gray-700 text-gray-300 hover:text-white flex items-center justify-center transition-colors"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>

            <div className="flex items-center gap-3 mb-4">
              <span className="text-2xl">🌙</span>
              <div>
                <p className="text-base font-bold text-white">Sleep Analysis</p>
                {sleepData?.sleep_date ? (
                  <p className="text-xs text-gray-400">
                    Night of {new Date(sleepData.sleep_date).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' })}
                  </p>
                ) : (
                  <p className="text-xs text-gray-400">Most recent night</p>
                )}
              </div>
            </div>

            {/* Score + Duration + Quality */}
            <div className="grid grid-cols-3 gap-2 mb-4">
              <div className="bg-gray-800/80 rounded-xl p-3 text-center">
                <p className="text-[10px] text-gray-500 uppercase tracking-wider">Score</p>
                <p className="text-2xl font-bold text-white mt-0.5">{sleepData?.sleep_score ?? metrics?.garmin_sleep_score ?? '—'}</p>
              </div>
              <div className="bg-gray-800/80 rounded-xl p-3 text-center">
                <p className="text-[10px] text-gray-500 uppercase tracking-wider">Duration</p>
                <p className="text-2xl font-bold text-white mt-0.5">
                  {(() => {
                    const sec = sleepData?.sleep_duration_seconds ?? (metrics?.sleep_minutes != null ? metrics.sleep_minutes * 60 : null)
                    return sec ? `${Math.floor(sec / 3600)}h ${Math.floor((sec % 3600) / 60)}m` : '—'
                  })()}
                </p>
              </div>
              <div className="bg-gray-800/80 rounded-xl p-3 text-center">
                <p className="text-[10px] text-gray-500 uppercase tracking-wider">Quality</p>
                <p className="text-2xl font-bold text-white mt-0.5">{sleepData?.sleep_quality_score ?? '—'}</p>
              </div>
            </div>

            {/* Sleep Stages bar chart */}
            {sleepData && (sleepData.awake_seconds != null || sleepData.light_sleep_seconds != null || sleepData.deep_sleep_seconds != null || sleepData.rem_sleep_seconds != null) ? (
              <div className="mb-4">
                <p className="text-xs text-gray-500 uppercase tracking-wider mb-2">Sleep Stages</p>
                <div className="flex h-4 rounded-full overflow-hidden bg-gray-800">
                  {sleepData.deep_sleep_seconds != null && sleepData.deep_sleep_seconds > 0 && (
                    <div className="bg-purple-600" style={{ width: `${(sleepData.deep_sleep_seconds / (sleepData.sleep_duration_seconds || 1)) * 100}%` }} title={`Deep ${Math.round(sleepData.deep_sleep_seconds / 60)}m`} />
                  )}
                  {sleepData.light_sleep_seconds != null && sleepData.light_sleep_seconds > 0 && (
                    <div className="bg-blue-400" style={{ width: `${(sleepData.light_sleep_seconds / (sleepData.sleep_duration_seconds || 1)) * 100}%` }} title={`Light ${Math.round(sleepData.light_sleep_seconds / 60)}m`} />
                  )}
                  {sleepData.rem_sleep_seconds != null && sleepData.rem_sleep_seconds > 0 && (
                    <div className="bg-yellow-400" style={{ width: `${(sleepData.rem_sleep_seconds / (sleepData.sleep_duration_seconds || 1)) * 100}%` }} title={`REM ${Math.round(sleepData.rem_sleep_seconds / 60)}m`} />
                  )}
                  {sleepData.awake_seconds != null && sleepData.awake_seconds > 0 && (
                    <div className="bg-gray-500" style={{ width: `${(sleepData.awake_seconds / (sleepData.sleep_duration_seconds || 1)) * 100}%` }} title={`Awake ${Math.round(sleepData.awake_seconds / 60)}m`} />
                  )}
                </div>
                <div className="grid grid-cols-4 gap-2 mt-3">
                  <StageBox label="Deep" seconds={sleepData.deep_sleep_seconds} color="bg-purple-600" textColor="text-purple-300" />
                  <StageBox label="Light" seconds={sleepData.light_sleep_seconds} color="bg-blue-400" textColor="text-blue-300" />
                  <StageBox label="REM" seconds={sleepData.rem_sleep_seconds} color="bg-yellow-400" textColor="text-yellow-300" />
                  <StageBox label="Awake" seconds={sleepData.awake_seconds} color="bg-gray-500" textColor="text-gray-300" />
                </div>
              </div>
            ) : (
              <div className="mb-4 p-3 bg-gray-800/40 rounded-xl border border-gray-700/50">
                <p className="text-xs text-gray-400">
                  Sleep stage breakdown not yet available. It will populate after the next Garmin overnight sync completes.
                </p>
              </div>
            )}

            {/* Sleep Timeline Metrics */}
            <p className="text-xs text-gray-500 uppercase tracking-wider mb-2 mt-4">Sleep Timeline Metrics</p>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              <SleepStat label="Avg Overnight HR" value={sleepData?.sleep_hr_avg ?? sleepData?.avg_heart_rate_bpm} unit="bpm" color="text-orange-300" />
              <SleepStat label="Max Overnight HR" value={sleepData?.sleep_hr_max ?? sleepData?.max_heart_rate_bpm} unit="bpm" color="text-red-400" />
              <SleepStat label="Avg SpO2" value={sleepData?.avg_spo2} unit="%" color="text-cyan-300" />
              <SleepStat label="Lowest SpO2" value={sleepData?.min_spo2} unit="%" color="text-cyan-400" />
              <SleepStat label="Avg Respiration" value={sleepData?.avg_respiration_bpm} unit="brpm" color="text-blue-300" />
              <SleepStat label="Avg Overnight HRV" value={dailyHealth?.hrv_avg ?? metrics?.garmin_hrv_nightly_avg} unit="ms" color="text-green-400" />
              <SleepStat label="Sleep Stress" value={sleepData?.sleep_stress_score} color="text-yellow-300" />
              <SleepStat
                label="Bed / Wake"
                value={sleepData?.sleep_start && sleepData?.sleep_end
                  ? `${new Date(sleepData.sleep_start).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}–${new Date(sleepData.sleep_end).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`
                  : null}
                color="text-gray-200"
              />
            </div>

            <button
              onClick={() => setSleepDetailOpen(false)}
              className="mt-5 w-full bg-gray-800/80 hover:bg-gray-700 text-gray-200 text-sm py-2 rounded-xl transition-colors"
            >
              Back to dashboard
            </button>
          </div>
        </div>
      )}

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
            <button
              onClick={handleSyncNow}
              disabled={syncing}
              className="text-xs bg-orange-600 hover:bg-orange-500 disabled:bg-gray-700 disabled:text-gray-500 text-white px-3 py-1.5 rounded-lg flex items-center gap-1.5"
            >
              {syncing && (
                <svg className="w-3 h-3 animate-spin" viewBox="0 0 24 24" fill="none">
                  <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" opacity="0.25" />
                  <path d="M12 2a10 10 0 0 1 10 10" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
                </svg>
              )}
              {syncing ? 'Syncing…' : 'Sync now'}
            </button>
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
        <div className="flex items-center justify-between -mt-2 text-xs text-gray-500">
          <span title={lastSyncAt ? new Date(lastSyncAt).toLocaleString() : ''}>
            Last synced with Garmin: <span className="text-gray-300">{formatRelative(lastSyncAt)}</span>
          </span>
          {syncMessage && <span className="text-gray-400">{syncMessage}</span>}
        </div>

        {/* Top row: AI Insights (half) + Daily Steps (half) */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {/* AI Insights compact card — tap opens modal overlay */}
          {(() => {
            // Pull a short preview: first non-bold, non-empty lines (up to ~2 sentences).
            const previewText = aiInsight
              ? aiInsight
                  .split('\n')
                  .map(l => l.replace(/^\*\*.+?\*\*\s*/, '').trim())
                  .filter(Boolean)
                  .slice(0, 2)
                  .join(' ')
              : null
            return (
              <button
                type="button"
                onClick={() => {
                  setAiExpanded(true)
                  if (!aiInsight && !aiLoading) fetchAIInsight()
                }}
                className="bg-gradient-to-r from-orange-900/40 to-purple-900/40 rounded-3xl p-4 border border-orange-500/20 text-left hover:border-orange-500/40 transition-colors"
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="text-xl">✨</span>
                    <p className="text-sm font-bold text-white">AI Insights</p>
                  </div>
                  <span className="text-[10px] text-orange-300/80 uppercase tracking-wider">Tap to open</span>
                </div>
                <div className="mt-2 text-[12px] text-gray-300 leading-snug line-clamp-3 min-h-[3em]">
                  {aiLoading
                    ? 'Analysing your metrics...'
                    : previewText
                    ? previewText
                    : 'Tap for a personalised summary of today\'s recovery and training recommendation.'}
                </div>
              </button>
            )
          })()}

          {/* Daily Steps with progress bar (half-width) */}
          {(dailySteps?.total_steps != null || metrics?.steps != null) ? (() => {
            const totalSteps = dailySteps?.total_steps ?? metrics?.steps ?? 0
            const distKmSteps = dailySteps?.total_distance_meters
              ? (dailySteps.total_distance_meters / 1000).toFixed(1)
              : metrics?.distance_m
              ? (metrics.distance_m / 1000).toFixed(1)
              : null
            const pct = Math.min(100, (totalSteps / 10000) * 100)
            return (
              <div className="bg-gray-900 rounded-3xl p-4">
                <div className="flex items-start justify-between mb-2">
                  <div>
                    <p className="text-xs text-gray-500 uppercase tracking-wider flex items-center gap-1">
                      Daily Steps <InfoTooltip text={METRIC_INFO.steps} />
                    </p>
                    <p className="text-3xl font-bold text-white mt-1">
                      {totalSteps.toLocaleString()}
                    </p>
                    {distKmSteps && (
                      <p className="text-[11px] text-gray-500 mt-0.5">{distKmSteps} km covered</p>
                    )}
                  </div>
                  <div className="flex flex-col items-end gap-1">
                    <div className="text-4xl">🦶</div>
                    <Sparkline values={trends.steps} color="#f97316" width={70} height={18} />
                  </div>
                </div>
                <div className="bg-gray-700 rounded-full h-2 mt-2">
                  <div
                    className="h-2 rounded-full transition-all duration-500"
                    style={{
                      width: `${pct}%`,
                      backgroundColor: totalSteps >= 10000 ? '#22c55e' : '#f97316',
                    }}
                  />
                </div>
                <div className="flex justify-between text-[11px] text-gray-500 mt-1">
                  <span>{Math.round(pct)}% of 10k goal</span>
                  {dailySteps?.active_minutes != null && (
                    <span>{dailySteps.active_minutes} active min</span>
                  )}
                </div>
              </div>
            )
          })() : (
            <div className="bg-gray-900 rounded-3xl p-4 flex items-center justify-center">
              <p className="text-xs text-gray-500">No step data yet today.</p>
            </div>
          )}
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
              <p className="text-xs text-gray-500 uppercase tracking-wider mb-1 flex items-center gap-1">Readiness <InfoTooltip text={METRIC_INFO.readiness} /></p>
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

          {/* Raw-value vitals tiles (replaces 0–100 radar bars) */}
          {scores && (() => {
            const hrvVal = dailyHealth?.hrv_avg ?? metrics?.garmin_hrv_nightly_avg ?? null
            const rhrVal = metrics?.resting_hr ?? metrics?.resting_heart_rate_bpm ?? null
            const spo2Val = dailyHealth?.spo2_avg ?? metrics?.garmin_spo2_avg ?? metrics?.pulse_ox ?? null
            const loadMin = scores.exerciseMin
            return (
              <div className="mt-6">
                <p className="text-xs text-gray-500 uppercase tracking-wider mb-3 flex items-center gap-1">
                  Today&apos;s Vitals <InfoTooltip text="Live readings from Garmin at your last sync. Sparklines show the 7-day trend." />
                </p>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                  <MetricTile label="HRV" icon="💚" value={hrvVal} unit="ms" tooltip={METRIC_INFO.hrv} trend={trends.hrv} trendColor="#22c55e" />
                  <MetricTile label="Resting HR" icon="❤️" value={rhrVal} unit="bpm" tooltip={METRIC_INFO.restingHr} trend={trends.restingHr} trendColor="#ef4444" invert />
                  <MetricTile label="SpO2" icon="🩸" value={spo2Val} unit="%" tooltip={METRIC_INFO.spo2} />
                  <MetricTile label="Stress" icon="😌" value={dailyHealth?.stress_avg ?? metrics?.garmin_stress_avg ?? null} tooltip={METRIC_INFO.stress} trend={trends.stress} trendColor="#fbbf24" invert />
                  <MetricTile
                    label="Intensity Min"
                    icon="🔥"
                    value={(() => {
                      // Garmin intensity min = moderate (active) + 2×vigorous; we approximate from active_minutes if available.
                      const im = dailySteps?.active_minutes ?? null
                      return im
                    })()}
                    unit="min"
                    tooltip="Garmin weekly goal is 150 min. Moderate activity counts 1×, vigorous counts 2×."
                  />
                  <MetricTile
                    label="Training Readiness"
                    icon="🎯"
                    value={readiness}
                    unit="/100"
                    tooltip="Composite readiness score from HRV, sleep, resting HR, SpO2 and today's load. 85+ Excellent, 70+ Good."
                  />
                </div>
                <p className="text-[10px] text-gray-600 mt-2">
                  Exercise today: {loadMin || 0} min logged
                </p>
              </div>
            )
          })()}
        </div>

        {/* (AI Insights + Daily Steps now rendered above the Readiness card) */}

        {/* Body Battery - Extended */}
        {(metrics?.garmin_body_battery_high != null || dailyHealth?.body_battery_start != null) && (
          <div className="bg-gray-900 rounded-2xl p-4">
            <div className="flex items-center justify-between mb-3">
              <div>
                <p className="text-xs text-gray-500 uppercase tracking-wider flex items-center gap-1">Body Battery <InfoTooltip text={METRIC_INFO.bodyBattery} /></p>
                <p className="text-3xl font-bold text-white mt-1">
                  {dailyHealth?.body_battery_end ?? metrics?.garmin_body_battery_eod ?? metrics?.garmin_body_battery_high}
                </p>
              </div>
              <div className="flex flex-col items-end gap-1">
                <div className="text-5xl">⚡</div>
                <Sparkline values={trends.bodyBattery} color="#60a5fa" />
              </div>
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

        {/* Sleep Analysis — compact clickable card. Modal holds all detail. */}
        {(() => {
          const score = sleepData?.sleep_score ?? metrics?.garmin_sleep_score ?? null
          const durSec = sleepData?.sleep_duration_seconds
            ?? (metrics?.sleep_minutes != null ? metrics.sleep_minutes * 60 : null)
          const durStr = durSec != null
            ? `${Math.floor(durSec / 3600)}h ${Math.floor((durSec % 3600) / 60)}m`
            : '—'
          const hasAny = score != null || durSec != null

          if (!hasAny) {
            return (
              <div className="bg-gray-900 rounded-2xl p-4">
                <p className="text-xs text-gray-500 uppercase tracking-wider flex items-center gap-1">
                  Sleep Analysis <InfoTooltip text={METRIC_INFO.sleep} />
                </p>
                <p className="text-gray-500 text-sm mt-2">
                  No sleep recorded in the last 3 nights. Wear your Garmin overnight and sync to populate.
                </p>
              </div>
            )
          }

          return (
            <button
              type="button"
              onClick={() => setSleepDetailOpen(true)}
              className="bg-gray-900 rounded-2xl p-4 text-left w-full hover:bg-gray-900/80 transition-colors"
            >
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-xs text-gray-500 uppercase tracking-wider flex items-center gap-1">
                    Sleep Analysis <InfoTooltip text={METRIC_INFO.sleep} />
                    <span className="text-[10px] text-purple-400/80 ml-1 uppercase">Tap to open</span>
                  </p>
                  {sleepData?.sleep_date && (
                    <p className="text-[10px] text-gray-500 mt-0.5">
                      Night of {new Date(sleepData.sleep_date).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })}
                    </p>
                  )}
                  <p className="text-3xl font-bold text-white mt-1">{score ?? '—'}</p>
                  <p className="text-[11px] text-gray-500 mt-0.5">Duration {durStr}</p>
                </div>
                <div className="flex flex-col items-end gap-1">
                  <div className="text-5xl">🌙</div>
                  <Sparkline values={trends.sleep} color="#a78bfa" />
                </div>
              </div>
            </button>
          )
        })()}

        {/* Stress - Extended */}
        {(metrics?.garmin_stress_avg != null || dailyHealth?.stress_avg != null) && (
          <div className="bg-gray-900 rounded-2xl p-4">
            <div className="flex items-center justify-between mb-3">
              <div>
                <p className="text-xs text-gray-500 uppercase tracking-wider flex items-center gap-1">Stress Levels <InfoTooltip text={METRIC_INFO.stress} /></p>
                <p className="text-3xl font-bold text-white mt-1">
                  {dailyHealth?.stress_avg ?? metrics?.garmin_stress_avg}
                </p>
                <Sparkline values={trends.stress} color="#fbbf24" invert />
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
                <p className="text-xs text-gray-500 flex items-center justify-center gap-1">HRV Avg <InfoTooltip text={METRIC_INFO.hrv} /></p>
                <p className="text-lg font-bold text-green-400">
                  {dailyHealth?.hrv_avg ?? metrics?.garmin_hrv_nightly_avg ?? '—'}
                  {(dailyHealth?.hrv_avg ?? metrics?.garmin_hrv_nightly_avg) != null && <span className="text-xs text-gray-500 font-normal ml-0.5">ms</span>}
                </p>
                <div className="mt-1 flex justify-center"><Sparkline values={trends.hrv} color="#22c55e" width={70} height={18} /></div>
              </div>
            </div>
          </div>
        )}


        {/* Resting HR trend */}
        {(metrics?.resting_hr != null || metrics?.resting_heart_rate_bpm != null) && (
          <div className="bg-gray-900 rounded-2xl p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs text-gray-500 uppercase tracking-wider flex items-center gap-1">Resting Heart Rate <InfoTooltip text={METRIC_INFO.restingHr} /></p>
                <p className="text-3xl font-bold text-white mt-1">
                  {metrics.resting_hr ?? metrics.resting_heart_rate_bpm}
                  <span className="text-sm text-gray-500 font-normal ml-1">bpm</span>
                </p>
              </div>
              <div className="flex flex-col items-end gap-1">
                <div className="text-5xl">❤️</div>
                <Sparkline values={trends.restingHr} color="#ef4444" invert />
              </div>
            </div>
          </div>
        )}

        {/* Hydration */}
        {dailyHealth?.hydration_goal_ml != null && (
          <div className="bg-gray-900 rounded-2xl p-4">
            <div className="flex items-center justify-between mb-3">
              <div>
                <p className="text-xs text-gray-500 uppercase tracking-wider flex items-center gap-1">Hydration <InfoTooltip text={METRIC_INFO.hydration} /></p>
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

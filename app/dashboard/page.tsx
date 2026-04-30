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
  moderate_intensity_minutes: number | null
  vigorous_intensity_minutes: number | null
  intensity_minutes_goal: number | null
}

type ActivitySummary = {
  duration_sec: number | null
  activity_type: string | null
  start_time: string
  calories?: number | null
  raw_payload?: Record<string, unknown> | null
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
  onClick,
}: {
  label: string
  icon: string
  value: number | string | null | undefined
  unit?: string
  tooltip?: string
  trend?: (number | null)[]
  trendColor?: string
  invert?: boolean
  onClick?: () => void
}) {
  const display = value == null || value === '' ? '—' : value
  const inner = (
    <>
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
    </>
  )
  if (onClick) {
    return (
      <button
        type="button"
        onClick={onClick}
        className="bg-gray-800 hover:bg-gray-700/80 rounded-2xl p-3 flex flex-col justify-between min-h-[100px] text-left transition-colors"
      >
        {inner}
      </button>
    )
  }
  return (
    <div className="bg-gray-800 rounded-2xl p-3 flex flex-col justify-between min-h-[100px]">
      {inner}
    </div>
  )
}

// Reusable detail-modal overlay. Matches the Sleep modal styling.
function DetailModal({
  open,
  onClose,
  title,
  subtitle,
  icon,
  gradient = 'from-gray-900 via-gray-900 to-gray-950',
  border = 'border-gray-700/50',
  children,
}: {
  open: boolean
  onClose: () => void
  title: string
  subtitle?: string | null
  icon: string
  gradient?: string
  border?: string
  children: React.ReactNode
}) {
  if (!open) return null
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
    >
      <div
        className={`relative w-full max-w-lg max-h-[85vh] overflow-y-auto bg-gradient-to-br ${gradient} rounded-3xl p-6 border ${border} shadow-2xl`}
        onClick={e => e.stopPropagation()}
      >
        <button
          onClick={onClose}
          aria-label={`Close ${title}`}
          className="absolute top-3 right-3 w-8 h-8 rounded-full bg-gray-800/80 hover:bg-gray-700 text-gray-300 hover:text-white flex items-center justify-center transition-colors"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
        <div className="flex items-center gap-3 mb-4">
          <span className="text-2xl">{icon}</span>
          <div>
            <p className="text-lg font-bold text-white">{title}</p>
            {subtitle && <p className="text-sm text-gray-300">{subtitle}</p>}
          </div>
        </div>
        {children}
        <button
          onClick={onClose}
          className="mt-5 w-full bg-gray-800/80 hover:bg-gray-700 text-gray-200 text-sm py-2 rounded-xl transition-colors"
        >
          Back to dashboard
        </button>
      </div>
    </div>
  )
}

// Bar chart used in the Steps modal. Each bar is colored by goal status:
// green = met goal, red = missed, blue = current period.
function StepsBarChart({
  bars,
  goal,
  goals,
  height = 140,
}: {
  bars: { label: string; value: number; isCurrent: boolean }[]
  goal: number
  goals?: number[] // per-bar goal overrides (for partial weeks/months)
  height?: number
}) {
  if (bars.length === 0) return <p className="text-xs text-gray-500">No data.</p>
  const effectiveGoal = (i: number) => goals?.[i] ?? goal
  const max = Math.max(goal, ...bars.map(b => b.value), 1)
  return (
    <div>
      <div className="flex items-end gap-1" style={{ height }}>
        {bars.map((b, i) => {
          const h = Math.max(2, (b.value / max) * (height - 20))
          const met = b.value >= effectiveGoal(i)
          const color = b.isCurrent ? '#3b82f6' : met ? '#22c55e' : '#ef4444'
          return (
            <div key={i} className="flex-1 flex flex-col items-center justify-end h-full">
              <span className="text-[9px] text-gray-400 mb-0.5">
                {b.value > 0 ? (b.value >= 1000 ? `${(b.value / 1000).toFixed(b.value >= 10000 ? 0 : 1)}k` : b.value) : ''}
              </span>
              <div
                className="w-full rounded-t"
                style={{ height: h, backgroundColor: color, opacity: b.value === 0 ? 0.3 : 1 }}
                title={`${b.label}: ${b.value.toLocaleString()} steps`}
              />
            </div>
          )
        })}
      </div>
      <div className="flex gap-1 mt-1">
        {bars.map((b, i) => (
          <div key={i} className="flex-1 text-center text-[9px] text-gray-500 truncate">{b.label}</div>
        ))}
      </div>
    </div>
  )
}

// Small two-column row used inside DetailModal cards.
function DetailRow({ label, value, color = 'text-white' }: { label: string; value: React.ReactNode; color?: string }) {
  return (
    <div className="flex items-center justify-between py-2 border-b border-gray-700/60 last:border-0">
      <span className="text-sm text-gray-200">{label}</span>
      <span className={`text-base font-bold ${color}`}>{value ?? '—'}</span>
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
  type DailyBriefing = { text: string; generatedAt: string; session: string; read: boolean }
  const [briefing, setBriefing] = useState<DailyBriefing | null>(null)
  const [briefingLoading, setBriefingLoading] = useState(false)
  const [briefingExpanded, setBriefingExpanded] = useState(false)
  const [syncing, setSyncing] = useState(false)
  const [syncMessage, setSyncMessage] = useState<string | null>(null)
  const [lastSyncAt, setLastSyncAt] = useState<string | null>(null)
  const [sleepDetailOpen, setSleepDetailOpen] = useState(false)
  type DetailKey =
    | 'bodyBattery' | 'stress' | 'restingHr' | 'steps'
    | 'hrv' | 'spo2' | 'intensity' | 'readiness' | 'hydration'
  const [openDetail, setOpenDetail] = useState<DetailKey | null>(null)
  const closeDetail = () => setOpenDetail(null)
  const [openTile, setOpenTile] = useState<'reserve' | 'vitals' | 'battery' | null>(null)
  const [intradayBB, setIntradayBB] = useState<{ recorded_at: string; level: number }[]>([])
  const [intradayLoading, setIntradayLoading] = useState(false)
  const [histBB, setHistBB] = useState<{ metric_date: string; body_battery_peak: number | null; body_battery_low: number | null }[]>([])
  const [bbChartTab, setBbChartTab] = useState<'1day' | '7days' | '4weeks'>('1day')
  const [hoveredBBIdx, setHoveredBBIdx] = useState<number | null>(null)
  const [bbChartOffset, setBbChartOffset] = useState(0)
  const [navIntradayBB, setNavIntradayBB] = useState<{ recorded_at: string; level: number }[]>([])
  const [navIntradayLoading, setNavIntradayLoading] = useState(false)
  const [userId, setUserId] = useState<string | null>(null)
  const [stepsHistory, setStepsHistory] = useState<{ step_date: string; total_steps: number | null }[]>([])
  const [hourlySteps, setHourlySteps] = useState<Record<string, number> | null>(null)
  const [stepsTab, setStepsTab] = useState<'day' | 'week' | 'month' | 'year'>('day')
  const [stepsWeekOffset, setStepsWeekOffset] = useState(0) // 0 = current week, 1 = last week, etc.
  const [stepsMonthOffset, setStepsMonthOffset] = useState(0) // 0 = current month
  const [stepsYearOffset, setStepsYearOffset] = useState(0) // 0 = current year

  const [stepGoal, setStepGoal] = useState(10000)
  const [stepGoalInput, setStepGoalInput] = useState('10000')
  const [savingGoal, setSavingGoal] = useState(false)

  // ── Brain insight state ───────────────────────────────────────────────────
  const [dashBrainInsight, setDashBrainInsight] = useState<{
    headline: string; insight: string; suggested_focus: string
    readiness_score: number; readiness_label: 'green' | 'amber' | 'red'; insight_date: string
  } | null>(null)
  const [dashBrainLoading, setDashBrainLoading] = useState(false)

  // ── Check-in state ────────────────────────────────────────────────────────
  type MorningCheckinData = {
    feeling_score: number | null
    body_ache_areas: string[]
    night_wakings: number | null
    sleep_rating: number | null
    energy_level: number | null
    stress_level: number | null
    motivation_level: number | null
  }
  type EveningCheckinData = {
    feeling_score: number | null      // "How was your day?"
    workout_status: number | null     // stored as night_wakings: 0=rest,1=done,2=modified,3=skipped,4=bonus
    nutrition_score: number | null    // stored as sleep_rating: 1–5
    stress_level: number | null
    energy_level: number | null
    motivation_level: number | null   // "Ready for tomorrow?"
  }
  const EMPTY_MORNING: MorningCheckinData = {
    feeling_score: null, body_ache_areas: [], night_wakings: null,
    sleep_rating: null, energy_level: null, stress_level: null, motivation_level: null,
  }
  const EMPTY_EVENING: EveningCheckinData = {
    feeling_score: null, workout_status: null, nutrition_score: null,
    stress_level: null, energy_level: null, motivation_level: null,
  }
  const [morningCheckin, setMorningCheckin] = useState<MorningCheckinData | null>(null)
  const [eveningCheckin, setEveningCheckin] = useState<EveningCheckinData | null>(null)
  const [checkinHistory, setCheckinHistory] = useState<{ check_date: string; check_type: string }[]>([])
  const [checkinLoaded, setCheckinLoaded] = useState(false)
  const [morningModalOpen, setMorningModalOpen] = useState(false)
  const [morningStep, setMorningStep] = useState(0)
  const [morningDraft, setMorningDraft] = useState<MorningCheckinData>(EMPTY_MORNING)
  const [eveningModalOpen, setEveningModalOpen] = useState(false)
  const [eveningStep, setEveningStep] = useState(0)
  const [eveningDraft, setEveningDraft] = useState<EveningCheckinData>(EMPTY_EVENING)
  const [morningStreak, setMorningStreak] = useState(0)
  const [eveningStreak, setEveningStreak] = useState(0)
  const [checkinSaving, setCheckinSaving] = useState(false)
  const [journalTags, setJournalTags] = useState<string[]>([])
  const [journalLoaded, setJournalLoaded] = useState(false)

  // Settings + one-time backfill state
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [backfillOpen, setBackfillOpen] = useState(false)
  const [backfillRunId, setBackfillRunId] = useState<string | null>(null)
  const [backfillDays, setBackfillDays] = useState<number>(365)
  const [backfillStatus, setBackfillStatus] = useState<'idle' | 'starting' | 'running' | 'done' | 'error'>('idle')
  type ProgressRow = {
    id: number
    ts: string
    level: string
    stage: string | null
    message: string
    percent: number | null
    days_total: number | null
    day_index: number | null
  }
  const [progressRows, setProgressRows] = useState<ProgressRow[]>([])
  const [backfillError, setBackfillError] = useState<string | null>(null)
  const [trends, setTrends] = useState<{
    hrv: (number | null)[]
    sleep: (number | null)[]
    bodyBattery: (number | null)[]
    restingHr: (number | null)[]
    stress: (number | null)[]
    steps: (number | null)[]
  }>({ hrv: [], sleep: [], bodyBattery: [], restingHr: [], stress: [], steps: [] })

  const loadIntradayForDate = async (uid: string, date: string) => {
    setNavIntradayLoading(true)
    const { data } = await supabase
      .from('garmin_intraday_body_battery')
      .select('recorded_at, level')
      .eq('user_id', uid).eq('metric_date', date)
      .order('recorded_at', { ascending: true })
    setNavIntradayBB((data ?? []) as { recorded_at: string; level: number }[])
    setNavIntradayLoading(false)
  }

  const loadIntradayBB = async (uid: string) => {
    if (intradayLoading || intradayBB.length > 0) return
    setIntradayLoading(true)
    const today = new Date().toISOString().split('T')[0]
    const ago56 = new Date(Date.now() - 55 * 86400000).toISOString().split('T')[0]
    const [intradayRes, histRes] = await Promise.all([
      supabase.from('garmin_intraday_body_battery')
        .select('recorded_at, level')
        .eq('user_id', uid).eq('metric_date', today)
        .order('recorded_at', { ascending: true }),
      supabase.from('garmin_daily_health_metrics')
        .select('metric_date, body_battery_peak, body_battery_low')
        .eq('user_id', uid).gte('metric_date', ago56)
        .order('metric_date', { ascending: true }),
    ])
    setIntradayBB((intradayRes.data ?? []) as { recorded_at: string; level: number }[])
    setHistBB((histRes.data ?? []) as { metric_date: string; body_battery_peak: number | null; body_battery_low: number | null }[])
    setIntradayLoading(false)
  }

  const loadLastSync = async (userId: string) => {
    const { data } = await supabase
      .from('provider_connections')
      .select('last_successful_sync_at')
      .eq('user_id', userId)
      .eq('provider_type', 'garmin')
      .maybeSingle()
    setLastSyncAt(data?.last_successful_sync_at ?? null)
  }

  const localDateStr = (d: Date) => {
    const y = d.getFullYear()
    const m = String(d.getMonth() + 1).padStart(2, '0')
    const day = String(d.getDate()).padStart(2, '0')
    return `${y}-${m}-${day}`
  }

  const calcCheckinStreak = (type: string, history: { check_date: string; check_type: string }[]) => {
    const dates = history.filter(r => r.check_type === type).map(r => r.check_date).sort().reverse()
    if (dates.length === 0) return 0
    let streak = 0
    const d = new Date(); d.setHours(0, 0, 0, 0)
    for (const date of dates) {
      const expected = localDateStr(d)
      if (date === expected) { streak++; d.setDate(d.getDate() - 1) } else break
    }
    return streak
  }

  const loadCheckin = async (uid: string) => {
    const ago14d = new Date(); ago14d.setDate(ago14d.getDate() - 14)
    const ago14 = localDateStr(ago14d)
    const today = localDateStr(new Date())
    const { data } = await supabase
      .from('daily_checkin')
      .select('check_date, check_type, feeling_score, body_ache_areas, night_wakings, sleep_rating, energy_level, stress_level, motivation_level')
      .eq('user_id', uid)
      .gte('check_date', ago14)
      .order('check_date', { ascending: false })
    type Row = { check_date: string; check_type: string; feeling_score: number | null; body_ache_areas: string[] | null; night_wakings: number | null; sleep_rating: number | null; energy_level: number | null; stress_level: number | null; motivation_level: number | null }
    const rows = (data ?? []) as Row[]
    const hist = rows.map(r => ({ check_date: r.check_date, check_type: r.check_type }))
    setCheckinHistory(hist)
    setMorningStreak(calcCheckinStreak('morning', hist))
    setEveningStreak(calcCheckinStreak('evening', hist))
    const tm = rows.find(r => r.check_date === today && r.check_type === 'morning')
    const te = rows.find(r => r.check_date === today && r.check_type === 'evening')
    setMorningCheckin(tm ? { feeling_score: tm.feeling_score, body_ache_areas: tm.body_ache_areas ?? [], night_wakings: tm.night_wakings, sleep_rating: tm.sleep_rating, energy_level: tm.energy_level, stress_level: tm.stress_level, motivation_level: tm.motivation_level } : null)
    setEveningCheckin(te ? {
      feeling_score: te.feeling_score,
      workout_status: te.night_wakings,
      nutrition_score: te.sleep_rating,
      stress_level: te.stress_level,
      energy_level: te.energy_level,
      motivation_level: te.motivation_level,
    } : null)
    setCheckinLoaded(true)
    // Load today's journal entry alongside check-in
    const todayForJournal = localDateStr(new Date())
    const { data: jData } = await supabase
      .from('daily_journal')
      .select('tags')
      .eq('user_id', uid)
      .eq('journal_date', todayForJournal)
      .maybeSingle()
    setJournalTags((jData as { tags?: string[] } | null)?.tags ?? [])
    setJournalLoaded(true)
  }

  const toggleJournalTag = async (tag: string) => {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return
    const today = localDateStr(new Date())
    const newTags = journalTags.includes(tag)
      ? journalTags.filter(t => t !== tag)
      : [...journalTags, tag]
    setJournalTags(newTags)
    await supabase.from('daily_journal').upsert(
      { user_id: user.id, journal_date: today, tags: newTags, updated_at: new Date().toISOString() },
      { onConflict: 'user_id,journal_date' }
    )
  }

  const saveMorningCheckin = async (draft: MorningCheckinData) => {
    if (checkinSaving) return
    setCheckinSaving(true)
    const today = localDateStr(new Date())
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) { setCheckinSaving(false); return }
    await supabase.from('daily_checkin').upsert({
      user_id: user.id, check_date: today, check_type: 'morning',
      feeling_score: draft.feeling_score,
      body_ache_areas: draft.body_ache_areas,
      night_wakings: draft.night_wakings,
      sleep_rating: draft.sleep_rating,
      energy_level: draft.energy_level,
      stress_level: draft.stress_level,
      motivation_level: draft.motivation_level,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'user_id,check_date,check_type' })
    setMorningCheckin(draft)
    const hist = [...checkinHistory.filter(r => !(r.check_date === today && r.check_type === 'morning')), { check_date: today, check_type: 'morning' }]
    setCheckinHistory(hist)
    setMorningStreak(calcCheckinStreak('morning', hist))
    setCheckinSaving(false)
  }

  const saveEveningCheckin = async (draft: EveningCheckinData) => {
    if (checkinSaving) return
    setCheckinSaving(true)
    const today = localDateStr(new Date())
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) { setCheckinSaving(false); return }
    await supabase.from('daily_checkin').upsert({
      user_id: user.id, check_date: today, check_type: 'evening',
      feeling_score: draft.feeling_score,
      night_wakings: draft.workout_status,
      sleep_rating: draft.nutrition_score,
      stress_level: draft.stress_level,
      energy_level: draft.energy_level,
      motivation_level: draft.motivation_level,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'user_id,check_date,check_type' })
    setEveningCheckin(draft)
    const hist = [...checkinHistory.filter(r => !(r.check_date === today && r.check_type === 'evening')), { check_date: today, check_type: 'evening' }]
    setCheckinHistory(hist)
    setEveningStreak(calcCheckinStreak('evening', hist))
    setCheckinSaving(false)
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
    const { data: sleepRows, error: sleepErr } = await supabase
      .from('garmin_sleep_data')
      .select(`sleep_date, sleep_duration_seconds, sleep_score, sleep_quality_score,
        awake_seconds, light_sleep_seconds, deep_sleep_seconds, rem_sleep_seconds,
        avg_spo2, min_spo2, avg_respiration_bpm, avg_heart_rate_bpm, max_heart_rate_bpm,
        sleep_stress_score, sleep_hr_avg, sleep_hr_max, sleep_start, sleep_end`)
      .eq('user_id', userId)
      .gte('sleep_date', sevenAgo)
      .order('sleep_date', { ascending: false })
      .limit(7)

    // Pick the most complete recent row. Garmin sometimes writes partial rows
    // (score only, no stages / HR / SpO2) for the current day; prefer a full row
    // from an earlier night over a skeletal current-day row.
    const scoreCompleteness = (r: Record<string, unknown>) => {
      const fields = [
        'sleep_score', 'sleep_duration_seconds',
        'deep_sleep_seconds', 'light_sleep_seconds', 'rem_sleep_seconds', 'awake_seconds',
        'avg_heart_rate_bpm', 'max_heart_rate_bpm', 'avg_spo2', 'min_spo2',
        'avg_respiration_bpm', 'sleep_stress_score', 'sleep_start', 'sleep_end',
      ]
      return fields.reduce((acc, k) => {
        const v = r[k]
        return acc + (v != null && v !== 0 ? 1 : 0)
      }, 0)
    }
    // Rank every candidate; prefer completeness but never return null if any
    // row has at least a score or duration — a partial row beats "Most recent night"
    // with no data at all.
    const scored = (sleepRows ?? [])
      .map(r => ({ r, score: scoreCompleteness(r as Record<string, unknown>) }))
      .filter(x => x.score >= 1)
      .sort((a, b) => b.score - a.score || (a.r.sleep_date > b.r.sleep_date ? -1 : 1))
    const ranked = scored.filter(x => x.score >= 3)
    const firstRealSleep = ranked[0]?.r ?? scored[0]?.r ?? null
    setSleepData((firstRealSleep ?? null) as SleepData | null)
    if (typeof window !== 'undefined') {
      console.log('[dashboard] sleep query', {
        userId,
        sevenAgo,
        err: sleepErr?.message,
        rowCount: sleepRows?.length ?? 0,
        dates: (sleepRows ?? []).map(r => r.sleep_date),
        ranked: ranked.map(x => ({ date: x.r.sleep_date, score: x.score })),
        firstReal: firstRealSleep?.sleep_date,
        firstRealScore: firstRealSleep?.sleep_score,
      })
    }

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
      .select(`step_date, total_steps, total_distance_meters, total_calories, active_minutes, moderate_intensity_minutes, vigorous_intensity_minutes, intensity_minutes_goal, hourly_steps`)
      .eq('user_id', userId)
      .eq('step_date', today)
      .maybeSingle()

    setDailySteps(steps as DailySteps | null)
    const rawHourly = (steps as unknown as { hourly_steps?: unknown } | null)?.hourly_steps
    if (rawHourly) {
      const map: Record<string, number> = {}
      if (Array.isArray(rawHourly)) {
        for (const r of rawHourly as { hour?: number | string; steps?: number; total?: number }[]) {
          if (r && r.hour != null) map[String(r.hour)] = Number(r.steps ?? r.total ?? 0)
        }
      } else if (typeof rawHourly === 'object') {
        for (const [k, v] of Object.entries(rawHourly as Record<string, unknown>)) {
          map[k] = Number(v) || 0
        }
      }
      setHourlySteps(map)
    } else {
      setHourlySteps(null)
    }

    // 365-day step history for the Steps modal (Day/Week/Month/Year tabs).
    // Pull from both garmin_daily_steps AND the legacy daily_health_metrics.steps
    // so older days still show up even if the v2 table wasn't populated back then.
    const yearAgo = new Date(Date.now() - 365 * 86400000).toISOString().split('T')[0]
    const [primary, legacy] = await Promise.all([
      supabase
        .from('garmin_daily_steps')
        .select('step_date, total_steps')
        .eq('user_id', userId)
        .gte('step_date', yearAgo)
        .order('step_date', { ascending: true }),
      supabase
        .from('daily_health_metrics')
        .select('metric_date, steps')
        .eq('user_id', userId)
        .gte('metric_date', yearAgo)
        .order('metric_date', { ascending: true }),
    ])
    const merged = new Map<string, number | null>()
    for (const r of (legacy.data ?? []) as { metric_date: string; steps: number | null }[]) {
      if (r.metric_date && r.steps != null) merged.set(r.metric_date, r.steps)
    }
    // garmin_daily_steps takes precedence when both exist
    for (const r of (primary.data ?? []) as { step_date: string; total_steps: number | null }[]) {
      if (r.step_date && r.total_steps != null) merged.set(r.step_date, r.total_steps)
    }
    const history = Array.from(merged.entries())
      .map(([step_date, total_steps]) => ({ step_date, total_steps }))
      .sort((a, b) => a.step_date.localeCompare(b.step_date))
    setStepsHistory(history)
    if (typeof window !== 'undefined') {
      console.log('[dashboard] steps history loaded:', history.length, 'days',
        'primary:', primary.data?.length ?? 0, 'legacy:', legacy.data?.length ?? 0)
    }

    const weekAgo = new Date(Date.now() - 7 * 86400000).toISOString()
    const { data: acts } = await supabase
      .from('garmin_activities')
      .select('duration_sec, activity_type, start_time, calories, raw_payload')
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

    await loadCheckin(userId)
  }

  useEffect(() => {
    const load = async () => {
      const { data } = await supabase.auth.getSession()
      if (!data.session) { router.push('/login'); return }
      const user = data.session.user

      const { data: profile } = await supabase
        .from('profiles')
        .select('display_name, name, step_goal')
        .eq('user_id', user.id)
        .maybeSingle()
      setDisplayName(profile?.display_name ?? profile?.name ?? user.email ?? '')
      const loadedGoal = (profile as { step_goal?: number | null } | null)?.step_goal ?? 10000
      setStepGoal(loadedGoal)
      setStepGoalInput(String(loadedGoal))

      setUserId(user.id)
      await Promise.all([loadDashboardData(user.id), loadLastSync(user.id)])
      // Load brain insight
      try {
        const { data: insightRow } = await supabase
          .from('daily_insights')
          .select('insight_date, insight_text, readiness_score, readiness_label, suggested_focus, raw_context')
          .eq('user_id', user.id)
          .order('insight_date', { ascending: false })
          .limit(1)
          .maybeSingle()
        if (insightRow) {
          const r = insightRow as { insight_date: string; insight_text: string; readiness_score: number; readiness_label: 'green' | 'amber' | 'red'; suggested_focus: string; raw_context: { headline?: string } | null }
          setDashBrainInsight({ headline: r.raw_context?.headline ?? '', insight: r.insight_text, suggested_focus: r.suggested_focus, readiness_score: r.readiness_score, readiness_label: r.readiness_label, insight_date: r.insight_date })
        }
      } catch { /* optional */ }
      setLoading(false)
    }
    load()
  }, [router])

  const saveStepGoal = async () => {
    const val = parseInt(stepGoalInput, 10)
    if (isNaN(val) || val < 100 || val > 100000) return
    setSavingGoal(true)
    const { data: sessionData } = await supabase.auth.getSession()
    const user = sessionData.session?.user
    if (user) {
      await supabase.from('profiles').update({ step_goal: val }).eq('user_id', user.id)
      setStepGoal(val)
    }
    setSavingGoal(false)
  }

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
        if (Date.now() - startedAt > 12 * 60_000) {
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

  // One-time backfill: dispatches the sync workflow with a large days_back and
  // streams progress rows from garmin_sync_progress while it runs.
  const handleBackfill = async (days: number) => {
    setBackfillDays(days)
    setBackfillStatus('starting')
    setBackfillError(null)
    setProgressRows([])
    setSettingsOpen(false)
    setBackfillOpen(true)
    try {
      const res = await fetch('/api/integrations/garmin/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          days_back: days,
          // Stay polite on long backfills.
          request_delay: days > 30 ? 1.5 : 1.0,
          reason: `manual-backfill-${days}d`,
        }),
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) {
        setBackfillError(body.error ?? `Sync failed (${res.status})`)
        setBackfillStatus('error')
        return
      }
      if (body.run_id) {
        setBackfillRunId(body.run_id)
        setBackfillStatus('running')
      } else {
        setBackfillError('No run_id returned')
        setBackfillStatus('error')
      }
    } catch (err) {
      setBackfillError(err instanceof Error ? err.message : 'Sync failed to start')
      setBackfillStatus('error')
    }
  }

  // Poll garmin_sync_progress for the active run id every 2s.
  useEffect(() => {
    if (!backfillRunId || backfillStatus !== 'running') return
    let cancelled = false
    let lastId = 0
    const tick = async () => {
      const { data } = await supabase
        .from('garmin_sync_progress')
        .select('id, ts, level, stage, message, percent, days_total, day_index')
        .eq('run_id', backfillRunId)
        .gt('id', lastId)
        .order('id', { ascending: true })
        .limit(200)
      if (cancelled) return
      if (data && data.length > 0) {
        lastId = data[data.length - 1].id as number
        setProgressRows(prev => [...prev, ...(data as ProgressRow[])])
        const last = data[data.length - 1] as ProgressRow
        if (last.level === 'done' || last.stage === 'complete') {
          setBackfillStatus('done')
          // Refresh dashboard data so the new history is reflected.
          const { data: auth } = await supabase.auth.getSession()
          const userId = auth.session?.user.id
          if (userId) {
            await Promise.all([loadDashboardData(userId), loadLastSync(userId)])
          }
          return
        }
        if (last.level === 'error') {
          setBackfillError(last.message)
          setBackfillStatus('error')
          return
        }
      }
      if (!cancelled) setTimeout(tick, 2000)
    }
    tick()
    return () => { cancelled = true }
  }, [backfillRunId, backfillStatus])

  // Latest progress row drives the headline + percent in the modal.
  const latestProgress = progressRows[progressRows.length - 1] ?? null

  const getDaySession = (h: number) => h < 12 ? 'morning' : h < 17 ? 'afternoon' : 'evening'
  const sessionLabel = (s: string) => s === 'morning' ? '🌅 Morning Briefing' : s === 'afternoon' ? '☀️ Afternoon Check-in' : '🌙 Evening Report'

  const fetchDailyBriefing = async () => {
    if (briefingLoading) return
    const now = new Date()
    const today = now.toISOString().split('T')[0]
    const session = getDaySession(now.getHours())
    const storageKey = `daily_briefing_${today}_${session}`
    // Check cache
    try {
      const cached = localStorage.getItem(storageKey)
      if (cached) {
        const parsed = JSON.parse(cached) as DailyBriefing
        setBriefing(parsed)
        setBriefingExpanded(parsed.read)
        return
      }
    } catch { /* ignore */ }
    setBriefingLoading(true)
    try {
      const stepsVal = dailySteps?.total_steps ?? metrics?.steps ?? null
      const bodyBatteryEnd = dailyHealth?.body_battery_end ?? metrics?.garmin_body_battery_eod ?? null
      const _hrv = dailyHealth?.hrv_avg ?? metrics?.garmin_hrv_nightly_avg ?? null
      const _hrvStatus = (dailyHealth?.hrv_status ?? metrics?.garmin_hrv_status ?? '').toLowerCase()
      const _sleep = sleepData?.sleep_score ?? metrics?.garmin_sleep_score ?? null
      const _rhr = metrics?.resting_hr ?? metrics?.resting_heart_rate_bpm ?? null
      // HRV score: use Garmin's own status when available (they know your baseline),
      // otherwise normalise raw value on 20–80ms range
      const _hrvScore = _hrv != null
        ? _hrvStatus.includes('balanced') || _hrvStatus.includes('good') ? Math.min(85, 50 + (_hrv - 30) * 1.5)
        : _hrvStatus.includes('poor') || _hrvStatus.includes('low') ? Math.max(15, 40 - (40 - _hrv))
        : Math.max(0, Math.min(100, ((_hrv - 20) / 60) * 100))  // fallback: 20–80ms range
        : null
      let _rs = 0, _rw = 0
      if (_hrvScore != null) { _rs += _hrvScore * 0.45; _rw += 0.45 }
      if (_sleep != null) { _rs += _sleep * 0.35; _rw += 0.35 }
      if (_rhr != null) { _rs += (100 - ((Math.max(40, Math.min(80, _rhr)) - 40) / 40) * 100) * 0.20; _rw += 0.20 }
      const readinessScore = _rw > 0 ? Math.round(_rs / _rw) : null
      const readinessLbl = readinessScore == null ? null
        : readinessScore >= 70 ? 'Well recovered'
        : readinessScore >= 50 ? 'Moderate'
        : 'Low recovery'
      const recentActs = activities.slice(0, 7).map(a => ({
        type: a.activity_type?.replace(/_/g, ' ') ?? 'activity',
        durationMin: a.duration_sec ? Math.round(a.duration_sec / 60) : null,
        distanceKm: null as number | null,
        avgHr: null as number | null,
        calories: null as number | null,
        trainingEffect: null as number | null,
        date: new Date(a.start_time).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' }),
      }))
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
            stepGoal: stepGoal,
            spo2: dailyHealth?.spo2_avg ?? metrics?.garmin_spo2_avg ?? metrics?.pulse_ox ?? null,
            respirationAwake: dailyHealth?.respiration_avg_bpm ?? null,
            respirationSleep: sleepData?.avg_respiration_bpm ?? null,
            intensityMinutes: dailySteps?.moderate_intensity_minutes ?? null,
            intensityGoal: null,
            readinessScore,
            readinessLabel: readinessLbl,
            date: today,
            localHour: now.getHours(),
          },
          activities: recentActs,
        }),
      })
      const data = await res.json() as { insight?: string }
      if (res.ok && data.insight) {
        const newBriefing: DailyBriefing = {
          text: data.insight,
          generatedAt: now.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }),
          session,
          read: false,
        }
        setBriefing(newBriefing)
        setBriefingExpanded(false)
        try { localStorage.setItem(storageKey, JSON.stringify(newBriefing)) } catch { /* ignore */ }
      }
    } catch { /* ignore */ } finally {
      setBriefingLoading(false)
    }
  }

  useEffect(() => {
    if (!loading && (metrics || dailyHealth) && !briefing && !briefingLoading) {
      fetchDailyBriefing()
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading])

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
    <main className="min-h-screen bg-gray-950 p-4 md:p-8 pb-32">
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
                <p className="text-[10px] text-gray-300 uppercase tracking-wider font-semibold">Score</p>
                <p className="text-2xl font-bold text-white mt-0.5">{sleepData?.sleep_score ?? metrics?.garmin_sleep_score ?? '—'}</p>
              </div>
              <div className="bg-gray-800/80 rounded-xl p-3 text-center">
                <p className="text-[10px] text-gray-300 uppercase tracking-wider font-semibold">Duration</p>
                <p className="text-2xl font-bold text-white mt-0.5">
                  {(() => {
                    const sec = sleepData?.sleep_duration_seconds ?? (metrics?.sleep_minutes != null ? metrics.sleep_minutes * 60 : null)
                    return sec ? `${Math.floor(sec / 3600)}h ${Math.floor((sec % 3600) / 60)}m` : '—'
                  })()}
                </p>
              </div>
              <div className="bg-gray-800/80 rounded-xl p-3 text-center">
                <p className="text-[10px] text-gray-300 uppercase tracking-wider font-semibold">Quality</p>
                <p className="text-2xl font-bold text-white mt-0.5">{sleepData?.sleep_quality_score ?? '—'}</p>
              </div>
            </div>

            {/* Sleep Stages bar chart */}
            {sleepData && (sleepData.awake_seconds != null || sleepData.light_sleep_seconds != null || sleepData.deep_sleep_seconds != null || sleepData.rem_sleep_seconds != null) ? (
              <div className="mb-4">
                <p className="text-xs text-gray-300 uppercase tracking-wider font-semibold mb-2">Sleep Stages</p>
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
            <p className="text-xs text-gray-300 uppercase tracking-wider font-semibold mb-2 mt-4">Sleep Timeline Metrics</p>
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

      {/* Body Battery detail */}
      <DetailModal
        open={openDetail === 'bodyBattery'}
        onClose={closeDetail}
        title="Body Battery"
        subtitle="Energy reservoir across the day"
        icon="⚡"
        gradient="from-blue-950/90 via-gray-900 to-gray-950"
        border="border-blue-500/30"
      >
        {(() => {
          // Fallback chain: dailyHealth (v2) → metrics (legacy). Some Garmin payloads
          // only expose high/low, so infer start/peak when those are missing.
          const start = dailyHealth?.body_battery_start ?? metrics?.garmin_body_battery_high ?? null
          const peak = dailyHealth?.body_battery_peak ?? metrics?.garmin_body_battery_high ?? null
          const low = dailyHealth?.body_battery_low ?? null
          const end = dailyHealth?.body_battery_end ?? metrics?.garmin_body_battery_eod ?? null
          const drain = peak != null && low != null ? peak - low : null
          const recovery = start != null && peak != null && peak >= start ? peak - start : null
          return (
            <>
              <div className="grid grid-cols-3 gap-2 mb-4">
                <div className="bg-gray-800/80 rounded-xl p-3 text-center">
                  <p className="text-[10px] text-gray-300 uppercase font-semibold">Start</p>
                  <p className="text-2xl font-bold text-green-400 mt-0.5">{start ?? '—'}</p>
                </div>
                <div className="bg-gray-800/80 rounded-xl p-3 text-center">
                  <p className="text-[10px] text-gray-300 uppercase font-semibold">Peak</p>
                  <p className="text-2xl font-bold text-blue-400 mt-0.5">{peak ?? '—'}</p>
                </div>
                <div className="bg-gray-800/80 rounded-xl p-3 text-center">
                  <p className="text-[10px] text-gray-300 uppercase font-semibold">Low</p>
                  <p className="text-2xl font-bold text-red-400 mt-0.5">{low ?? '—'}</p>
                </div>
              </div>
              <div className="bg-gray-800/40 rounded-xl p-3 space-y-1">
                <DetailRow label="End of day" value={end ?? '—'} color="text-blue-300" />
                <DetailRow label="Total drain" value={drain != null ? drain : '—'} />
                <DetailRow label="Recovery (start→peak)" value={recovery != null ? `+${recovery}` : '—'} color="text-green-400" />
              </div>
            </>
          )
        })()}
        <p className="text-xs text-gray-300 uppercase tracking-wider font-semibold mt-4 mb-2">7-day trend</p>
        <div className="bg-gray-800/40 rounded-xl p-3"><Sparkline values={trends.bodyBattery} color="#60a5fa" width={420} height={48} /></div>
        <p className="text-xs text-gray-300 mt-3 leading-snug">
          Body Battery climbs with rest and good sleep, drains with stress and activity. A higher end-of-day value means you have reserves left for tomorrow.
        </p>
      </DetailModal>

      {/* Stress detail */}
      <DetailModal
        open={openDetail === 'stress'}
        onClose={closeDetail}
        title="Stress Levels"
        subtitle="All-day autonomic stress score"
        icon="😌"
        gradient="from-yellow-950/90 via-gray-900 to-gray-950"
        border="border-yellow-500/30"
      >
        <div className="grid grid-cols-2 gap-2 mb-4">
          <div className="bg-gray-800/80 rounded-xl p-3 text-center">
            <p className="text-[10px] text-gray-300 uppercase font-semibold">Avg</p>
            <p className="text-2xl font-bold text-yellow-300 mt-0.5">{dailyHealth?.stress_avg ?? metrics?.garmin_stress_avg ?? '—'}</p>
          </div>
          <div className="bg-gray-800/80 rounded-xl p-3 text-center">
            <p className="text-[10px] text-gray-300 uppercase font-semibold">Max</p>
            <p className="text-2xl font-bold text-red-400 mt-0.5">{dailyHealth?.stress_max ?? '—'}</p>
          </div>
        </div>
        <div className="bg-gray-800/40 rounded-xl p-3 space-y-1">
          <DetailRow label="Status" value={
            (() => {
              const v = dailyHealth?.stress_avg ?? metrics?.garmin_stress_avg ?? null
              if (v == null) return '—'
              if (v < 26) return 'Rest'
              if (v < 51) return 'Low'
              if (v < 76) return 'Medium'
              return 'High'
            })()
          } />
          <DetailRow label="HRV avg (overnight)" value={
            (dailyHealth?.hrv_avg ?? metrics?.garmin_hrv_nightly_avg) != null
              ? `${dailyHealth?.hrv_avg ?? metrics?.garmin_hrv_nightly_avg} ms`
              : '—'
          } color="text-green-400" />
        </div>
        <p className="text-xs text-gray-300 uppercase tracking-wider font-semibold mt-4 mb-2">7-day stress trend</p>
        <div className="bg-gray-800/40 rounded-xl p-3"><Sparkline values={trends.stress} color="#fbbf24" width={420} height={48} invert /></div>
        <p className="text-xs text-gray-300 mt-3 leading-snug">
          0–25 rest, 26–50 low, 51–75 medium, 76–100 high. Persistently elevated stress suggests you need more recovery — sleep, easy days, or a rest day.
        </p>
      </DetailModal>

      {/* Resting HR detail */}
      <DetailModal
        open={openDetail === 'restingHr'}
        onClose={closeDetail}
        title="Resting Heart Rate"
        subtitle="Lowest stable heart rate while asleep"
        icon="❤️"
        gradient="from-red-950/90 via-gray-900 to-gray-950"
        border="border-red-500/30"
      >
        {(() => {
          const cur = metrics?.resting_hr ?? metrics?.resting_heart_rate_bpm ?? null
          const series = trends.restingHr.filter((v): v is number => v != null)
          const avg = series.length ? Math.round(series.reduce((a, b) => a + b, 0) / series.length) : null
          const min = series.length ? Math.min(...series) : null
          const max = series.length ? Math.max(...series) : null
          return (
            <>
              <div className="grid grid-cols-3 gap-2 mb-4">
                <div className="bg-gray-800/80 rounded-xl p-3 text-center">
                  <p className="text-[10px] text-gray-300 uppercase font-semibold">Today</p>
                  <p className="text-2xl font-bold text-red-300 mt-0.5">{cur ?? '—'}<span className="text-xs text-gray-500 ml-0.5">bpm</span></p>
                </div>
                <div className="bg-gray-800/80 rounded-xl p-3 text-center">
                  <p className="text-[10px] text-gray-300 uppercase font-semibold">7-day avg</p>
                  <p className="text-2xl font-bold text-white mt-0.5">{avg ?? '—'}</p>
                </div>
                <div className="bg-gray-800/80 rounded-xl p-3 text-center">
                  <p className="text-[10px] text-gray-300 uppercase font-semibold">Range</p>
                  <p className="text-2xl font-bold text-white mt-0.5">{min != null ? `${min}-${max}` : '—'}</p>
                </div>
              </div>
              <p className="text-xs text-gray-300 uppercase tracking-wider font-semibold mb-2">7-day RHR</p>
              <div className="bg-gray-800/40 rounded-xl p-3"><Sparkline values={trends.restingHr} color="#ef4444" width={420} height={48} invert /></div>
              <p className="text-xs text-gray-300 mt-3 leading-snug">
                A lower RHR usually means better cardio fitness or recovery. A spike of 5+ bpm above your baseline often signals stress, illness, alcohol, or insufficient recovery.
              </p>
            </>
          )
        })()}
      </DetailModal>

      {/* Steps detail — tabbed: Day / Week / Month / Year */}
      <DetailModal
        open={openDetail === 'steps'}
        onClose={closeDetail}
        title="Daily Steps"
        subtitle="Day · Week · Month · Year"
        icon="🦶"
        gradient="from-orange-950/90 via-gray-900 to-gray-950"
        border="border-orange-500/30"
      >
        {(() => {
          const DAILY_GOAL = 10000
          const WEEKLY_GOAL = DAILY_GOAL * 7
          const totalSteps = dailySteps?.total_steps ?? metrics?.steps ?? 0
          const distKm = dailySteps?.total_distance_meters
            ? (dailySteps.total_distance_meters / 1000).toFixed(2)
            : metrics?.distance_m ? (metrics.distance_m / 1000).toFixed(2) : '—'
          const activeMin = dailySteps?.active_minutes ?? null

          // Index history by date for quick lookup
          const byDate = new Map<string, number>()
          for (const r of stepsHistory) {
            byDate.set(r.step_date, r.total_steps ?? 0)
          }
          const localDateStr = (d: Date): string => {
            const y = d.getFullYear()
            const m = String(d.getMonth() + 1).padStart(2, '0')
            const day = String(d.getDate()).padStart(2, '0')
            return `${y}-${m}-${day}`
          }
          // Ensure today's value is reflected (history query might not include today yet)
          const todayStr = localDateStr(new Date())
          if (!byDate.has(todayStr)) byDate.set(todayStr, totalSteps)

          // ---- Day view: intraday hourly sparkline + cumulative line ----
          const renderDay = () => {
            const hours = Array.from({ length: 24 }, (_, h) => hourlySteps?.[String(h)] ?? 0)
            const cumulative: number[] = []
            let acc = 0
            for (const v of hours) { acc += v; cumulative.push(acc) }
            const hasIntraday = hourlySteps && Object.keys(hourlySteps).length > 0
            const pct = Math.min(100, (totalSteps / DAILY_GOAL) * 100)
            const goalColor = totalSteps >= DAILY_GOAL ? '#22c55e' : '#f97316'
            return (
              <>
                <div className="grid grid-cols-3 gap-2 mb-4">
                  <div className="bg-gray-800/80 rounded-xl p-3 text-center">
                    <p className="text-[10px] text-gray-300 uppercase font-semibold">Today</p>
                    <p className="text-2xl font-bold text-orange-300 mt-0.5">{totalSteps.toLocaleString()}</p>
                  </div>
                  <div className="bg-gray-800/80 rounded-xl p-3 text-center">
                    <p className="text-[10px] text-gray-300 uppercase font-semibold">Distance</p>
                    <p className="text-2xl font-bold text-white mt-0.5">{distKm}<span className="text-xs text-gray-500 ml-0.5">km</span></p>
                  </div>
                  <div className="bg-gray-800/80 rounded-xl p-3 text-center">
                    <p className="text-[10px] text-gray-300 uppercase font-semibold">Active</p>
                    <p className="text-2xl font-bold text-white mt-0.5">{activeMin ?? '—'}<span className="text-xs text-gray-500 ml-0.5">min</span></p>
                  </div>
                </div>
                <p className="text-xs text-gray-300 uppercase tracking-wider font-semibold mb-2">Progress to 10,000 goal</p>
                <div className="w-full bg-gray-800 rounded-full h-3 mb-3">
                  <div className="h-3 rounded-full transition-all" style={{ width: `${pct}%`, backgroundColor: goalColor }} />
                </div>
                <p className="text-xs text-gray-300 uppercase tracking-wider font-semibold mb-2">Cumulative today (0 → 10k)</p>
                <div className="bg-gray-800/40 rounded-xl p-3">
                  <Sparkline values={cumulative} color={goalColor} width={420} height={56} />
                  <div className="flex justify-between text-[10px] text-gray-500 mt-1">
                    <span>00:00</span><span>06:00</span><span>12:00</span><span>18:00</span><span>23:59</span>
                  </div>
                </div>
                {!hasIntraday && (
                  <p className="text-xs text-gray-400 mt-2 italic">Intraday breakdown not in last sync — line shows projected accumulation at total.</p>
                )}
              </>
            )
          }

          // ---- Week view: 7 daily bars ----
          const renderWeek = () => {
            // Week starts Monday, offset by stepsWeekOffset weeks back
            const base = new Date()
            base.setDate(base.getDate() - stepsWeekOffset * 7)
            const jsDay = base.getDay() // 0=Sun
            const mondayOff = (jsDay + 6) % 7
            const monday = new Date(base)
            monday.setDate(base.getDate() - mondayOff)
            const sunday = new Date(monday)
            sunday.setDate(monday.getDate() + 6)
            const fmtShort = (d: Date) => d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
            const weekLabel = `${fmtShort(monday)} – ${fmtShort(sunday)}`
            const days: { label: string; value: number; isCurrent: boolean }[] = []
            for (let i = 0; i < 7; i++) {
              const d = new Date(monday)
              d.setDate(monday.getDate() + i)
              const key = localDateStr(d)
              days.push({
                label: ['Mon','Tue','Wed','Thu','Fri','Sat','Sun'][i],
                value: byDate.get(key) ?? 0,
                isCurrent: key === todayStr,
              })
            }
            const totalWeek = days.reduce((s, d) => s + d.value, 0)
            const daysMet = days.filter(d => d.value >= DAILY_GOAL).length
            return (
              <>
                <div className="flex items-center justify-between mb-3">
                  <button type="button" onClick={() => setStepsWeekOffset(o => o + 1)} className="w-8 h-8 flex items-center justify-center rounded-lg bg-gray-800 hover:bg-gray-700 text-gray-300 text-lg">‹</button>
                  <span className="text-xs text-gray-400 font-medium">{weekLabel}</span>
                  <button type="button" onClick={() => setStepsWeekOffset(o => Math.max(0, o - 1))} disabled={stepsWeekOffset === 0} className="w-8 h-8 flex items-center justify-center rounded-lg bg-gray-800 hover:bg-gray-700 text-gray-300 text-lg disabled:opacity-30">›</button>
                </div>
                <div className="grid grid-cols-3 gap-2 mb-4">
                  <div className="bg-gray-800/80 rounded-xl p-3 text-center">
                    <p className="text-[10px] text-gray-300 uppercase font-semibold">Week total</p>
                    <p className="text-xl font-bold text-orange-300 mt-0.5">{totalWeek.toLocaleString()}</p>
                  </div>
                  <div className="bg-gray-800/80 rounded-xl p-3 text-center">
                    <p className="text-[10px] text-gray-300 uppercase font-semibold">Days met</p>
                    <p className="text-xl font-bold text-green-400 mt-0.5">{daysMet}/7</p>
                  </div>
                  <div className="bg-gray-800/80 rounded-xl p-3 text-center">
                    <p className="text-[10px] text-gray-300 uppercase font-semibold">Avg / day</p>
                    <p className="text-xl font-bold text-white mt-0.5">{Math.round(totalWeek / 7).toLocaleString()}</p>
                  </div>
                </div>
                <div className="bg-gray-800/40 rounded-xl p-3">
                  <StepsBarChart bars={days} goal={DAILY_GOAL} height={140} />
                </div>
              </>
            )
          }

          // ---- Month view: weeks in selected calendar month ----
          const renderMonth = () => {
            const base = new Date()
            base.setDate(1)
            base.setMonth(base.getMonth() - stepsMonthOffset)
            const y = base.getFullYear(), mo = base.getMonth()
            const firstOfMonth = new Date(y, mo, 1)
            const lastOfMonth = new Date(y, mo + 1, 0)
            // Build weeks starting Monday
            const weeks: { start: Date; end: Date; total: number; isCurrent: boolean; label: string }[] = []
            const cursor = new Date(firstOfMonth)
            // back up to the Monday of the first week
            cursor.setDate(cursor.getDate() - ((cursor.getDay() + 6) % 7))
            while (cursor <= lastOfMonth) {
              const weekStart = new Date(cursor)
              const weekEnd = new Date(cursor)
              weekEnd.setDate(weekEnd.getDate() + 6)
              let total = 0
              let isCurrent = false
              for (let i = 0; i < 7; i++) {
                const d = new Date(weekStart)
                d.setDate(d.getDate() + i)
                const key = localDateStr(d)
                total += byDate.get(key) ?? 0
                if (key === todayStr) isCurrent = true
              }
              weeks.push({
                start: weekStart,
                end: weekEnd,
                total,
                isCurrent,
                label: `W${weeks.length + 1}`,
              })
              cursor.setDate(cursor.getDate() + 7)
            }
            const monthName = base.toLocaleString(undefined, { month: 'long', year: 'numeric' })
            const totalMonth = weeks.reduce((s, w) => s + w.total, 0)
            const weeksMet = weeks.filter(w => w.total >= WEEKLY_GOAL).length
            const isCurrentMonth = stepsMonthOffset === 0
            return (
              <>
                <div className="flex items-center justify-between mb-3">
                  <button type="button" onClick={() => setStepsMonthOffset(o => o + 1)} className="w-8 h-8 flex items-center justify-center rounded-lg bg-gray-800 hover:bg-gray-700 text-gray-300 text-lg">‹</button>
                  <span className="text-xs text-gray-400 font-medium">{monthName}</span>
                  <button type="button" onClick={() => setStepsMonthOffset(o => Math.max(0, o - 1))} disabled={isCurrentMonth} className="w-8 h-8 flex items-center justify-center rounded-lg bg-gray-800 hover:bg-gray-700 text-gray-300 text-lg disabled:opacity-30">›</button>
                </div>
                <div className="grid grid-cols-3 gap-2 mb-4">
                  <div className="bg-gray-800/80 rounded-xl p-3 text-center">
                    <p className="text-[10px] text-gray-300 uppercase font-semibold">Month total</p>
                    <p className="text-xl font-bold text-orange-300 mt-0.5">{totalMonth.toLocaleString()}</p>
                  </div>
                  <div className="bg-gray-800/80 rounded-xl p-3 text-center">
                    <p className="text-[10px] text-gray-300 uppercase font-semibold">Weeks met</p>
                    <p className="text-xl font-bold text-green-400 mt-0.5">{weeksMet}/{weeks.length}</p>
                  </div>
                  <div className="bg-gray-800/80 rounded-xl p-3 text-center">
                    <p className="text-[10px] text-gray-300 uppercase font-semibold">Avg / week</p>
                    <p className="text-xl font-bold text-white mt-0.5">{weeks.length ? Math.round(totalMonth / weeks.length).toLocaleString() : '—'}</p>
                  </div>
                </div>
                <div className="bg-gray-800/40 rounded-xl p-3">
                  <StepsBarChart
                    bars={weeks.map(w => ({ label: w.label, value: w.total, isCurrent: w.isCurrent }))}
                    goal={WEEKLY_GOAL}
                    height={140}
                  />
                  <p className="text-[10px] text-gray-500 mt-2 text-center">Weekly goal: 70,000 steps</p>
                </div>
              </>
            )
          }

          // ---- Year view: 12 months ----
          const renderYear = () => {
            const now = new Date()
            const y = now.getFullYear() - stepsYearOffset
            const months: { label: string; value: number; isCurrent: boolean }[] = []
            const MONTH_NAMES = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
            for (let mo = 0; mo < 12; mo++) {
              const last = new Date(y, mo + 1, 0)
              let total = 0
              for (let day = 1; day <= last.getDate(); day++) {
                const key = localDateStr(new Date(y, mo, day))
                total += byDate.get(key) ?? 0
              }
              months.push({
                label: MONTH_NAMES[mo],
                value: total,
                isCurrent: mo === now.getMonth() && stepsYearOffset === 0,
              })
            }
            // Monthly goal varies by days in month; use 10k × days.
            const monthGoal = (m: number) => new Date(y, m + 1, 0).getDate() * DAILY_GOAL
            const totalYear = months.reduce((s, m) => s + m.value, 0)
            const monthsMet = months.filter((m, idx) => m.value >= monthGoal(idx)).length
            // Use max monthly goal (~31 × 10k = 310k) as visual threshold
            const maxGoal = 31 * DAILY_GOAL
            const isCurrentYear = stepsYearOffset === 0
            return (
              <>
                <div className="flex items-center justify-between mb-3">
                  <button type="button" onClick={() => setStepsYearOffset(o => o + 1)} className="w-8 h-8 flex items-center justify-center rounded-lg bg-gray-800 hover:bg-gray-700 text-gray-300 text-lg">‹</button>
                  <span className="text-xs text-gray-400 font-medium">{y}</span>
                  <button type="button" onClick={() => setStepsYearOffset(o => Math.max(0, o - 1))} disabled={isCurrentYear} className="w-8 h-8 flex items-center justify-center rounded-lg bg-gray-800 hover:bg-gray-700 text-gray-300 text-lg disabled:opacity-30">›</button>
                </div>
                <div className="grid grid-cols-3 gap-2 mb-4">
                  <div className="bg-gray-800/80 rounded-xl p-3 text-center">
                    <p className="text-[10px] text-gray-300 uppercase font-semibold">Year total</p>
                    <p className="text-xl font-bold text-orange-300 mt-0.5">{(totalYear / 1000).toFixed(0)}k</p>
                  </div>
                  <div className="bg-gray-800/80 rounded-xl p-3 text-center">
                    <p className="text-[10px] text-gray-300 uppercase font-semibold">Months met</p>
                    <p className="text-xl font-bold text-green-400 mt-0.5">{monthsMet}/12</p>
                  </div>
                  <div className="bg-gray-800/80 rounded-xl p-3 text-center">
                    <p className="text-[10px] text-gray-300 uppercase font-semibold">Avg / month</p>
                    <p className="text-xl font-bold text-white mt-0.5">{Math.round(totalYear / 12 / 1000)}k</p>
                  </div>
                </div>
                <div className="bg-gray-800/40 rounded-xl p-3">
                  <StepsBarChart bars={months} goal={maxGoal} height={140} />
                  <p className="text-[10px] text-gray-500 mt-2 text-center">Target ≈ 10k × days in month</p>
                </div>
              </>
            )
          }

          const tabBtn = (key: typeof stepsTab, label: string) => (
            <button
              type="button"
              onClick={() => setStepsTab(key)}
              className={`flex-1 text-xs py-1.5 rounded-lg transition-colors ${
                stepsTab === key
                  ? 'bg-orange-500 text-white font-semibold'
                  : 'bg-gray-800/60 text-gray-400 hover:bg-gray-800'
              }`}
            >
              {label}
            </button>
          )

          return (
            <>
              <div className="flex gap-1 mb-4 bg-gray-900/50 rounded-xl p-1">
                {tabBtn('day', 'Day')}
                {tabBtn('week', 'Week')}
                {tabBtn('month', 'Month')}
                {tabBtn('year', 'Year')}
              </div>
              {stepsTab === 'day' && renderDay()}
              {stepsTab === 'week' && renderWeek()}
              {stepsTab === 'month' && renderMonth()}
              {stepsTab === 'year' && renderYear()}
              <div className="flex items-center justify-center gap-4 mt-4 text-[10px] text-gray-500">
                <span className="flex items-center gap-1"><span className="w-2 h-2 rounded bg-green-500 inline-block" />Met</span>
                <span className="flex items-center gap-1"><span className="w-2 h-2 rounded bg-red-500 inline-block" />Missed</span>
                <span className="flex items-center gap-1"><span className="w-2 h-2 rounded bg-blue-500 inline-block" />Current</span>
              </div>
            </>
          )
        })()}
      </DetailModal>

      {/* HRV detail */}
      <DetailModal
        open={openDetail === 'hrv'}
        onClose={closeDetail}
        title="Heart Rate Variability"
        subtitle="Last night, RMSSD overnight average"
        icon="💚"
        gradient="from-green-950/90 via-gray-900 to-gray-950"
        border="border-green-500/30"
      >
        {(() => {
          const cur = dailyHealth?.hrv_avg ?? metrics?.garmin_hrv_nightly_avg ?? null
          const series = trends.hrv.filter((v): v is number => v != null)
          const avg = series.length ? Math.round(series.reduce((a, b) => a + b, 0) / series.length) : null
          const status = metrics?.garmin_hrv_status ?? null
          return (
            <>
              <div className="grid grid-cols-3 gap-2 mb-4">
                <div className="bg-gray-800/80 rounded-xl p-3 text-center">
                  <p className="text-[10px] text-gray-300 uppercase font-semibold">Last night</p>
                  <p className="text-2xl font-bold text-green-300 mt-0.5">{cur ?? '—'}<span className="text-xs text-gray-500 ml-0.5">ms</span></p>
                </div>
                <div className="bg-gray-800/80 rounded-xl p-3 text-center">
                  <p className="text-[10px] text-gray-300 uppercase font-semibold">7-day avg</p>
                  <p className="text-2xl font-bold text-white mt-0.5">{avg ?? '—'}</p>
                </div>
                <div className="bg-gray-800/80 rounded-xl p-3 text-center">
                  <p className="text-[10px] text-gray-300 uppercase font-semibold">Status</p>
                  <p className="text-base font-bold text-white mt-1 capitalize">{status ?? '—'}</p>
                </div>
              </div>
              <p className="text-xs text-gray-300 uppercase tracking-wider font-semibold mb-2">7-day HRV</p>
              <div className="bg-gray-800/40 rounded-xl p-3"><Sparkline values={trends.hrv} color="#22c55e" width={420} height={48} /></div>
              <p className="text-xs text-gray-300 mt-3 leading-snug">
                HRV is the variation between heartbeats. Higher within your personal baseline = better recovery and parasympathetic balance. Garmin compares last night to your 3-week baseline to label it Balanced / Unbalanced / Low.
              </p>
            </>
          )
        })()}
      </DetailModal>

      {/* SpO2 detail */}
      <DetailModal
        open={openDetail === 'spo2'}
        onClose={closeDetail}
        title="Pulse Oximetry (SpO2)"
        subtitle="Blood oxygen saturation"
        icon="🩸"
        gradient="from-cyan-950/90 via-gray-900 to-gray-950"
        border="border-cyan-500/30"
      >
        {(() => {
          const avg = dailyHealth?.spo2_avg ?? metrics?.garmin_spo2_avg ?? metrics?.pulse_ox ?? null
          // Overnight SpO2 lives on the sleep row; fall back to the daily avg if
          // the sleep sample hasn't populated those columns yet.
          const sleepAvg = sleepData?.avg_spo2 ?? dailyHealth?.spo2_avg ?? metrics?.garmin_spo2_avg ?? null
          const sleepMin = sleepData?.min_spo2 ?? null
          return (
            <>
              <div className="grid grid-cols-3 gap-2 mb-4">
                <div className="bg-gray-800/80 rounded-xl p-3 text-center">
                  <p className="text-[10px] text-gray-300 uppercase font-semibold">Today avg</p>
                  <p className="text-2xl font-bold text-cyan-300 mt-0.5">{avg ?? '—'}<span className="text-xs text-gray-500 ml-0.5">%</span></p>
                </div>
                <div className="bg-gray-800/80 rounded-xl p-3 text-center">
                  <p className="text-[10px] text-gray-300 uppercase font-semibold">Sleep avg</p>
                  <p className="text-2xl font-bold text-white mt-0.5">{sleepAvg ?? '—'}<span className="text-xs text-gray-500 ml-0.5">%</span></p>
                </div>
                <div className="bg-gray-800/80 rounded-xl p-3 text-center">
                  <p className="text-[10px] text-gray-300 uppercase font-semibold">Sleep low</p>
                  <p className="text-2xl font-bold text-cyan-400 mt-0.5">{sleepMin ?? '—'}<span className="text-xs text-gray-500 ml-0.5">%</span></p>
                </div>
              </div>
              <p className="text-[11px] text-gray-500 leading-snug">
                Healthy SpO2 sits 95–100%. Sustained dips below 90% during sleep can indicate altitude acclimation, congestion, or sleep-disordered breathing — see a clinician if it persists.
              </p>
            </>
          )
        })()}
      </DetailModal>

      {/* Intensity Minutes detail */}
      <DetailModal
        open={openDetail === 'intensity'}
        onClose={closeDetail}
        title="Intensity Minutes"
        subtitle="Weekly cardio target"
        icon="🔥"
        gradient="from-orange-950/90 via-gray-900 to-gray-950"
        border="border-orange-500/30"
      >
        {(() => {
          const mod = dailySteps?.moderate_intensity_minutes ?? null
          const vig = dailySteps?.vigorous_intensity_minutes ?? null
          const hasGarminIntensity = mod != null || vig != null
          const totalIntensity = hasGarminIntensity ? (mod ?? 0) + (vig ?? 0) * 2 : (dailySteps?.active_minutes ?? null)
          const goal = dailySteps?.intensity_minutes_goal ?? 150
          const pct = totalIntensity != null ? Math.min(100, (totalIntensity / goal) * 100) : null
          return (
            <>
              <div className="grid grid-cols-2 gap-2 mb-4">
                <div className="bg-gray-800/80 rounded-xl p-3 text-center">
                  <p className="text-[10px] text-gray-300 uppercase font-semibold">Weekly total</p>
                  <p className="text-2xl font-bold text-orange-300 mt-0.5">{totalIntensity ?? '—'}<span className="text-xs text-gray-500 ml-0.5">min</span></p>
                </div>
                <div className="bg-gray-800/80 rounded-xl p-3 text-center">
                  <p className="text-[10px] text-gray-300 uppercase font-semibold">Weekly goal</p>
                  <p className="text-2xl font-bold text-white mt-0.5">{goal}<span className="text-xs text-gray-500 ml-0.5">min</span></p>
                </div>
              </div>
              {hasGarminIntensity && (
                <div className="grid grid-cols-2 gap-2 mb-4">
                  <div className="bg-gray-800/80 rounded-xl p-3 text-center">
                    <p className="text-[10px] text-gray-300 uppercase font-semibold">Moderate</p>
                    <p className="text-xl font-bold text-yellow-300 mt-0.5">{mod ?? 0}<span className="text-xs text-gray-500 ml-0.5">min</span></p>
                  </div>
                  <div className="bg-gray-800/80 rounded-xl p-3 text-center">
                    <p className="text-[10px] text-gray-300 uppercase font-semibold">Vigorous</p>
                    <p className="text-xl font-bold text-red-400 mt-0.5">{vig ?? 0}<span className="text-xs text-gray-500 ml-0.5">min</span></p>
                  </div>
                </div>
              )}
              {pct != null && (
                <div className="mb-4">
                  <div className="flex justify-between text-xs text-gray-400 mb-1">
                    <span>Progress to goal</span>
                    <span>{Math.round(pct)}%</span>
                  </div>
                  <div className="w-full bg-gray-800 rounded-full h-2">
                    <div className="h-2 rounded-full transition-all" style={{ width: `${pct}%`, backgroundColor: pct >= 100 ? '#22c55e' : '#f97316' }} />
                  </div>
                </div>
              )}
              <p className="text-[11px] text-gray-500 leading-snug">
                The WHO recommends 150 min/week of moderate or 75 min/week of vigorous activity. Garmin counts moderate minutes 1× and vigorous 2× toward this goal. These are weekly rolling totals from your Garmin.
              </p>
            </>
          )
        })()}
      </DetailModal>

      {/* Training Readiness detail */}
      <DetailModal
        open={openDetail === 'readiness'}
        onClose={closeDetail}
        title="Training Readiness"
        subtitle="Composite score from your recovery signals"
        icon="🎯"
        gradient="from-purple-950/90 via-gray-900 to-gray-950"
        border="border-purple-500/30"
      >
        {scores ? (
          <>
            <div className="bg-gray-800/80 rounded-xl p-4 text-center mb-4">
              <p className="text-[10px] text-gray-300 uppercase font-semibold">Today</p>
              <p className="text-4xl font-bold text-white mt-1">{readiness ?? '—'}<span className="text-base text-gray-500 ml-1">/100</span></p>
              <p className="text-sm text-purple-300 mt-1">{readiness != null ? readinessLabel(readiness) : ''}</p>
            </div>
            <p className="text-xs text-gray-300 uppercase tracking-wider font-semibold mb-2">Score breakdown</p>
            <div className="bg-gray-800/40 rounded-xl p-3 space-y-1">
              <DetailRow label="Sleep" value={`${scores.radar.sleep}/100`} color="text-purple-300" />
              <DetailRow label="HRV" value={`${scores.radar.hrv}/100`} color="text-green-400" />
              <DetailRow label="Resting HR" value={`${scores.radar.heartRate}/100`} color="text-red-400" />
              <DetailRow label="SpO2" value={`${scores.radar.spo2}/100`} color="text-cyan-300" />
              <DetailRow label="Load adjust" value={`${scores.radar.load}/100`} color="text-yellow-300" />
              <DetailRow label="Today's load" value={scores.exerciseMin ? `${scores.exerciseMin} min` : '0 min'} />
              {scores.keyFactor && <DetailRow label="Key factor" value={scores.keyFactor} color="text-orange-300" />}
            </div>
            <p className="text-xs text-gray-300 mt-3 leading-snug">
              The composite weighs sleep, HRV, resting HR, SpO2 and acute training load. Lowest sub-score is shown as the &quot;key factor&quot; — it&apos;s the lever holding back your readiness today.
            </p>
          </>
        ) : (
          <p className="text-sm text-gray-400">Not enough data to compute readiness yet — sync your Garmin and try again.</p>
        )}
      </DetailModal>

      {/* Hydration detail */}
      <DetailModal
        open={openDetail === 'hydration'}
        onClose={closeDetail}
        title="Hydration"
        subtitle="Daily water intake"
        icon="💧"
        gradient="from-blue-950/90 via-gray-900 to-gray-950"
        border="border-blue-500/30"
      >
        {(() => {
          const intake = dailyHealth?.hydration_intake_ml ?? 0
          const goal = dailyHealth?.hydration_goal_ml ?? 0
          const remaining = dailyHealth?.hydration_remaining_ml ?? Math.max(0, goal - intake)
          const pct = goal ? Math.min(100, (intake / goal) * 100) : 0
          return (
            <>
              <div className="grid grid-cols-3 gap-2 mb-4">
                <div className="bg-gray-800/80 rounded-xl p-3 text-center">
                  <p className="text-[10px] text-gray-300 uppercase font-semibold">Intake</p>
                  <p className="text-2xl font-bold text-blue-300 mt-0.5">{(intake / 1000).toFixed(1)}<span className="text-xs text-gray-500 ml-0.5">L</span></p>
                </div>
                <div className="bg-gray-800/80 rounded-xl p-3 text-center">
                  <p className="text-[10px] text-gray-300 uppercase font-semibold">Goal</p>
                  <p className="text-2xl font-bold text-white mt-0.5">{(goal / 1000).toFixed(1)}<span className="text-xs text-gray-500 ml-0.5">L</span></p>
                </div>
                <div className="bg-gray-800/80 rounded-xl p-3 text-center">
                  <p className="text-[10px] text-gray-300 uppercase font-semibold">Left</p>
                  <p className="text-2xl font-bold text-cyan-300 mt-0.5">{(remaining / 1000).toFixed(1)}<span className="text-xs text-gray-500 ml-0.5">L</span></p>
                </div>
              </div>
              <div className="w-full bg-gray-800 rounded-full h-3 mb-1">
                <div className="bg-blue-500 h-3 rounded-full transition-all" style={{ width: `${pct}%` }} />
              </div>
              <p className="text-xs text-gray-300 mt-3 leading-snug">
                Garmin sets your daily goal from age, weight, and activity. Add ~500 ml per hour of intense exercise. Log intake from the Garmin Connect app to keep this in sync.
              </p>
            </>
          )
        })()}
      </DetailModal>

      {/* Settings modal */}
      <DetailModal
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        title="Settings"
        subtitle="Sync, account & data tools"
        icon="⚙️"
        gradient="from-gray-900 via-gray-900 to-gray-950"
        border="border-gray-700/50"
      >
        <div className="space-y-4">
          <div className="bg-gray-800/40 rounded-xl p-4">
            <p className="text-sm font-semibold text-white">Daily Step Goal</p>
            <p className="text-xs text-gray-400 mt-1 mb-3">Set your daily step target. Shown on the steps tile and used to track goal days.</p>
            <div className="flex gap-2 items-center">
              <input
                type="number"
                min={1000}
                max={100000}
                step={500}
                value={stepGoalInput}
                onChange={e => setStepGoalInput(e.target.value)}
                className="flex-1 bg-gray-700 text-white text-sm rounded-lg px-3 py-2 border border-gray-600 focus:border-orange-500 focus:outline-none"
                placeholder="10000"
              />
              <button
                onClick={saveStepGoal}
                disabled={savingGoal}
                className="text-sm bg-orange-600 hover:bg-orange-500 disabled:opacity-50 text-white px-4 py-2 rounded-lg font-semibold"
              >
                {savingGoal ? 'Saving…' : 'Save'}
              </button>
            </div>
            <div className="flex gap-2 mt-2 flex-wrap">
              {[5000, 7500, 10000, 12500, 15000].map(n => (
                <button
                  key={n}
                  onClick={() => setStepGoalInput(String(n))}
                  className={`text-xs px-2.5 py-1 rounded-lg border transition-colors ${stepGoal === n ? 'border-orange-500 text-orange-400' : 'border-gray-600 text-gray-400 hover:border-gray-400'}`}
                >
                  {(n / 1000).toFixed(n % 1000 === 0 ? 0 : 1)}k
                </button>
              ))}
            </div>
          </div>

          <div className="bg-gray-800/40 rounded-xl p-4">
            <p className="text-sm font-semibold text-white">One-time Garmin backfill</p>
            <p className="text-sm text-gray-200 mt-1 leading-snug">
              Pulls every day of historical data from your Garmin account once. The hourly cron then keeps
              just today fresh, so we don&apos;t hammer Garmin&apos;s servers.
            </p>
            <p className="text-xs text-gray-400 mt-2">
              A 1-year backfill takes ~10 minutes and uses ~1.5s spacing between requests for politeness.
            </p>
            <div className="grid grid-cols-3 gap-2 mt-3">
              <button
                onClick={() => handleBackfill(30)}
                disabled={backfillStatus === 'starting' || backfillStatus === 'running'}
                className="text-xs bg-gray-800 hover:bg-gray-700 disabled:opacity-50 text-white py-2 rounded-lg"
              >
                30 days
              </button>
              <button
                onClick={() => handleBackfill(90)}
                disabled={backfillStatus === 'starting' || backfillStatus === 'running'}
                className="text-xs bg-gray-800 hover:bg-gray-700 disabled:opacity-50 text-white py-2 rounded-lg"
              >
                90 days
              </button>
              <button
                onClick={() => handleBackfill(365)}
                disabled={backfillStatus === 'starting' || backfillStatus === 'running'}
                className="text-xs bg-orange-600 hover:bg-orange-500 disabled:opacity-50 text-white py-2 rounded-lg font-semibold"
              >
                Sync all (1 yr)
              </button>
            </div>
          </div>

          <div className="bg-gray-800/40 rounded-xl p-4">
            <p className="text-sm font-semibold text-white">Account</p>
            <p className="text-xs text-gray-400 mt-1">{displayName || 'Signed in'}</p>
            <button
              onClick={async () => {
                setSettingsOpen(false)
                await supabase.auth.signOut()
                router.push('/login')
              }}
              className="text-xs bg-gray-800 hover:bg-gray-700 text-gray-300 px-3 py-1.5 rounded-lg mt-2"
            >
              Sign out
            </button>
          </div>
        </div>
      </DetailModal>

      {/* Backfill progress modal */}
      {backfillOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm"
          role="dialog"
          aria-modal="true"
        >
          <div className="relative w-full max-w-lg max-h-[85vh] overflow-y-auto bg-gradient-to-br from-orange-950/80 via-gray-900 to-gray-950 rounded-3xl p-6 border border-orange-500/30 shadow-2xl">
            {(backfillStatus === 'done' || backfillStatus === 'error') && (
              <button
                onClick={() => {
                  setBackfillOpen(false)
                  setBackfillStatus('idle')
                  setProgressRows([])
                  setBackfillRunId(null)
                }}
                aria-label="Close"
                className="absolute top-3 right-3 w-8 h-8 rounded-full bg-gray-800/80 hover:bg-gray-700 text-gray-300 hover:text-white flex items-center justify-center"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            )}

            <div className="flex items-center gap-3 mb-3">
              <span className="text-2xl">
                {backfillStatus === 'done' ? '✅' : backfillStatus === 'error' ? '⚠️' : '🔄'}
              </span>
              <div>
                <p className="text-base font-bold text-white">
                  {backfillStatus === 'done'
                    ? 'Sync complete'
                    : backfillStatus === 'error'
                    ? 'Sync failed'
                    : `Syncing ${backfillDays} days from Garmin`}
                </p>
                <p className="text-xs text-gray-400">
                  {backfillStatus === 'starting' && 'Dispatching workflow…'}
                  {backfillStatus === 'running' && (latestProgress?.message ?? 'Waiting for first update…')}
                  {backfillStatus === 'done' && 'Your dashboard has been refreshed.'}
                  {backfillStatus === 'error' && (backfillError ?? 'Something went wrong.')}
                </p>
              </div>
            </div>

            {/* Progress bar */}
            <div className="w-full bg-gray-800 rounded-full h-2 mb-3">
              <div
                className="h-2 rounded-full transition-all duration-500"
                style={{
                  width: `${
                    backfillStatus === 'done'
                      ? 100
                      : backfillStatus === 'error'
                      ? 100
                      : latestProgress?.percent ?? (backfillStatus === 'starting' ? 2 : 5)
                  }%`,
                  backgroundColor:
                    backfillStatus === 'error' ? '#ef4444' :
                    backfillStatus === 'done' ? '#22c55e' : '#f97316',
                }}
              />
            </div>
            {latestProgress?.days_total && latestProgress?.day_index && (
              <p className="text-[11px] text-gray-500 mb-3">
                Day {latestProgress.day_index} of {latestProgress.days_total}
              </p>
            )}

            {/* Live log */}
            <p className="text-[10px] text-gray-300 uppercase tracking-wider font-semibold mb-1">Live log</p>
            <div
              className="bg-black/60 rounded-lg p-3 font-mono text-[11px] text-gray-300 max-h-72 overflow-y-auto whitespace-pre-wrap"
              ref={el => {
                // auto-scroll to bottom when new lines arrive
                if (el) el.scrollTop = el.scrollHeight
              }}
            >
              {progressRows.length === 0 ? (
                <p className="text-gray-600 italic">Waiting for the worker to start (this can take ~10s)…</p>
              ) : (
                progressRows.slice(-200).map(r => {
                  const t = new Date(r.ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
                  const color =
                    r.level === 'error' ? 'text-red-400' :
                    r.level === 'done' ? 'text-green-400' :
                    r.level === 'warn' ? 'text-yellow-400' : 'text-gray-300'
                  return (
                    <div key={r.id} className={color}>
                      <span className="text-gray-600">{t}</span>{' '}
                      {r.stage && <span className="text-gray-500">[{r.stage}]</span>}{' '}
                      {r.message}
                    </div>
                  )
                })
              )}
            </div>

            {(backfillStatus === 'starting' || backfillStatus === 'running') && (
              <p className="text-[10px] text-gray-500 mt-3 italic">
                You can close this window — the sync continues on GitHub Actions in the background. Re-open Settings any time.
              </p>
            )}
            {(backfillStatus === 'done' || backfillStatus === 'error') && (
              <button
                onClick={() => {
                  setBackfillOpen(false)
                  setBackfillStatus('idle')
                  setProgressRows([])
                  setBackfillRunId(null)
                }}
                className="mt-4 w-full bg-gray-800/80 hover:bg-gray-700 text-gray-200 text-sm py-2 rounded-xl"
              >
                Back to dashboard
              </button>
            )}
            {(backfillStatus === 'starting' || backfillStatus === 'running') && (
              <button
                onClick={() => setBackfillOpen(false)}
                className="mt-4 w-full bg-gray-800/60 hover:bg-gray-800 text-gray-400 text-sm py-2 rounded-xl"
              >
                Hide window (sync keeps running)
              </button>
            )}
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
              onClick={() => setSettingsOpen(true)}
              aria-label="Settings"
              title="Settings"
              className="text-xs bg-gray-800 text-gray-300 hover:bg-gray-700 px-2.5 py-1.5 rounded-lg"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
              </svg>
            </button>
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
          {syncMessage
            ? <span className="text-gray-400">{syncMessage}</span>
            : <span className="text-gray-600 italic">Open Garmin Connect app first to push watch data</span>
          }
        </div>

        {/* Three metric tiles */}
        <div className="grid grid-cols-3 gap-2">
          {/* Tile 1: Power Reserve + Load */}
          {(() => {
            const clampV = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v))
            const lerpHex = (c1: string, c2: string, t: number) => {
              const r1 = parseInt(c1.slice(1,3),16), g1 = parseInt(c1.slice(3,5),16), b1 = parseInt(c1.slice(5,7),16)
              const r2 = parseInt(c2.slice(1,3),16), g2 = parseInt(c2.slice(3,5),16), b2 = parseInt(c2.slice(5,7),16)
              return `#${Math.round(r1+(r2-r1)*t).toString(16).padStart(2,'0')}${Math.round(g1+(g2-g1)*t).toString(16).padStart(2,'0')}${Math.round(b1+(b2-b1)*t).toString(16).padStart(2,'0')}`
            }
            const hrv = dailyHealth?.hrv_avg ?? metrics?.garmin_hrv_nightly_avg ?? null
            const hrvStatus = (dailyHealth?.hrv_status ?? metrics?.garmin_hrv_status ?? '').toLowerCase()
            const sleepScore = sleepData?.sleep_score ?? metrics?.garmin_sleep_score ?? null
            const rhr = metrics?.resting_hr ?? metrics?.resting_heart_rate_bpm ?? null
            const hrvScore = hrv != null
              ? hrvStatus.includes('balanced') || hrvStatus.includes('good') ? Math.min(85, 50 + (hrv - 30) * 1.5)
              : hrvStatus.includes('poor') || hrvStatus.includes('low') ? Math.max(15, 40 - (40 - hrv))
              : Math.max(0, Math.min(100, ((hrv - 20) / 60) * 100))
              : null
            let recScore = 0, recWeight = 0
            if (hrvScore != null) { recScore += hrvScore * 0.45; recWeight += 0.45 }
            if (sleepScore != null) { recScore += sleepScore * 0.35; recWeight += 0.35 }
            if (rhr != null) { recScore += (100 - ((clampV(rhr, 40, 80) - 40) / 40) * 100) * 0.20; recWeight += 0.20 }
            const reserve = recWeight > 0 ? Math.round(recScore / recWeight) : null
            const modMin = dailySteps?.moderate_intensity_minutes ?? null
            const vigMin = dailySteps?.vigorous_intensity_minutes ?? null
            const activeMin = dailySteps?.active_minutes ?? null
            const intensityMin = modMin != null || vigMin != null ? (modMin ?? 0) + (vigMin ?? 0) * 2 : (activeMin ?? 0) * 0.6
            const load = Math.min(21, 21 * Math.log10(1 + intensityMin) / Math.log10(301))
            const reservePct = reserve != null ? clampV(reserve, 0, 100) / 100 : 0
            const loadPct = clampV(load, 0, 21) / 21
            const reserveColor = reserve != null ? lerpHex('#f97316', '#dc2626', 1 - reservePct) : '#475569'
            const loadColor = lerpHex('#3b82f6', '#2dd4bf', loadPct)
            const reserveLabel = reserve == null ? '—' : reserve >= 80 ? 'Deep Reserve' : reserve >= 67 ? 'Charged' : reserve >= 34 ? 'Building' : 'Reserve Deficit'
            const cx = 90, cy = 90
            const rOuter = 68, rInner = 52, swOuter = 9, swInner = 12
            const circumOuter = 2 * Math.PI * rOuter
            const circumInner = 2 * Math.PI * rInner
            return (
              <>
                <button type="button" onClick={() => setOpenTile('reserve')}
                  className="rounded-2xl p-3 flex flex-col items-center w-full transition-opacity hover:opacity-90 active:opacity-75"
                  style={{ background: 'linear-gradient(160deg,#0f1629 0%,#0a0f1e 100%)', border: '1px solid #1e293b' }}>
                  <div className="flex items-center justify-center gap-1 mb-2">
                    <p className="text-[9px] font-bold tracking-[0.15em]" style={{ color: reserveColor }}>READINESS INDEX</p>
                    <span className="text-[9px] text-slate-600">ⓘ</span>
                  </div>
                  <svg viewBox="0 0 180 180" className="w-28 h-28">
                    <defs>
                      <filter id="glowReserve" x="-50%" y="-50%" width="200%" height="200%">
                        <feGaussianBlur stdDeviation="3.5" result="blur" />
                        <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
                      </filter>
                      <filter id="glowLoad" x="-50%" y="-50%" width="200%" height="200%">
                        <feGaussianBlur stdDeviation="2.5" result="blur" />
                        <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
                      </filter>
                    </defs>
                    <circle cx={cx} cy={cy} r={rOuter} fill="none" stroke="#0f172a" strokeWidth={swOuter} />
                    <circle cx={cx} cy={cy} r={rInner} fill="none" stroke="#0f172a" strokeWidth={swInner} />
                    <circle cx={cx} cy={cy} r={rOuter} fill="none" stroke={reserveColor} strokeWidth={swOuter} strokeLinecap="round"
                      strokeDasharray={`${reservePct * circumOuter} ${circumOuter}`} transform={`rotate(-90 ${cx} ${cy})`}
                      filter={reserve != null ? 'url(#glowReserve)' : undefined} />
                    <circle cx={cx} cy={cy} r={rInner} fill="none" stroke={loadColor} strokeWidth={swInner} strokeLinecap="round"
                      strokeDasharray={`${loadPct * circumInner} ${circumInner}`} transform={`rotate(-90 ${cx} ${cy})`}
                      filter="url(#glowLoad)" />
                    <text x={cx} y={cy - 4} textAnchor="middle" fill="white" fontSize="26" fontWeight="800" fontFamily="system-ui,sans-serif">
                      {reserve ?? '—'}
                    </text>
                    <text x={cx} y={cy + 11} textAnchor="middle" fontSize="7.5" fontFamily="system-ui,sans-serif" letterSpacing="1" fill="#94a3b8">RESERVE</text>
                    <text x={cx} y={cy + 23} textAnchor="middle" fontSize="7.5" fontFamily="system-ui,sans-serif" letterSpacing="1" fill={loadColor}>{load.toFixed(1)} LOAD</text>
                  </svg>
                  <div className="flex gap-3 mt-1.5 w-full justify-center">
                    <div className="text-center">
                      <p className="text-sm font-extrabold tabular-nums" style={{ color: reserveColor }}>{reserve ?? '—'}</p>
                      <p className="text-[9px] font-bold uppercase tracking-wide mt-0.5" style={{ color: '#64748b' }}>Power Reserve</p>
                    </div>
                    <div className="w-px" style={{ background: '#1e293b' }} />
                    <div className="text-center">
                      <p className="text-sm font-extrabold tabular-nums" style={{ color: loadColor }}>{load.toFixed(1)}</p>
                      <p className="text-[9px] font-bold uppercase tracking-wide mt-0.5" style={{ color: '#64748b' }}>Load / 21</p>
                    </div>
                  </div>
                </button>

                <DetailModal open={openTile === 'reserve'} onClose={() => setOpenTile(null)}
                  title="Power Reserve" subtitle={reserveLabel} icon="⚡"
                  gradient="from-orange-950/60 via-gray-900 to-gray-950" border="border-orange-800/30">
                  <div className="space-y-4 text-sm">
                    <p className="text-gray-300 leading-relaxed">
                      Power Reserve is how much energy your body has stored and ready to use. It&apos;s calculated from three overnight signals — the higher the score, the more capacity you have for hard training today.
                    </p>
                    <div className="bg-gray-800/60 rounded-2xl p-4 space-y-3">
                      <p className="text-xs text-gray-400 uppercase tracking-wider font-semibold">Formula (0–100)</p>
                      <div className="space-y-2">
                        <div className="flex justify-between items-center">
                          <div>
                            <p className="text-white font-medium">HRV <span className="text-gray-500 text-xs font-normal">45% weight</span></p>
                            <p className="text-gray-400 text-xs">Heart rate variability — how well your nervous system recovered overnight</p>
                          </div>
                          <p className="text-white font-bold tabular-nums ml-3">{hrv != null ? `${hrv}ms` : '—'}</p>
                        </div>
                        <div className="flex justify-between items-center">
                          <div>
                            <p className="text-white font-medium">Sleep Score <span className="text-gray-500 text-xs font-normal">35% weight</span></p>
                            <p className="text-gray-400 text-xs">Garmin&apos;s composite sleep quality score</p>
                          </div>
                          <p className="text-white font-bold tabular-nums ml-3">{sleepScore != null ? `${sleepScore}/100` : '—'}</p>
                        </div>
                        <div className="flex justify-between items-center">
                          <div>
                            <p className="text-white font-medium">Resting HR <span className="text-gray-500 text-xs font-normal">20% weight</span></p>
                            <p className="text-gray-400 text-xs">Lower resting HR signals stronger recovery</p>
                          </div>
                          <p className="text-white font-bold tabular-nums ml-3">{rhr != null ? `${rhr}bpm` : '—'}</p>
                        </div>
                      </div>
                    </div>
                    <div className="bg-gray-800/60 rounded-2xl p-4 space-y-2">
                      <p className="text-xs text-gray-400 uppercase tracking-wider font-semibold">Reserve Levels</p>
                      <div className="space-y-1.5 text-xs">
                        <div className="flex justify-between"><span style={{ color: lerpHex('#f97316','#dc2626',0) }}>⚡ Deep Reserve (80–100)</span><span className="text-gray-400">Extra gear — peak output day</span></div>
                        <div className="flex justify-between"><span style={{ color: lerpHex('#f97316','#dc2626',0.15) }}>⚡ Charged (67–79)</span><span className="text-gray-400">Good to train hard</span></div>
                        <div className="flex justify-between"><span style={{ color: lerpHex('#f97316','#dc2626',0.55) }}>⚡ Building (34–66)</span><span className="text-gray-400">Moderate intensity recommended</span></div>
                        <div className="flex justify-between"><span style={{ color: '#dc2626' }}>⚡ Reserve Deficit (&lt;34)</span><span className="text-gray-400">Rest or light movement only</span></div>
                      </div>
                    </div>
                    <div className="bg-gray-800/60 rounded-2xl p-4 space-y-2">
                      <p className="text-xs text-gray-400 uppercase tracking-wider font-semibold">Training Load (inner ring)</p>
                      <p className="text-gray-300 text-xs leading-relaxed">Logarithmic 0–21 scale based on today&apos;s intensity minutes. A score of 10 is a moderate session; 18+ is an elite-level effort. Low load on a high-reserve day = opportunity. High load on a deficit = overreaching risk.</p>
                      <p className="text-white font-bold text-lg tabular-nums">{load.toFixed(1)} <span className="text-gray-500 text-sm font-normal">/ 21</span></p>
                    </div>
                  </div>
                </DetailModal>
              </>
            )
          })()}

          {/* Tile 2: Vitals (HRV + RHR) */}
          {(() => {
            const clampV = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v))
            const hrv = dailyHealth?.hrv_avg ?? metrics?.garmin_hrv_nightly_avg ?? null
            const rhr = metrics?.resting_hr ?? metrics?.resting_heart_rate_bpm ?? null
            const stress = dailyHealth?.stress_avg ?? metrics?.garmin_stress_avg ?? null
            // HRV: 20–120ms → 0–100%, purple
            const hrvPct = hrv != null ? clampV((hrv - 20) / 100, 0, 1) : 0
            const hrvColor = '#a855f7' // violet
            const hrvStatus = hrv == null ? '—' : hrv >= 70 ? 'Excellent' : hrv >= 50 ? 'Good' : hrv >= 30 ? 'Fair' : 'Low'
            // RHR: 40–80bpm → 0–100% (lower RHR = higher fill = healthier), rose
            const rhrPct = rhr != null ? clampV((80 - rhr) / 40, 0, 1) : 0
            const rhrColor = rhr == null ? '#475569' : rhr <= 55 ? '#22d3ee' : rhr <= 65 ? '#4ade80' : rhr <= 72 ? '#fb923c' : '#f43f5e'
            const cx = 90, cy = 90
            const rOuter = 68, rInner = 52, swOuter = 9, swInner = 12
            const circumOuter = 2 * Math.PI * rOuter
            const circumInner = 2 * Math.PI * rInner
            return (
              <>
                <button type="button" onClick={() => setOpenTile('vitals')}
                  className="rounded-2xl p-3 flex flex-col items-center w-full transition-opacity hover:opacity-90 active:opacity-75"
                  style={{ background: 'linear-gradient(160deg,#0f1629 0%,#0a0f1e 100%)', border: '1px solid #1e293b' }}>
                  <div className="flex items-center justify-center gap-1 mb-2">
                    <p className="text-[9px] font-bold tracking-[0.15em]" style={{ color: hrvColor }}>VITALS</p>
                    <span className="text-[9px] text-slate-600">ⓘ</span>
                  </div>
                  <svg viewBox="0 0 180 180" className="w-28 h-28">
                    <defs>
                      <filter id="glowHRV" x="-50%" y="-50%" width="200%" height="200%">
                        <feGaussianBlur stdDeviation="3.5" result="blur" />
                        <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
                      </filter>
                      <filter id="glowRHR" x="-50%" y="-50%" width="200%" height="200%">
                        <feGaussianBlur stdDeviation="2.5" result="blur" />
                        <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
                      </filter>
                    </defs>
                    <circle cx={cx} cy={cy} r={rOuter} fill="none" stroke="#0f172a" strokeWidth={swOuter} />
                    <circle cx={cx} cy={cy} r={rInner} fill="none" stroke="#0f172a" strokeWidth={swInner} />
                    <circle cx={cx} cy={cy} r={rOuter} fill="none" stroke={hrvColor} strokeWidth={swOuter} strokeLinecap="round"
                      strokeDasharray={`${hrvPct * circumOuter} ${circumOuter}`} transform={`rotate(-90 ${cx} ${cy})`}
                      filter={hrv != null ? 'url(#glowHRV)' : undefined} />
                    <circle cx={cx} cy={cy} r={rInner} fill="none" stroke={rhrColor} strokeWidth={swInner} strokeLinecap="round"
                      strokeDasharray={`${rhrPct * circumInner} ${circumInner}`} transform={`rotate(-90 ${cx} ${cy})`}
                      filter={rhr != null ? 'url(#glowRHR)' : undefined} />
                    <text x={cx} y={cy - 4} textAnchor="middle" fill="white" fontSize="26" fontWeight="800" fontFamily="system-ui,sans-serif">
                      {hrv != null ? Math.round(hrv) : '—'}
                    </text>
                    <text x={cx} y={cy + 11} textAnchor="middle" fontSize="7.5" fontFamily="system-ui,sans-serif" letterSpacing="1" fill={hrvColor}>HRV ms</text>
                    <text x={cx} y={cy + 23} textAnchor="middle" fontSize="7.5" fontFamily="system-ui,sans-serif" letterSpacing="1" fill={rhrColor}>{rhr != null ? `${rhr} RHR` : '— RHR'}</text>
                  </svg>
                  <div className="flex gap-3 mt-1.5 w-full justify-center">
                    <div className="text-center">
                      <p className="text-sm font-extrabold tabular-nums" style={{ color: hrvColor }}>{hrv != null ? Math.round(hrv) : '—'}</p>
                      <p className="text-[9px] font-bold uppercase tracking-wide mt-0.5" style={{ color: '#64748b' }}>{hrv != null ? `${hrvStatus}` : 'HRV'}</p>
                    </div>
                    <div className="w-px" style={{ background: '#1e293b' }} />
                    <div className="text-center">
                      <p className="text-sm font-extrabold tabular-nums" style={{ color: rhrColor }}>{rhr ?? '—'}</p>
                      <p className="text-[9px] font-bold uppercase tracking-wide mt-0.5" style={{ color: '#64748b' }}>RHR bpm</p>
                    </div>
                  </div>
                </button>

                <DetailModal open={openTile === 'vitals'} onClose={() => setOpenTile(null)}
                  title="Vitals" subtitle={`HRV ${hrv != null ? Math.round(hrv) + 'ms' : '—'} · RHR ${rhr ?? '—'} bpm`} icon="💓"
                  gradient="from-violet-950/60 via-gray-900 to-gray-950" border="border-violet-800/30">
                  <div className="space-y-4 text-sm">
                    <p className="text-gray-300 leading-relaxed">
                      Core physiological markers measured during rest and sleep — the two signals that most reliably reveal how your body is coping with training and daily stress.
                    </p>
                    <div className="bg-gray-800/60 rounded-2xl p-4 space-y-4">
                      <div>
                        <div className="flex justify-between items-start mb-1">
                          <p className="font-medium" style={{ color: hrvColor }}>HRV <span className="text-gray-500 text-xs font-normal">(outer ring)</span></p>
                          <p className="font-bold tabular-nums text-lg" style={{ color: hrvColor }}>{hrv != null ? Math.round(hrv) : '—'}<span className="text-xs text-gray-500"> ms</span></p>
                        </div>
                        <p className="text-gray-400 text-xs leading-relaxed">Heart Rate Variability — the millisecond variation between heartbeats during sleep. Higher HRV means your nervous system is in a parasympathetic (recovery) state. A drop of 10ms+ below your baseline is a strong signal to take it easy.</p>
                        <div className="mt-2 grid grid-cols-4 gap-1.5 text-xs text-center">
                          <div className="bg-gray-700/50 rounded-xl p-2"><p style={{ color: '#a855f7' }} className="font-bold">70+</p><p className="text-gray-500 mt-0.5">Excellent</p></div>
                          <div className="bg-gray-700/50 rounded-xl p-2"><p style={{ color: '#818cf8' }} className="font-bold">50–69</p><p className="text-gray-500 mt-0.5">Good</p></div>
                          <div className="bg-gray-700/50 rounded-xl p-2"><p style={{ color: '#fb923c' }} className="font-bold">30–49</p><p className="text-gray-500 mt-0.5">Fair</p></div>
                          <div className="bg-gray-700/50 rounded-xl p-2"><p style={{ color: '#f43f5e' }} className="font-bold">&lt;30</p><p className="text-gray-500 mt-0.5">Low</p></div>
                        </div>
                      </div>
                      <div className="border-t border-gray-700/50 pt-4">
                        <div className="flex justify-between items-start mb-1">
                          <p className="font-medium" style={{ color: rhrColor }}>Resting Heart Rate <span className="text-gray-500 text-xs font-normal">(inner ring)</span></p>
                          <p className="font-bold tabular-nums text-lg" style={{ color: rhrColor }}>{rhr ?? '—'}<span className="text-xs text-gray-500"> bpm</span></p>
                        </div>
                        <p className="text-gray-400 text-xs leading-relaxed">Your lowest heart rate during sleep. A rising RHR (even 2–3 bpm above your norm) often indicates under-recovery, oncoming illness, or accumulated fatigue. Elite endurance athletes typically see 40–50 bpm.</p>
                        <div className="mt-2 grid grid-cols-4 gap-1.5 text-xs text-center">
                          <div className="bg-gray-700/50 rounded-xl p-2"><p style={{ color: '#22d3ee' }} className="font-bold">≤55</p><p className="text-gray-500 mt-0.5">Athletic</p></div>
                          <div className="bg-gray-700/50 rounded-xl p-2"><p style={{ color: '#4ade80' }} className="font-bold">56–65</p><p className="text-gray-500 mt-0.5">Good</p></div>
                          <div className="bg-gray-700/50 rounded-xl p-2"><p style={{ color: '#fb923c' }} className="font-bold">66–72</p><p className="text-gray-500 mt-0.5">Fair</p></div>
                          <div className="bg-gray-700/50 rounded-xl p-2"><p style={{ color: '#f43f5e' }} className="font-bold">73+</p><p className="text-gray-500 mt-0.5">High</p></div>
                        </div>
                      </div>
                      {stress != null && (
                        <div className="border-t border-gray-700/50 pt-4">
                          <div className="flex justify-between items-start mb-1">
                            <p className="font-medium text-amber-400">Stress</p>
                            <p className="font-bold tabular-nums text-lg text-amber-400">{Math.round(stress)}<span className="text-xs text-gray-500">/100</span></p>
                          </div>
                          <p className="text-gray-400 text-xs leading-relaxed">Physiological stress estimated from HRV fluctuations throughout the day. Chronically high stress suppresses HRV and elevates RHR — the two signals in this tile.</p>
                        </div>
                      )}
                    </div>
                  </div>
                </DetailModal>
              </>
            )
          })()}

          {/* Tile 3: Bio Battery */}
          {(() => {
            const clampV = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v))
            const lerpHex = (c1: string, c2: string, t: number) => {
              const r1 = parseInt(c1.slice(1,3),16), g1 = parseInt(c1.slice(3,5),16), b1 = parseInt(c1.slice(5,7),16)
              const r2 = parseInt(c2.slice(1,3),16), g2 = parseInt(c2.slice(3,5),16), b2 = parseInt(c2.slice(5,7),16)
              return `#${Math.round(r1+(r2-r1)*t).toString(16).padStart(2,'0')}${Math.round(g1+(g2-g1)*t).toString(16).padStart(2,'0')}${Math.round(b1+(b2-b1)*t).toString(16).padStart(2,'0')}`
            }
            const bb = dailyHealth?.body_battery_end ?? metrics?.garmin_body_battery_eod ?? null
            const bbStart = dailyHealth?.body_battery_start ?? metrics?.garmin_body_battery_high ?? null
            const bbPeak = dailyHealth?.body_battery_peak ?? metrics?.garmin_body_battery_high ?? null
            const stress = dailyHealth?.stress_avg ?? metrics?.garmin_stress_avg ?? null
            const pct = bb != null ? clampV(bb, 0, 100) / 100 : 0
            // Green (#22c55e) full → Red (#ef4444) depleted
            const fillColor = bb != null ? lerpHex('#22c55e', '#ef4444', 1 - pct) : '#374151'
            const bbLabel = bb == null ? '—' : bb >= 70 ? 'Charged' : bb >= 40 ? 'Draining' : 'Depleted'
            // Battery SVG dimensions
            const bW = 36, bH = 68, bX = 22, bY = 16, bR = 6
            const nubW = 16, nubH = 7
            const fillMaxH = bH - 8
            const fillH = Math.round(fillMaxH * pct)
            const fillY = bY + (bH - fillH) - 4
            return (
              <>
                <button type="button" onClick={() => { setOpenTile('battery'); if (userId) loadIntradayBB(userId) }}
                  className="rounded-2xl p-3 flex flex-col items-center w-full transition-opacity hover:opacity-90 active:opacity-75"
                  style={{ background: 'linear-gradient(160deg,#0f1629 0%,#0a0f1e 100%)', border: '1px solid #1e293b' }}>
                  <div className="flex items-center justify-center gap-1 mb-2">
                    <p className="text-[9px] font-bold tracking-[0.15em]" style={{ color: fillColor }}>BIO BATTERY</p>
                    <span className="text-[9px] text-slate-600">ⓘ</span>
                  </div>
                  <svg viewBox="0 0 80 100" className="w-16 h-20">
                    <defs>
                      <filter id="glowBattery" x="-50%" y="-50%" width="200%" height="200%">
                        <feGaussianBlur stdDeviation="2.5" result="blur" />
                        <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
                      </filter>
                      <linearGradient id="battGrad" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="#22c55e" />
                        <stop offset="50%" stopColor="#f97316" />
                        <stop offset="100%" stopColor="#ef4444" />
                      </linearGradient>
                      <clipPath id="battFill">
                        <rect x={bX + 3} y={fillY} width={bW - 6} height={fillH} rx={4} />
                      </clipPath>
                    </defs>
                    {/* Nub */}
                    <rect x={(80 - nubW) / 2} y={bY - nubH} width={nubW} height={nubH + 2} rx={3} fill="#1e293b" />
                    {/* Body outline */}
                    <rect x={bX} y={bY} width={bW} height={bH} rx={bR} fill="#0f172a" stroke="#1e293b" strokeWidth={2.5} />
                    {/* Gradient fill rectangle clipped to fill level */}
                    <rect x={bX + 3} y={bY + 4} width={bW - 6} height={bH - 8} rx={4}
                      fill="url(#battGrad)" clipPath="url(#battFill)"
                      filter={bb != null && bb > 20 ? 'url(#glowBattery)' : undefined} />
                    {/* Percentage text inside battery */}
                    <text x={bX + bW / 2} y={bY + bH / 2 + 5} textAnchor="middle" fill="white"
                      fontSize="15" fontWeight="800" fontFamily="system-ui,sans-serif">{bb ?? '—'}</text>
                  </svg>
                  <div className="mt-1.5 text-center">
                    <p className="text-sm font-extrabold tabular-nums" style={{ color: fillColor }}>{bb ?? '—'}</p>
                    <p className="text-[9px] font-bold uppercase tracking-wide mt-0.5" style={{ color: '#64748b' }}>{bbLabel}</p>
                  </div>
                </button>

                <DetailModal open={openTile === 'battery'} onClose={() => setOpenTile(null)}
                  title="Bio Battery" subtitle={null} icon="🔋"
                  gradient="from-slate-900 via-gray-900 to-gray-950" border="border-slate-700/40">
                  {(() => {
                    const charged = bbPeak != null && bbStart != null ? Math.max(0, bbPeak - bbStart) : bbPeak ?? null
                    const drained = bbPeak != null && bb != null ? Math.max(0, bbPeak - bb) : null
                    const todayStr = new Date().toISOString().split('T')[0]
                    const todayActs = activities.filter(a => {
                      try { return new Date(a.start_time as string).toISOString().split('T')[0] === todayStr } catch { return false }
                    })
                    const statusMsg = stress != null && stress > 50
                      ? { title: 'Stressful day', body: 'Your stress has been elevated today. Try to find time to rest and relax to help recharge your battery.' }
                      : bb != null && bb < 40
                      ? { title: 'Battery low', body: 'Your body battery is depleted. Prioritise rest, avoid hard training, and focus on recovery tonight.' }
                      : bb != null && bb >= 70
                      ? { title: 'Well charged', body: 'Your battery is in great shape. You have plenty of energy available for training or a demanding day.' }
                      : { title: 'Moderate charge', body: 'You have a reasonable amount of energy available. Keep activity moderate and prioritise a good night\'s sleep.' }
                    const actDotColor = (type: string) => {
                      const t = type.toLowerCase()
                      if (t.includes('run')) return '#22c55e'
                      if (t.includes('cycl') || t.includes('bike')) return '#3b82f6'
                      if (t.includes('swim')) return '#06b6d4'
                      if (t.includes('strength') || t.includes('gym') || t.includes('weight')) return '#f97316'
                      if (t.includes('walk') || t.includes('hike')) return '#eab308'
                      if (t.includes('yoga') || t.includes('stretch')) return '#a855f7'
                      return '#6b7280'
                    }
                    const rr = 44, sw = 9, circ = 2 * Math.PI * rr
                    const ringPct = bb != null ? clampV(bb, 0, 100) / 100 : 0
                    return (
                      <div className="space-y-3 text-sm">

                        {/* ── Summary ── */}
                        <div className="bg-gray-800/50 rounded-2xl p-4">
                          <p className="text-xs text-gray-500 uppercase tracking-wider font-semibold mb-3">Summary</p>
                          <div className="flex items-center gap-5">
                            {/* Ring */}
                            <svg viewBox="0 0 110 110" className="w-28 h-28 shrink-0">
                              <defs>
                                <filter id="bbRingGlow" x="-30%" y="-30%" width="160%" height="160%">
                                  <feGaussianBlur stdDeviation="2.5" result="blur" />
                                  <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
                                </filter>
                              </defs>
                              <circle cx={55} cy={55} r={rr} fill="none" stroke="#1e293b" strokeWidth={sw} />
                              <circle cx={55} cy={55} r={rr} fill="none" stroke={fillColor} strokeWidth={sw} strokeLinecap="round"
                                strokeDasharray={`${ringPct * circ} ${circ}`} transform="rotate(-90 55 55)"
                                filter={bb != null ? 'url(#bbRingGlow)' : undefined} />
                              <text x={55} y={50} textAnchor="middle" fill="white" fontSize="26" fontWeight="800" fontFamily="system-ui,sans-serif">{bb ?? '—'}</text>
                              <text x={55} y={65} textAnchor="middle" fill="#475569" fontSize="10" fontFamily="system-ui,sans-serif">/ 100</text>
                            </svg>
                            {/* Stats */}
                            <div className="space-y-4 flex-1">
                              {charged != null && (
                                <div>
                                  <p className="text-2xl font-bold tabular-nums text-emerald-400">+{charged}</p>
                                  <p className="text-xs text-gray-500 mt-0.5">Charged</p>
                                </div>
                              )}
                              {drained != null && (
                                <div>
                                  <p className="text-2xl font-bold tabular-nums text-rose-400">−{drained}</p>
                                  <p className="text-xs text-gray-500 mt-0.5">Drained</p>
                                </div>
                              )}
                            </div>
                          </div>
                        </div>

                        {/* ── Status message ── */}
                        <div className="bg-gray-800/50 rounded-2xl p-4">
                          <p className="font-semibold text-white mb-1">{statusMsg.title}</p>
                          <p className="text-gray-400 text-xs leading-relaxed">{statusMsg.body}</p>
                        </div>

                        {/* ── Chart with tabs ── */}
                        <div className="bg-gray-800/50 rounded-2xl p-4">
                          {/* Tab bar */}
                          <div className="flex items-center gap-1 mb-3 bg-gray-900/60 rounded-xl p-1">
                            {(['1day', '7days', '4weeks'] as const).map(tab => (
                              <button key={tab} type="button"
                                onClick={() => { setBbChartTab(tab); setBbChartOffset(0); setNavIntradayBB([]) }}
                                className={`flex-1 text-xs py-1.5 rounded-lg font-semibold transition-colors ${bbChartTab === tab ? 'bg-gray-700 text-white' : 'text-gray-500 hover:text-gray-300'}`}>
                                {tab === '1day' ? '1 Day' : tab === '7days' ? '7 Days' : '4 Weeks'}
                              </button>
                            ))}
                          </div>

                          {/* Navigation row */}
                          {(() => {
                            const periodDays = bbChartTab === '1day' ? 1 : bbChartTab === '7days' ? 7 : 28
                            const canBack = bbChartTab === '1day'
                              ? bbChartOffset < 55
                              : (bbChartOffset + 1) * periodDays < histBB.length
                            const canFwd = bbChartOffset > 0
                            // Date range label
                            let rangeLabel = ''
                            const fmt = (d: string) => new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
                            if (bbChartTab === '1day') {
                              const d = new Date(Date.now() - bbChartOffset * 86400000)
                              rangeLabel = d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
                            } else {
                              const end = histBB.length - bbChartOffset * periodDays
                              const start = Math.max(0, end - periodDays)
                              const sl = histBB.slice(start, end)
                              if (sl.length) rangeLabel = `${fmt(sl[0].metric_date)} – ${fmt(sl[sl.length - 1].metric_date)}`
                            }
                            const goBack = () => {
                              const n = bbChartOffset + 1
                              setBbChartOffset(n)
                              setHoveredBBIdx(null)
                              if (bbChartTab === '1day' && userId) {
                                const date = new Date(Date.now() - n * 86400000).toISOString().split('T')[0]
                                loadIntradayForDate(userId, date)
                              }
                            }
                            const goFwd = () => {
                              const n = Math.max(0, bbChartOffset - 1)
                              setBbChartOffset(n)
                              setHoveredBBIdx(null)
                              if (bbChartTab === '1day') {
                                if (n === 0) setNavIntradayBB([])
                                else if (userId) {
                                  const date = new Date(Date.now() - n * 86400000).toISOString().split('T')[0]
                                  loadIntradayForDate(userId, date)
                                }
                              }
                            }
                            return (
                              <div className="flex items-center gap-2 mb-3">
                                <button type="button" onClick={goBack} disabled={!canBack}
                                  className="w-7 h-7 rounded-full flex items-center justify-center bg-gray-700/60 disabled:opacity-30 hover:bg-gray-600 transition-colors">
                                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} className="w-3.5 h-3.5 text-gray-300">
                                    <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
                                  </svg>
                                </button>
                                <button type="button" onClick={goFwd} disabled={!canFwd}
                                  className="w-7 h-7 rounded-full flex items-center justify-center bg-gray-700/60 disabled:opacity-30 hover:bg-gray-600 transition-colors">
                                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} className="w-3.5 h-3.5 text-gray-300">
                                    <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                                  </svg>
                                </button>
                                {rangeLabel && (
                                  <span className="text-xs text-gray-400 font-medium">{rangeLabel}</span>
                                )}
                              </div>
                            )
                          })()}

                          {(intradayLoading || navIntradayLoading) && (
                            <div className="flex items-center gap-2 text-gray-500 text-xs py-6 justify-center">
                              <span className="w-3 h-3 border border-gray-400 border-t-transparent rounded-full animate-spin" />
                              Loading…
                            </div>
                          )}

                          {/* 1 Day — intraday line chart */}
                          {!intradayLoading && !navIntradayLoading && bbChartTab === '1day' && (() => {
                            const active = bbChartOffset === 0 ? intradayBB : navIntradayBB
                            if (active.length < 2) return (
                              <div className="text-center py-4 space-y-1">
                                <p className="text-gray-400 text-xs">Intraday data not available yet</p>
                                <p className="text-gray-600 text-xs">Run a sync after creating the garmin_intraday_body_battery table</p>
                              </div>
                            )
                            const W = 320, H = 90, pad = 6
                            const xS = (i: number) => pad + (i / (intradayBB.length - 1)) * (W - pad * 2)
                            const yS = (v: number) => H - pad - (v / 100) * (H - pad * 2)
                            const pts = intradayBB.map((d, i) => `${xS(i)},${yS(d.level)}`).join(' ')
                            const area = `${xS(0)},${H - pad} ${pts} ${xS(intradayBB.length - 1)},${H - pad}`
                            const hourLabels: { x: number; label: string }[] = []
                            intradayBB.forEach((d, i) => {
                              const dt = new Date(d.recorded_at)
                              if (dt.getMinutes() < 15 && dt.getHours() % 4 === 0)
                                hourLabels.push({ x: xS(i), label: `${dt.getHours()}:00` })
                            })
                            return (
                              <svg viewBox={`0 0 ${W} ${H + 18}`} className="w-full">
                                <defs>
                                  <linearGradient id="bbGrad1d" x1="0" y1="0" x2="0" y2="1">
                                    <stop offset="0%" stopColor={fillColor} stopOpacity="0.3" />
                                    <stop offset="100%" stopColor={fillColor} stopOpacity="0.02" />
                                  </linearGradient>
                                </defs>
                                {[25, 50, 75, 100].map(v => (
                                  <g key={v}>
                                    <line x1={pad} y1={yS(v)} x2={W - pad} y2={yS(v)} stroke="#1e293b" strokeWidth={0.75} strokeDasharray="4,4" />
                                    <text x={W - pad + 3} y={yS(v) + 3.5} fontSize="8" fill="#374151">{v}</text>
                                  </g>
                                ))}
                                <polygon points={area} fill="url(#bbGrad1d)" />
                                <polyline points={pts} fill="none" stroke={fillColor} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
                                {hourLabels.map(({ x, label }) => (
                                  <text key={label} x={x} y={H + 14} textAnchor="middle" fontSize="8" fill="#475569">{label}</text>
                                ))}
                              </svg>
                            )
                          })()}

                          {/* 7 Days / 4 Weeks — dumbbell chart */}
                          {!intradayLoading && (bbChartTab === '7days' || bbChartTab === '4weeks') && (() => {
                            const days = bbChartTab === '7days' ? 7 : 28
                            const end = histBB.length - bbChartOffset * days
                            const start = Math.max(0, end - days)
                            const slice = histBB.slice(start, end)
                            if (slice.length === 0) return (
                              <div className="text-center py-4">
                                <p className="text-gray-500 text-xs">No historical data available</p>
                              </div>
                            )
                            const W = 320, H = 100, padL = 6, padR = 24, padT = 6, padB = 18
                            const cols = slice.length
                            const xS = (i: number) => padL + (i + 0.5) * ((W - padL - padR) / cols)
                            const yS = (v: number) => padT + ((100 - v) / 100) * (H - padT - padB)
                            const dayLabel = (d: string) => {
                              if (bbChartTab === '4weeks') {
                                const dt = new Date(d)
                                return `${dt.getDate()}/${dt.getMonth() + 1}`
                              }
                              return new Date(d).toLocaleDateString('en-GB', { weekday: 'short' })
                            }
                            const fullDateLabel = (d: string) => new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
                            const showLabel = (i: number) => bbChartTab === '7days' || i % 7 === 0
                            const hov = hoveredBBIdx !== null ? slice[hoveredBBIdx] : null
                            const hovX = hoveredBBIdx !== null ? xS(hoveredBBIdx) : 0
                            // Keep tooltip inside viewBox horizontally
                            const ttW = 92, ttH = 52
                            const ttX = Math.min(Math.max(hovX - ttW / 2, padL), W - padR - ttW)
                            const ttY = padT
                            return (
                              <svg viewBox={`0 0 ${W} ${H + padB}`} className="w-full"
                                onMouseLeave={() => setHoveredBBIdx(null)}>
                                {[0, 25, 50, 75, 100].map(v => (
                                  <g key={v}>
                                    <line x1={padL} y1={yS(v)} x2={W - padR} y2={yS(v)} stroke="#1e293b" strokeWidth={0.75} />
                                    <text x={W - padR + 3} y={yS(v) + 3.5} fontSize="8" fill="#374151">{v}</text>
                                  </g>
                                ))}
                                {slice.map((d, i) => {
                                  const hi = d.body_battery_peak
                                  const lo = d.body_battery_low
                                  const x = xS(i)
                                  if (hi == null && lo == null) return null
                                  const yHi = hi != null ? yS(hi) : yS(lo ?? 0)
                                  const yLo = lo != null ? yS(lo) : yS(hi ?? 0)
                                  const isHov = hoveredBBIdx === i
                                  return (
                                    <g key={d.metric_date} style={{ cursor: 'pointer' }}
                                      onMouseEnter={() => setHoveredBBIdx(i)}>
                                      {/* Invisible wide hit target */}
                                      <rect x={x - 10} y={padT} width={20} height={H - padT} fill="transparent" />
                                      {/* Vertical connector */}
                                      {hi != null && lo != null && (
                                        <line x1={x} y1={yHi} x2={x} y2={yLo}
                                          stroke={isHov ? '#64748b' : '#334155'} strokeWidth={isHov ? 3 : 2.5} strokeLinecap="round" />
                                      )}
                                      {hi != null && <circle cx={x} cy={yHi} r={isHov ? 6 : 4.5} fill="#3b82f6" />}
                                      {lo != null && <circle cx={x} cy={yLo} r={isHov ? 5 : 4} fill={isHov ? '#64748b' : '#475569'} />}
                                      {showLabel(i) && (
                                        <text x={x} y={H + padB - 2} textAnchor="middle" fontSize="8"
                                          fill={isHov ? '#94a3b8' : '#475569'}>{dayLabel(d.metric_date)}</text>
                                      )}
                                    </g>
                                  )
                                })}
                                {/* Tooltip */}
                                {hov && (
                                  <g>
                                    <rect x={ttX} y={ttY} width={ttW} height={ttH} rx={6}
                                      fill="#0f172a" stroke="#334155" strokeWidth={1} />
                                    <text x={ttX + 10} y={ttY + 14} fontSize="9" fontWeight="600" fill="#94a3b8">
                                      {fullDateLabel(hov.metric_date)}
                                    </text>
                                    <circle cx={ttX + 13} cy={ttY + 27} r={3.5} fill="#3b82f6" />
                                    <text x={ttX + 21} y={ttY + 31} fontSize="9" fill="white">
                                      {hov.body_battery_peak ?? '—'} Highest
                                    </text>
                                    <circle cx={ttX + 13} cy={ttY + 42} r={3} fill="#64748b" />
                                    <text x={ttX + 21} y={ttY + 46} fontSize="9" fill="white">
                                      {hov.body_battery_low ?? '—'} Lowest
                                    </text>
                                  </g>
                                )}
                              </svg>
                            )
                          })()}

                          {/* Legend for dumbbell chart */}
                          {!intradayLoading && bbChartTab !== '1day' && (
                            <div className="flex items-center gap-4 justify-center mt-2">
                              <div className="flex items-center gap-1.5">
                                <span className="w-2.5 h-2.5 rounded-full bg-blue-500" />
                                <span className="text-[10px] text-gray-500">Daily High</span>
                              </div>
                              <div className="flex items-center gap-1.5">
                                <span className="w-2.5 h-2.5 rounded-full bg-slate-500" />
                                <span className="text-[10px] text-gray-500">Daily Low</span>
                              </div>
                            </div>
                          )}
                        </div>

                        {/* ── Factors ── */}
                        <div className="bg-gray-800/50 rounded-2xl p-4">
                          <p className="text-xs text-gray-500 uppercase tracking-wider font-semibold mb-3">Factors</p>
                          {charged != null && charged > 0 && (
                            <div className="flex items-center justify-between py-2.5 border-b border-gray-700/40">
                              <div className="flex items-center gap-3">
                                <span className="text-lg">😴</span>
                                <div>
                                  <p className="text-white font-medium text-sm">Sleep</p>
                                  {sleepData?.sleep_duration_seconds != null && (
                                    <p className="text-gray-500 text-xs">{Math.floor(sleepData.sleep_duration_seconds / 3600)}h {Math.floor((sleepData.sleep_duration_seconds % 3600) / 60)}m</p>
                                  )}
                                </div>
                              </div>
                              <div className="flex items-center gap-1.5 shrink-0">
                                <span className="text-emerald-400 font-bold tabular-nums text-base">+{charged}</span>
                                <svg viewBox="0 0 24 24" fill="none" stroke="#34d399" strokeWidth={3} className="w-3.5 h-3.5">
                                  <path strokeLinecap="round" strokeLinejoin="round" d="M5 15l7-7 7 7" />
                                </svg>
                              </div>
                            </div>
                          )}
                          {todayActs.length > 0 ? todayActs.map((a, i) => {
                            const raw = (a.raw_payload ?? {}) as Record<string, unknown>
                            const typeKey = ((raw.activityType as Record<string, unknown> | undefined)?.typeKey as string | undefined)
                              ?? String(a.activity_type ?? '')
                            const name = (raw.activityName as string | undefined) ?? typeKey.replace(/_/g, ' ')
                            const durMin = a.duration_sec ? Math.round(Number(a.duration_sec) / 60) : null
                            const est = durMin ? Math.round(durMin / 4) : null
                            const dotColor = actDotColor(typeKey)
                            return (
                              <div key={i} className="flex items-center justify-between py-2.5 border-b border-gray-700/40 last:border-0">
                                <div className="flex items-center gap-3">
                                  <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: dotColor }} />
                                  <div>
                                    <p className="text-white font-medium text-sm">{name || typeKey.replace(/_/g, ' ')}</p>
                                    {durMin && <p className="text-gray-500 text-xs">{durMin}m</p>}
                                  </div>
                                </div>
                                {est != null && (
                                  <div className="flex items-center gap-1.5 shrink-0">
                                    <span className="text-rose-400 font-bold tabular-nums text-base">−{est}</span>
                                    <svg viewBox="0 0 24 24" fill="none" stroke="#f87171" strokeWidth={3} className="w-3.5 h-3.5">
                                      <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                                    </svg>
                                  </div>
                                )}
                              </div>
                            )
                          }) : (
                            <p className="text-gray-600 text-xs py-2">No activities recorded today</p>
                          )}
                        </div>

                      </div>
                    )
                  })()}
                </DetailModal>
              </>
            )
          })()}
        </div>

          {/* Daily Briefing — full width */}
          <div className="bg-gray-900 rounded-3xl overflow-hidden">
            <button
              type="button"
              className="w-full text-left"
              onClick={() => {
                if (!briefing && !briefingLoading) { fetchDailyBriefing(); return }
                if (!briefing) return
                const expanded = !briefingExpanded
                setBriefingExpanded(expanded)
                if (expanded && briefing && !briefing.read) {
                  const now = new Date()
                  const today = now.toISOString().split('T')[0]
                  const storageKey = `daily_briefing_${today}_${briefing.session}`
                  const updated = { ...briefing, read: true }
                  setBriefing(updated)
                  try { localStorage.setItem(storageKey, JSON.stringify(updated)) } catch { /* ignore */ }
                }
              }}
            >
              <div className="flex items-center justify-between px-5 pt-4 pb-3">
                <div className="flex items-center gap-2">
                  <p className="text-xs text-gray-300 uppercase tracking-wider font-semibold">
                    {briefing ? sessionLabel(briefing.session) : sessionLabel(getDaySession(new Date().getHours()))}
                  </p>
                  {briefing && !briefing.read && (
                    <span className="w-2 h-2 rounded-full bg-orange-500 shrink-0" />
                  )}
                </div>
                <div className="flex items-center gap-2">
                  {briefing && (
                    <span className="text-[10px] text-gray-600">{briefing.generatedAt}</span>
                  )}
                  {briefing && (
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}
                      className={`w-4 h-4 text-gray-500 transition-transform ${briefingExpanded ? 'rotate-180' : ''}`}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                    </svg>
                  )}
                </div>
              </div>
              <div className="px-5 pb-4">
                {briefingLoading && (
                  <div className="flex items-center gap-2 text-gray-500 text-sm">
                    <span className="w-3 h-3 border border-orange-400 border-t-transparent rounded-full animate-spin shrink-0" />
                    Generating your {sessionLabel(getDaySession(new Date().getHours())).toLowerCase().replace(/^[^ ]+ /, '')}...
                  </div>
                )}
                {!briefingLoading && !briefing && (
                  <p className="text-gray-500 text-sm">Tap to generate your AI briefing</p>
                )}
                {briefing && !briefingExpanded && (
                  <p className="text-gray-200 text-sm leading-relaxed line-clamp-2">
                    {briefing.text.split('\n')[0].replace(/^\*\*[^*]+\*\*\s*/, '')}
                  </p>
                )}
                {briefing && briefingExpanded && (
                  <div className="space-y-3">
                    {briefing.text.split('\n').filter(l => l.trim()).map((para, i) => {
                      const isBold = para.startsWith('**') && para.includes('**', 2)
                      const clean = para.replace(/\*\*(.*?)\*\*/g, '$1').replace(/^[•\-] /, '')
                      return (
                        <p key={i} className={`text-sm leading-relaxed ${isBold ? 'text-white font-semibold' : 'text-gray-300'}`}>
                          {clean}
                        </p>
                      )
                    })}
                  </div>
                )}
              </div>
            </button>
            {briefing && (
              <div className="px-5 pb-3 flex items-center justify-between border-t border-gray-800 pt-2">
                <span className="text-[10px] text-gray-600">
                  {briefing.read ? 'Read' : 'Tap to read'}
                </span>
                <button
                  type="button"
                  onClick={e => {
                    e.stopPropagation()
                    const now = new Date()
                    const today = now.toISOString().split('T')[0]
                    const session = getDaySession(now.getHours())
                    const storageKey = `daily_briefing_${today}_${session}`
                    try { localStorage.removeItem(storageKey) } catch { /* ignore */ }
                    setBriefing(null)
                    setBriefingExpanded(false)
                    setBriefingLoading(false)
                  }}
                  className="text-[10px] text-gray-600 hover:text-gray-400"
                >
                  Refresh
                </button>
              </div>
            )}
          </div>

          {/* ── AI Brain Readiness Insight ────────────────────────────── */}
          {(dashBrainInsight || dashBrainLoading) && (
            <div className={`mb-3 rounded-2xl p-4 border ${
              dashBrainLoading ? 'border-gray-700 bg-gray-900/40' :
              dashBrainInsight!.readiness_label === 'green' ? 'border-green-500/30 bg-green-950/20' :
              dashBrainInsight!.readiness_label === 'amber' ? 'border-orange-500/30 bg-orange-950/20' :
              'border-red-500/30 bg-red-950/20'
            }`}>
              {dashBrainLoading ? (
                <div className="flex items-center gap-2">
                  <div className="w-2 h-2 rounded-full bg-orange-500 animate-pulse" />
                  <p className="text-xs text-gray-400">Brain is analysing your 7-day data…</p>
                </div>
              ) : dashBrainInsight && (
                <>
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-center gap-2 flex-1">
                      <span className={`w-2.5 h-2.5 rounded-full flex-shrink-0 mt-0.5 ${
                        dashBrainInsight.readiness_label === 'green' ? 'bg-green-400' :
                        dashBrainInsight.readiness_label === 'amber' ? 'bg-orange-400' : 'bg-red-400'
                      }`} />
                      <div className="flex-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          <p className={`text-xs font-bold uppercase tracking-wider ${
                            dashBrainInsight.readiness_label === 'green' ? 'text-green-400' :
                            dashBrainInsight.readiness_label === 'amber' ? 'text-orange-400' : 'text-red-400'
                          }`}>
                            🧠 {dashBrainInsight.readiness_label === 'green' ? 'In the Green' :
                               dashBrainInsight.readiness_label === 'amber' ? 'Amber' : 'Rest Day'}
                          </p>
                          <p className="text-gray-600 text-[10px]">{dashBrainInsight.readiness_score}/100</p>
                          <p className="text-gray-700 text-[10px]">· {dashBrainInsight.insight_date}</p>
                        </div>
                        {dashBrainInsight.headline && (
                          <p className="text-white text-sm font-semibold mt-1 leading-snug">{dashBrainInsight.headline}</p>
                        )}
                        <p className="text-gray-300 text-xs mt-1.5 leading-relaxed">{dashBrainInsight.insight}</p>
                        {dashBrainInsight.suggested_focus && (
                          <p className="text-gray-400 text-xs mt-2 border-t border-gray-800 pt-2">
                            <span className="text-gray-500 font-medium">Today: </span>{dashBrainInsight.suggested_focus}
                          </p>
                        )}
                      </div>
                    </div>
                    <button
                      onClick={async () => {
                        if (dashBrainLoading || !userId) return
                        setDashBrainLoading(true)
                        try {
                          const { data: sess } = await supabase.auth.getSession()
                          const token = sess.session?.access_token
                          if (!token) return
                          const res = await fetch('/api/brain/generate-insight', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
                            body: JSON.stringify({ date: new Date().toISOString().split('T')[0] }),
                          })
                          if (res.ok) {
                            const result = await res.json() as { headline: string; insight: string; suggested_focus: string; readiness_score: number; readiness_label: 'green' | 'amber' | 'red'; insight_date: string }
                            setDashBrainInsight(result)
                          }
                        } finally { setDashBrainLoading(false) }
                      }}
                      title="Regenerate insight"
                      className="shrink-0 text-gray-600 hover:text-gray-300 transition-colors mt-0.5"
                    >
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} className="w-4 h-4">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0l3.181 3.183a8.25 8.25 0 0013.803-3.7M4.031 9.865a8.25 8.25 0 0113.803-3.7l3.181 3.182m0-4.991v4.99" />
                      </svg>
                    </button>
                  </div>
                </>
              )}
            </div>
          )}
          {!dashBrainInsight && !dashBrainLoading && userId && (
            <button
              onClick={async () => {
                setDashBrainLoading(true)
                try {
                  const { data: sess } = await supabase.auth.getSession()
                  const token = sess.session?.access_token
                  if (!token) return
                  const res = await fetch('/api/brain/generate-insight', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
                    body: JSON.stringify({ date: new Date().toISOString().split('T')[0] }),
                  })
                  if (res.ok) {
                    const result = await res.json() as { headline: string; insight: string; suggested_focus: string; readiness_score: number; readiness_label: 'green' | 'amber' | 'red'; insight_date: string }
                    setDashBrainInsight(result)
                  }
                } finally { setDashBrainLoading(false) }
              }}
              className="w-full mb-3 rounded-2xl p-4 border border-dashed border-gray-700 text-center hover:border-orange-600/50 transition-colors group"
            >
              <p className="text-gray-500 text-sm group-hover:text-orange-400 transition-colors">🧠 Generate AI Daily Insight</p>
              <p className="text-gray-700 text-xs mt-0.5">7-day analysis · green / amber / red readiness</p>
            </button>
          )}

          {/* ── Daily Check-in Tiles ───────────────────────────────────── */}
          {checkinLoaded && (() => {
            // Use local date (not UTC) to avoid BST/timezone offset shifting the date
            const localStr = (d: Date) => {
              const y = d.getFullYear()
              const m = String(d.getMonth() + 1).padStart(2, '0')
              const day = String(d.getDate()).padStart(2, '0')
              return `${y}-${m}-${day}`
            }
            // Build Mon–Sun week day array for current week
            const todayDate = new Date(); todayDate.setHours(0,0,0,0)
            const todayStr = localStr(todayDate)
            const dayOfWeek = (todayDate.getDay() + 6) % 7 // Mon=0 … Sun=6
            const weekDays = Array.from({ length: 7 }, (_, i) => {
              const d = new Date(todayDate); d.setDate(todayDate.getDate() - dayOfWeek + i)
              return { label: ['M','T','W','T','F','S','S'][i], dateStr: localStr(d), isFuture: d > todayDate }
            })
            const morningDates = new Set(checkinHistory.filter(r => r.check_type === 'morning').map(r => r.check_date))
            const eveningDates = new Set(checkinHistory.filter(r => r.check_type === 'evening').map(r => r.check_date))

            const lastMorning = checkinHistory.filter(r => r.check_type === 'morning').sort((a,b) => b.check_date.localeCompare(a.check_date))[0]
            const lastEvening = checkinHistory.filter(r => r.check_type === 'evening').sort((a,b) => b.check_date.localeCompare(a.check_date))[0]

            const fmtLast = (dateStr: string | undefined) => {
              if (!dateStr) return 'Never'
              if (dateStr === todayStr) return 'Today'
              const d = new Date(dateStr + 'T00:00:00')
              const diff = Math.round((todayDate.getTime() - d.getTime()) / 86400000)
              if (diff === 1) return 'Yesterday'
              return `${diff}d ago`
            }

            const DayBubbles = ({ doneDates }: { doneDates: Set<string> }) => (
              <div className="flex justify-between mt-3">
                {weekDays.map((wd, i) => {
                  const done = doneDates.has(wd.dateStr)
                  return (
                    <div key={i} className="flex flex-col items-center gap-1">
                      <div className="w-6 h-6 rounded-full flex items-center justify-center text-[9px] font-bold"
                        style={done
                          ? { background: '#1d4ed8', border: '1px solid #3b82f6' }
                          : wd.isFuture
                          ? { background: 'transparent', border: '1px solid #374151' }
                          : { background: 'transparent', border: '1px solid #f97316' }
                        }>
                        {done ? <span className="text-white text-[10px]">✓</span> : <span style={{ color: wd.isFuture ? '#374151' : '#f97316' }}>{wd.label}</span>}
                      </div>
                    </div>
                  )
                })}
              </div>
            )

            return (
              <>
                <div className="grid grid-cols-2 gap-3">
                  {/* Morning tile */}
                  <button type="button" onClick={() => { setMorningDraft(morningCheckin ?? EMPTY_MORNING); setMorningStep(0); setMorningModalOpen(true) }}
                    className="rounded-2xl p-4 text-left transition-colors hover:opacity-90 active:scale-95"
                    style={{ background: '#111827', border: '1px solid #1f2937' }}>
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-[10px] font-bold tracking-widest text-orange-400">🌅 MORNING</span>
                      {morningCheckin && <span className="text-[9px] text-blue-400 font-bold">✓ DONE</span>}
                    </div>
                    <p className="text-[10px] text-gray-500 mb-0.5">Last: <span className="text-gray-300">{fmtLast(lastMorning?.check_date)}</span></p>
                    <p className="text-[10px] text-gray-500">Streak: <span className="text-orange-400 font-semibold">{morningStreak} {morningStreak === 1 ? 'day' : 'days'}</span></p>
                    <DayBubbles doneDates={morningDates} />
                  </button>

                  {/* Evening tile */}
                  <button type="button" onClick={() => { setEveningDraft(eveningCheckin ?? EMPTY_EVENING); setEveningStep(0); setEveningModalOpen(true) }}
                    className="rounded-2xl p-4 text-left transition-colors hover:opacity-90 active:scale-95"
                    style={{ background: '#111827', border: '1px solid #1f2937' }}>
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-[10px] font-bold tracking-widest text-indigo-400">🌙 EVENING</span>
                      {eveningCheckin && <span className="text-[9px] text-indigo-400 font-bold">✓ DONE</span>}
                    </div>
                    <p className="text-[10px] text-gray-500 mb-0.5">Last: <span className="text-gray-300">{fmtLast(lastEvening?.check_date)}</span></p>
                    <p className="text-[10px] text-gray-500">Streak: <span className="text-indigo-400 font-semibold">{eveningStreak} {eveningStreak === 1 ? 'day' : 'days'}</span></p>
                    <DayBubbles doneDates={eveningDates} />
                  </button>
                </div>

                {/* Evening check-in modal */}
                {eveningModalOpen && (() => {
                  const ESTEPS = [
                    {
                      key: 'feeling', title: 'How was your day?', subtitle: 'Overall from start to finish',
                      options: [
                        { v: 1, emoji: '😩', label: 'Rough' }, { v: 2, emoji: '😕', label: 'Hard' },
                        { v: 3, emoji: '😐', label: 'OK' }, { v: 4, emoji: '😊', label: 'Good' },
                        { v: 5, emoji: '🤩', label: 'Great' },
                      ],
                      val: () => eveningDraft.feeling_score,
                      set: (v: number) => setEveningDraft(d => ({ ...d, feeling_score: v })),
                    },
                    {
                      key: 'workout', title: 'Workout today?', subtitle: 'What happened with training?',
                      options: [
                        { v: 0, emoji: '🛋️', label: 'Rest day' }, { v: 1, emoji: '✅', label: 'Completed' },
                        { v: 2, emoji: '🔄', label: 'Modified' }, { v: 3, emoji: '❌', label: 'Skipped' },
                        { v: 4, emoji: '💪', label: 'Bonus' },
                      ],
                      val: () => eveningDraft.workout_status,
                      set: (v: number) => setEveningDraft(d => ({ ...d, workout_status: v })),
                    },
                    {
                      key: 'nutrition', title: 'Nutrition quality?', subtitle: 'How well did you eat today?',
                      options: [
                        { v: 1, emoji: '🍔', label: 'Poor' }, { v: 2, emoji: '🍕', label: 'Fair' },
                        { v: 3, emoji: '🍱', label: 'OK' }, { v: 4, emoji: '🥗', label: 'Good' },
                        { v: 5, emoji: '🌿', label: 'On point' },
                      ],
                      val: () => eveningDraft.nutrition_score,
                      set: (v: number) => setEveningDraft(d => ({ ...d, nutrition_score: v })),
                    },
                    {
                      key: 'stress', title: 'Stress level?', subtitle: 'Mental load today',
                      options: [
                        { v: 1, emoji: '😌', label: 'Calm' }, { v: 2, emoji: '🙂', label: 'Low' },
                        { v: 3, emoji: '😐', label: 'Moderate' }, { v: 4, emoji: '😤', label: 'High' },
                        { v: 5, emoji: '🤯', label: 'Max' },
                      ],
                      val: () => eveningDraft.stress_level,
                      set: (v: number) => setEveningDraft(d => ({ ...d, stress_level: v })),
                    },
                    {
                      key: 'energy', title: 'Energy during the day?', subtitle: 'Physical energy levels',
                      options: [
                        { v: 1, emoji: '🪫', label: 'Drained' }, { v: 2, emoji: '😞', label: 'Low' },
                        { v: 3, emoji: '⚡', label: 'OK' }, { v: 4, emoji: '🔋', label: 'Good' },
                        { v: 5, emoji: '🚀', label: 'High' },
                      ],
                      val: () => eveningDraft.energy_level,
                      set: (v: number) => setEveningDraft(d => ({ ...d, energy_level: v })),
                    },
                    {
                      key: 'tomorrow', title: 'Ready for tomorrow?', subtitle: 'Going into tonight',
                      options: [
                        { v: 1, emoji: '😴', label: 'Need rest' }, { v: 2, emoji: '😕', label: 'Tired' },
                        { v: 3, emoji: '😐', label: 'OK' }, { v: 4, emoji: '💪', label: 'Ready' },
                        { v: 5, emoji: '🔥', label: 'Bring it' },
                      ],
                      val: () => eveningDraft.motivation_level,
                      set: (v: number) => setEveningDraft(d => ({ ...d, motivation_level: v })),
                    },
                  ]
                  const estep = ESTEPS[eveningStep]
                  const eIsLast = eveningStep === ESTEPS.length - 1
                  const eCanNext = estep.val() != null
                  return (
                    <div className="fixed inset-0 z-50 flex items-center justify-center px-4" style={{ background: 'rgba(0,0,0,0.85)' }}
                      onClick={e => { if (e.target === e.currentTarget) setEveningModalOpen(false) }}>
                      <div className="w-full max-w-md rounded-3xl p-6 overflow-y-auto" style={{ background: '#111827', border: '1px solid #1f2937', maxHeight: '90vh' }}>
                        {/* Header */}
                        <div className="flex items-center justify-between mb-4">
                          <p className="text-[10px] font-bold tracking-widest text-indigo-400">🌙 EVENING CHECK-IN</p>
                          <button type="button" onClick={() => setEveningModalOpen(false)} className="text-gray-500 hover:text-gray-300 text-lg leading-none">✕</button>
                        </div>
                        {/* Progress dots */}
                        <div className="flex justify-center gap-1.5 mb-5">
                          {ESTEPS.map((_, i) => (
                            <div key={i} className="rounded-full transition-all" style={{ width: i === eveningStep ? 20 : 6, height: 6, background: i < eveningStep ? '#4f46e5' : i === eveningStep ? '#6366f1' : '#374151' }} />
                          ))}
                        </div>
                        {/* Question */}
                        <h2 className="text-lg font-bold text-white mb-1">{estep.title}</h2>
                        <p className="text-xs text-gray-500 mb-5">{estep.subtitle}</p>
                        {/* Options */}
                        <div className="flex justify-around mb-6">
                          {estep.options.map(opt => {
                            const cur = estep.val()
                            const sel = cur === opt.v
                            return (
                              <button key={opt.v} type="button"
                                onClick={() => estep.set(opt.v as number)}
                                className="flex flex-col items-center gap-1.5 transition-all"
                                style={{ opacity: cur != null && !sel ? 0.4 : 1 }}>
                                <span className={`text-3xl transition-transform ${sel ? 'scale-125' : 'hover:scale-110'}`}>{opt.emoji}</span>
                                <span className="text-[10px] font-medium" style={{ color: sel ? '#6366f1' : '#6b7280' }}>{opt.label}</span>
                              </button>
                            )
                          })}
                        </div>
                        {/* Nav buttons */}
                        <div className="flex gap-3">
                          {eveningStep > 0 && (
                            <button type="button" onClick={() => setEveningStep(s => s - 1)}
                              className="flex-1 py-3 rounded-2xl text-sm font-semibold text-gray-400 transition-colors"
                              style={{ background: '#1f2937' }}>
                              Back
                            </button>
                          )}
                          <button type="button"
                            onClick={async () => {
                              if (eIsLast) {
                                await saveEveningCheckin(eveningDraft)
                                setEveningModalOpen(false)
                              } else {
                                setEveningStep(s => s + 1)
                              }
                            }}
                            disabled={!eCanNext}
                            className="flex-1 py-3 rounded-2xl text-sm font-bold text-white transition-colors"
                            style={{ background: eCanNext ? '#4f46e5' : '#374151' }}>
                            {eIsLast ? (checkinSaving ? 'Saving…' : 'Save Check-in') : 'Next →'}
                          </button>
                        </div>
                      </div>
                    </div>
                  )
                })()}

                {/* Morning check-in modal */}
                {morningModalOpen && (() => {
                  const STEPS = [
                    {
                      key: 'feeling', title: 'How are you feeling?', subtitle: 'Overall energy right now',
                      options: [
                        { v: 1, emoji: '😴', label: 'Drained' }, { v: 2, emoji: '😕', label: 'Tired' },
                        { v: 3, emoji: '😐', label: 'OK' }, { v: 4, emoji: '😊', label: 'Good' },
                        { v: 5, emoji: '🤩', label: 'Great' },
                      ],
                      multi: false,
                      val: () => morningDraft.feeling_score,
                      set: (v: number) => setMorningDraft(d => ({ ...d, feeling_score: v })),
                    },
                    {
                      key: 'aches', title: 'Any body aches?', subtitle: 'Tap all that apply — or skip',
                      options: [
                        { v: 'legs', emoji: '🦵', label: 'Legs' }, { v: 'arms', emoji: '💪', label: 'Arms' },
                        { v: 'back', emoji: '🔙', label: 'Back' }, { v: 'neck', emoji: '🫀', label: 'Neck' },
                        { v: 'shoulders', emoji: '🤷', label: 'Shoulders' }, { v: 'chest', emoji: '💚', label: 'Chest' },
                        { v: 'feet', emoji: '🦶', label: 'Feet' }, { v: 'head', emoji: '🤕', label: 'Head' },
                        { v: 'none', emoji: '✅', label: 'None' },
                      ],
                      multi: true,
                      val: () => morningDraft.body_ache_areas,
                      toggleAche: (v: string) => setMorningDraft(d => {
                        if (v === 'none') return { ...d, body_ache_areas: ['none'] }
                        const cur = d.body_ache_areas.filter(a => a !== 'none')
                        return { ...d, body_ache_areas: cur.includes(v) ? cur.filter(a => a !== v) : [...cur, v] }
                      }),
                    },
                    {
                      key: 'wakings', title: 'Night wakings', subtitle: 'How many times did you wake up?',
                      options: [
                        { v: 0, emoji: '😴', label: '0 — Solid' }, { v: 1, emoji: '1️⃣', label: '1 time' },
                        { v: 2, emoji: '2️⃣', label: '2 times' }, { v: 3, emoji: '3️⃣', label: '3 times' },
                        { v: 4, emoji: '😩', label: '4+ times' },
                      ],
                      multi: false,
                      val: () => morningDraft.night_wakings,
                      set: (v: number) => setMorningDraft(d => ({ ...d, night_wakings: v })),
                    },
                    {
                      key: 'sleep', title: 'Sleep quality', subtitle: 'How restorative did it feel?',
                      options: [
                        { v: 1, emoji: '😫', label: 'Terrible' }, { v: 2, emoji: '😕', label: 'Poor' },
                        { v: 3, emoji: '😐', label: 'OK' }, { v: 4, emoji: '😌', label: 'Good' },
                        { v: 5, emoji: '✨', label: 'Great' },
                      ],
                      multi: false,
                      val: () => morningDraft.sleep_rating,
                      set: (v: number) => setMorningDraft(d => ({ ...d, sleep_rating: v })),
                    },
                    {
                      key: 'energy', title: 'Energy level', subtitle: 'Physical energy right now',
                      options: [
                        { v: 1, emoji: '🪫', label: 'Empty' }, { v: 2, emoji: '😞', label: 'Low' },
                        { v: 3, emoji: '⚡', label: 'OK' }, { v: 4, emoji: '🔋', label: 'Good' },
                        { v: 5, emoji: '🚀', label: 'Charged' },
                      ],
                      multi: false,
                      val: () => morningDraft.energy_level,
                      set: (v: number) => setMorningDraft(d => ({ ...d, energy_level: v })),
                    },
                    {
                      key: 'stress', title: 'Stress level', subtitle: 'Mental load going into the day',
                      options: [
                        { v: 1, emoji: '😌', label: 'Calm' }, { v: 2, emoji: '🙂', label: 'Low' },
                        { v: 3, emoji: '😐', label: 'Moderate' }, { v: 4, emoji: '😤', label: 'High' },
                        { v: 5, emoji: '🤯', label: 'Very high' },
                      ],
                      multi: false,
                      val: () => morningDraft.stress_level,
                      set: (v: number) => setMorningDraft(d => ({ ...d, stress_level: v })),
                    },
                    {
                      key: 'motivation', title: 'Ready to train?', subtitle: 'Motivation to work out today',
                      options: [
                        { v: 1, emoji: '🛋️', label: 'Rest day' }, { v: 2, emoji: '😑', label: 'Not really' },
                        { v: 3, emoji: '😐', label: 'Maybe' }, { v: 4, emoji: '💪', label: 'Yes' },
                        { v: 5, emoji: '🔥', label: 'Fired up' },
                      ],
                      multi: false,
                      val: () => morningDraft.motivation_level,
                      set: (v: number) => setMorningDraft(d => ({ ...d, motivation_level: v })),
                    },
                  ]
                  const step = STEPS[morningStep]
                  const isLast = morningStep === STEPS.length - 1
                  const canNext = step.key === 'aches'
                    ? true // aches can always skip
                    : (step.val() != null && step.val() !== undefined)
                  return (
                    <div className="fixed inset-0 z-50 flex items-center justify-center px-4" style={{ background: 'rgba(0,0,0,0.85)' }}
                      onClick={e => { if (e.target === e.currentTarget) setMorningModalOpen(false) }}>
                      <div className="w-full max-w-md rounded-3xl p-6 overflow-y-auto" style={{ background: '#111827', border: '1px solid #1f2937', maxHeight: '90vh' }}>
                        {/* Header */}
                        <div className="flex items-center justify-between mb-4">
                          <p className="text-[10px] font-bold tracking-widest text-orange-400">🌅 MORNING CHECK-IN</p>
                          <button type="button" onClick={() => setMorningModalOpen(false)} className="text-gray-500 hover:text-gray-300 text-lg leading-none">✕</button>
                        </div>
                        {/* Progress dots */}
                        <div className="flex justify-center gap-1.5 mb-5">
                          {STEPS.map((_, i) => (
                            <div key={i} className="rounded-full transition-all" style={{ width: i === morningStep ? 20 : 6, height: 6, background: i < morningStep ? '#1d4ed8' : i === morningStep ? '#f97316' : '#374151' }} />
                          ))}
                        </div>
                        {/* Question */}
                        <h2 className="text-lg font-bold text-white mb-1">{step.title}</h2>
                        <p className="text-xs text-gray-500 mb-5">{step.subtitle}</p>
                        {/* Options */}
                        {step.key === 'aches' ? (
                          <div className="grid grid-cols-3 gap-2 mb-6">
                            {step.options.map(opt => {
                              const areas = morningDraft.body_ache_areas
                              const sel = areas.includes(String(opt.v))
                              return (
                                <button key={String(opt.v)} type="button"
                                  onClick={() => step.toggleAche?.(String(opt.v))}
                                  className="flex flex-col items-center gap-1.5 py-3 rounded-2xl transition-all"
                                  style={{ background: sel ? 'rgba(59,130,246,0.25)' : '#1f2937', border: sel ? '1px solid #3b82f6' : '1px solid #374151' }}>
                                  <span className="text-2xl">{opt.emoji}</span>
                                  <span className="text-[10px] font-medium" style={{ color: sel ? '#60a5fa' : '#9ca3af' }}>{opt.label}</span>
                                </button>
                              )
                            })}
                          </div>
                        ) : (
                          <div className="flex justify-around mb-6">
                            {step.options.map(opt => {
                              const cur = step.val()
                              const sel = cur === opt.v
                              return (
                                <button key={opt.v} type="button"
                                  onClick={() => step.set?.(opt.v as number)}
                                  className="flex flex-col items-center gap-1.5 transition-all"
                                  style={{ opacity: cur != null && !sel ? 0.4 : 1 }}>
                                  <span className={`text-3xl transition-transform ${sel ? 'scale-125' : 'hover:scale-110'}`}>{opt.emoji}</span>
                                  <span className="text-[10px] font-medium" style={{ color: sel ? '#f97316' : '#6b7280' }}>{opt.label}</span>
                                </button>
                              )
                            })}
                          </div>
                        )}
                        {/* Nav buttons */}
                        <div className="flex gap-3">
                          {morningStep > 0 && (
                            <button type="button" onClick={() => setMorningStep(s => s - 1)}
                              className="flex-1 py-3 rounded-2xl text-sm font-semibold text-gray-400 transition-colors"
                              style={{ background: '#1f2937' }}>
                              Back
                            </button>
                          )}
                          <button type="button"
                            onClick={async () => {
                              if (isLast) {
                                await saveMorningCheckin(morningDraft)
                                setMorningModalOpen(false)
                              } else {
                                setMorningStep(s => s + 1)
                              }
                            }}
                            disabled={!canNext && step.key !== 'aches'}
                            className="flex-1 py-3 rounded-2xl text-sm font-bold text-white transition-colors"
                            style={{ background: canNext || step.key === 'aches' ? '#f97316' : '#374151' }}>
                            {isLast ? (checkinSaving ? 'Saving…' : 'Save Check-in') : 'Next →'}
                          </button>
                        </div>
                      </div>
                    </div>
                  )
                })()}
              </>
            )
          })()}

          {/* ── Today's Lifestyle Log ─────────────────────────────────── */}
          {journalLoaded && (() => {
            const TAGS = [
              { key: 'alcohol',        emoji: '🍺', label: 'Alcohol' },
              { key: 'late_night',     emoji: '🌙', label: 'Late Night' },
              { key: 'high_stress',    emoji: '😰', label: 'Stress' },
              { key: 'poor_nutrition', emoji: '🍔', label: 'Junk Food' },
              { key: 'good_nutrition', emoji: '🥗', label: 'Clean Diet' },
              { key: 'meditation',     emoji: '🧘', label: 'Meditated' },
              { key: 'cold_exposure',  emoji: '🧊', label: 'Cold' },
              { key: 'travel',         emoji: '✈️', label: 'Travelling' },
              { key: 'illness',        emoji: '🤒', label: 'Unwell' },
            ]
            return (
              <div className="bg-gray-900 rounded-2xl p-4">
                <div className="flex items-center justify-between mb-3">
                  <p className="text-xs text-gray-400 uppercase tracking-wider font-semibold">Today&apos;s Lifestyle Log</p>
                  <p className="text-[10px] text-gray-600">Tap to toggle · Saves automatically</p>
                </div>
                <div className="flex flex-wrap gap-2">
                  {TAGS.map(t => {
                    const active = journalTags.includes(t.key)
                    return (
                      <button
                        key={t.key}
                        type="button"
                        onClick={() => toggleJournalTag(t.key)}
                        className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium transition-all"
                        style={active
                          ? { background: '#f97316', color: 'white', border: '1px solid #f97316' }
                          : { background: 'transparent', color: '#9ca3af', border: '1px solid #374151' }
                        }
                      >
                        <span>{t.emoji}</span>
                        <span>{t.label}</span>
                      </button>
                    )
                  })}
                </div>
                {journalTags.length > 0 && (
                  <p className="text-[10px] text-gray-600 mt-3">
                    Logged: {journalTags.map(t => TAGS.find(x => x.key === t)?.label ?? t).join(', ')} · Patterns visible in Health → Analytics
                  </p>
                )}
              </div>
            )
          })()}

          {/* Daily Steps — full width */}
          {(dailySteps?.total_steps != null || metrics?.steps != null) ? (() => {
            const totalSteps = dailySteps?.total_steps ?? metrics?.steps ?? 0
            const distKmSteps = dailySteps?.total_distance_meters
              ? (dailySteps.total_distance_meters / 1000).toFixed(1)
              : metrics?.distance_m
              ? (metrics.distance_m / 1000).toFixed(1)
              : null
            const pct = Math.min(100, (totalSteps / stepGoal) * 100)
            const goalMet = totalSteps >= stepGoal
            const totalDaysMet = stepsHistory.filter(r => (r.total_steps ?? 0) >= stepGoal).length
            const goalStr = stepGoal >= 1000 ? `${(stepGoal / 1000).toFixed(stepGoal % 1000 === 0 ? 0 : 1)}k` : String(stepGoal)
            return (
              <button
                type="button"
                onClick={() => setOpenDetail('steps')}
                className="bg-gray-900 hover:bg-gray-900/80 rounded-3xl p-4 text-left w-full transition-colors"
              >
                <div className="flex items-start justify-between mb-2">
                  <div>
                    <p className="text-xs text-gray-300 uppercase tracking-wider font-semibold flex items-center gap-1">
                      Daily Steps <InfoTooltip text={METRIC_INFO.steps} />
                      <span className="text-[10px] text-orange-400/80 ml-1 uppercase">Tap</span>
                    </p>
                    <p className="text-3xl font-bold text-white mt-1">
                      {totalSteps.toLocaleString()}
                    </p>
                    <p className="text-[11px] text-gray-500 mt-0.5">
                      Goal: {stepGoal.toLocaleString()} steps
                      {distKmSteps ? ` · ${distKmSteps} km` : ''}
                    </p>
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
                      backgroundColor: goalMet ? '#22c55e' : '#f97316',
                    }}
                  />
                </div>
                <div className="flex justify-between text-[11px] text-gray-500 mt-1">
                  <span style={{ color: goalMet ? '#22c55e' : undefined }}>
                    {Math.round(pct)}% of {goalStr} goal{goalMet ? ' ✓' : ''}
                  </span>
                  {totalDaysMet > 0 && (
                    <span className="text-gray-400">{totalDaysMet} days goal hit</span>
                  )}
                </div>
              </button>
            )
          })() : (
            <div className="bg-gray-900 rounded-3xl p-4 flex items-center justify-center">
              <p className="text-xs text-gray-500">No step data yet today.</p>
            </div>
          )}

        {/* Today's Vitals */}
        <div className="bg-gray-900 rounded-3xl p-6">
          <p className="text-xs text-gray-300 uppercase tracking-wider font-semibold mb-3 flex items-center gap-1">
            Today&apos;s Vitals <InfoTooltip text="Live readings from Garmin at your last sync. Sparklines show the 7-day trend." />
          </p>
          {(() => {
            const hrvVal = dailyHealth?.hrv_avg ?? metrics?.garmin_hrv_nightly_avg ?? null
            const rhrVal = metrics?.resting_hr ?? metrics?.resting_heart_rate_bpm ?? null
            const spo2Val = dailyHealth?.spo2_avg ?? metrics?.garmin_spo2_avg ?? metrics?.pulse_ox ?? null
            const bbVal = dailyHealth?.body_battery_end ?? metrics?.garmin_body_battery_eod ?? null
            const sleepScore = sleepData?.sleep_score ?? metrics?.garmin_sleep_score ?? null
            const hydrationL = dailyHealth?.hydration_intake_ml != null
              ? Math.round((dailyHealth.hydration_intake_ml / 1000) * 10) / 10
              : null
            const intensityMin = dailySteps?.active_minutes ?? null
            return (
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                <MetricTile label="HRV" icon="💚" value={hrvVal} unit="ms" tooltip={METRIC_INFO.hrv} trend={trends.hrv} trendColor="#22c55e" onClick={() => setOpenDetail('hrv')} />
                <MetricTile label="Resting HR" icon="❤️" value={rhrVal} unit="bpm" tooltip={METRIC_INFO.restingHr} trend={trends.restingHr} trendColor="#ef4444" invert onClick={() => setOpenDetail('restingHr')} />
                <MetricTile label="SpO2" icon="🩸" value={spo2Val} unit="%" tooltip={METRIC_INFO.spo2} onClick={() => setOpenDetail('spo2')} />
                <MetricTile label="Stress" icon="😌" value={dailyHealth?.stress_avg ?? metrics?.garmin_stress_avg ?? null} tooltip={METRIC_INFO.stress} trend={trends.stress} trendColor="#fbbf24" invert onClick={() => setOpenDetail('stress')} />
                <MetricTile
                  label="Intensity Min"
                  icon="🔥"
                  value={(() => {
                    // Prefer Garmin's own weekly intensity minutes (moderate + 2×vigorous)
                    const mod = dailySteps?.moderate_intensity_minutes ?? null
                    const vig = dailySteps?.vigorous_intensity_minutes ?? null
                    if (mod != null || vig != null) return (mod ?? 0) + (vig ?? 0) * 2
                    return intensityMin
                  })()}
                  unit="min"
                  tooltip="Garmin weekly intensity minutes: moderate 1×, vigorous 2×. Goal: 150 min/week."
                  onClick={() => setOpenDetail('intensity')}
                />
                <MetricTile label="Recovery" icon="⚡" value={bbVal} unit="" tooltip={METRIC_INFO.bodyBattery} trend={trends.bodyBattery} trendColor="#60a5fa" onClick={() => setOpenDetail('bodyBattery')} />
                <MetricTile label="Sleep Score" icon="🌙" value={sleepScore} unit="/100" tooltip={METRIC_INFO.sleep} trend={trends.sleep} trendColor="#a78bfa" onClick={() => setSleepDetailOpen(true)} />
                {dailyHealth?.hydration_goal_ml != null && (
                  <MetricTile label="Hydration" icon="💧" value={hydrationL} unit="L" tooltip={METRIC_INFO.hydration} onClick={() => setOpenDetail('hydration')} />
                )}
              </div>
            )
          })()}
        </div>

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
            <p className="text-xs text-gray-300 uppercase tracking-wider font-semibold mb-3">Today&apos;s Activities</p>
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

        {/* Spacer so the last card never butts up against the BottomNav. */}
        <div aria-hidden="true" className="h-8" />
      </div>
      <BottomNav />
    </main>
  )
}

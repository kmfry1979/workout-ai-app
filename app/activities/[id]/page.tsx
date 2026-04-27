'use client'

import { useEffect, useState } from 'react'
import { useRouter, useParams } from 'next/navigation'
import { supabase } from '../../../lib/supabase'
import { BottomNav } from '../../../components/BottomNav'

type ExerciseSet = {
  set_order: number
  exercise_name: string | null
  category: string | null
  weight_kg: number | null
  reps: number | null
  duration_sec: number | null
  set_type: string | null
}

type TreadmillSegment = {
  start_min: number
  end_min: number
  incline_pct: number | null
  speed_kmh: number | null
  description: string
}

type GarminActivity = {
  id: string
  activity_type: string | null
  start_time: string
  duration_sec: number | null
  distance_m: number | null
  calories: number | null
  avg_hr: number | null
  max_hr: number | null
  training_effect: number | null
  raw_payload: Record<string, unknown> | null
  // Treadmill edit fields
  treadmill_segments: TreadmillSegment[] | null
  user_activity_notes: string | null
  user_edited_at: string | null
  ai_activity_summary: string | null
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function cleanType(raw: string | null): string {
  if (!raw) return 'Activity'
  const pyMatch = raw.match(/'typeKey':\s*'([^']+)'/)
  if (pyMatch) return pyMatch[1].replace(/_/g, ' ')
  const jsonMatch = raw.match(/"typeKey"\s*:\s*"([^"]+)"/)
  if (jsonMatch) return jsonMatch[1].replace(/_/g, ' ')
  return raw.replace(/_/g, ' ')
}

function timeOfDay(date: Date): string {
  const h = date.getHours()
  if (h >= 5 && h < 12) return 'Morning'
  if (h >= 12 && h < 14) return 'Midday'
  if (h >= 14 && h < 17) return 'Afternoon'
  if (h >= 17 && h < 21) return 'Evening'
  return 'Night'
}

function activityEmoji(type: string): string {
  const t = type.toLowerCase()
  if (t.includes('run') || t.includes('jog')) return '🏃'
  if (t.includes('cycling') || t.includes('bike') || t.includes('ride')) return '🚴'
  if (t.includes('swim')) return '🏊'
  if (t.includes('walk')) return '🚶'
  if (t.includes('strength') || t.includes('gym') || t.includes('weight')) return '🏋️'
  if (t.includes('yoga')) return '🧘'
  if (t.includes('hike') || t.includes('trail')) return '🥾'
  if (t.includes('ski')) return '⛷️'
  if (t.includes('soccer') || t.includes('football')) return '⚽'
  if (t.includes('tennis')) return '🎾'
  if (t.includes('row')) return '🚣'
  return '⚡'
}

function formatDuration(sec: number): string {
  const h = Math.floor(sec / 3600)
  const m = Math.floor((sec % 3600) / 60)
  const s = sec % 60
  if (h > 0) return `${h}h ${m}m`
  if (m > 0) return `${m}m ${s}s`
  return `${s}s`
}

function formatDistance(m: number): string {
  if (m >= 1000) return `${(m / 1000).toFixed(2)} km`
  return `${Math.round(m)} m`
}

function formatPace(mps: number): string {
  const secPerKm = Math.round(1000 / mps)
  return `${Math.floor(secPerKm / 60)}:${String(secPerKm % 60).padStart(2, '0')} /km`
}

function formatSecPerKm(sec: number): string {
  const s = Math.round(sec)
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

// ─── Stat block ───────────────────────────────────────────────────────────────

function Stat({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
  return (
    <div className="bg-gray-800/60 rounded-xl p-3">
      <p className="text-gray-500 text-xs mb-1">{label}</p>
      <p className={`font-bold text-lg leading-none ${highlight ? 'text-orange-400' : 'text-white'}`}>{value}</p>
    </div>
  )
}

// ─── Training Effect Gauge ─────────────────────────────────────────────────────

function TrainingEffectGauge({ aerobic, anaerobic }: { aerobic?: number; anaerobic?: number }) {
  if (!aerobic && !anaerobic) return null

  const teLabels = ['None', 'Minor', 'Maintaining', 'Improving', 'Highly Improving', 'Overreaching']
  const teColors = ['#374151', '#3b82f6', '#22c55e', '#f59e0b', '#f97316', '#ef4444']

  function Gauge({ value, label }: { value: number; label: string }) {
    const pct = Math.min(value / 5, 1)
    const radius = 40
    const circumference = 2 * Math.PI * radius
    // Only draw top half (semicircle)
    const semiCirc = circumference / 2
    const offset = semiCirc - pct * semiCirc
    const colorIndex = Math.min(Math.floor(value), 5)
    const color = teColors[colorIndex]
    const teLabel = teLabels[Math.round(value)] ?? 'Unknown'

    return (
      <div className="flex flex-col items-center gap-1">
        <div className="relative w-24 h-14">
          <svg viewBox="0 0 100 52" className="w-full h-full">
            {/* Background track */}
            <path
              d="M 10 50 A 40 40 0 0 1 90 50"
              fill="none"
              stroke="#374151"
              strokeWidth="10"
              strokeLinecap="round"
            />
            {/* Filled arc */}
            <path
              d="M 10 50 A 40 40 0 0 1 90 50"
              fill="none"
              stroke={color}
              strokeWidth="10"
              strokeLinecap="round"
              strokeDasharray={`${semiCirc}`}
              strokeDashoffset={`${offset}`}
              style={{ transition: 'stroke-dashoffset 1s ease' }}
            />
          </svg>
          <div className="absolute inset-0 flex flex-col items-center justify-end pb-1">
            <span className="text-white font-bold text-lg leading-none">{value.toFixed(1)}</span>
          </div>
        </div>
        <p className="text-gray-500 text-xs">{label}</p>
        <p className="text-xs font-medium" style={{ color }}>{teLabel}</p>
      </div>
    )
  }

  return (
    <div className="bg-gray-900 rounded-2xl p-4">
      <h3 className="text-white font-semibold text-sm mb-4">Training Effect</h3>
      <div className="flex justify-around">
        {aerobic != null && <Gauge value={aerobic} label="Aerobic" />}
        {anaerobic != null && <Gauge value={anaerobic} label="Anaerobic" />}
      </div>
      <p className="text-gray-600 text-xs text-center mt-3">Scale: 0–5 · 5 = Overreaching</p>
    </div>
  )
}

// ─── HR Zone Donut ────────────────────────────────────────────────────────────

const ZONE_STROKE_COLORS = ['#3b82f6', '#22c55e', '#eab308', '#f97316', '#ef4444']
const ZONE_BG_COLORS = ['bg-blue-500', 'bg-green-500', 'bg-yellow-500', 'bg-orange-500', 'bg-red-500']
const ZONE_LABELS = ['Z1 Recovery', 'Z2 Aerobic', 'Z3 Tempo', 'Z4 Threshold', 'Z5 Max']
const ZONE_SHORT = ['Z1', 'Z2', 'Z3', 'Z4', 'Z5']

function HrZones({ raw }: { raw: Record<string, unknown> }) {
  const zones = [1, 2, 3, 4, 5].map(i => {
    const val = raw[`hrTimeInZone_${i}`] ?? raw[`timeInHRZone${i}`]
    return val != null ? Math.round(Number(val) / 60) : 0
  })

  const total = zones.reduce((s, v) => s + v, 0)
  if (total === 0) return null

  // Build donut segments
  const radius = 42
  const cx = 60
  const cy = 60
  const circumference = 2 * Math.PI * radius
  let cumulativePct = 0

  const segments = zones.map((min, i) => {
    const pct = total > 0 ? min / total : 0
    const offset = circumference * (1 - pct)
    const rotation = cumulativePct * 360 - 90
    cumulativePct += pct
    return { pct, offset, rotation, min, color: ZONE_STROKE_COLORS[i] }
  })

  const dominantZone = zones.indexOf(Math.max(...zones))
  const dominantPct = total > 0 ? Math.round((zones[dominantZone] / total) * 100) : 0

  return (
    <div className="bg-gray-900 rounded-2xl p-4">
      <h3 className="text-white font-semibold text-sm mb-4">Heart Rate Zones</h3>
      <div className="flex gap-4 items-center">
        {/* Donut */}
        <div className="relative shrink-0">
          <svg width="120" height="120" viewBox="0 0 120 120">
            {/* Background ring */}
            <circle cx={cx} cy={cy} r={radius} fill="none" stroke="#1f2937" strokeWidth="16" />
            {segments.map((seg, i) => (
              seg.pct > 0 ? (
                <circle
                  key={i}
                  cx={cx}
                  cy={cy}
                  r={radius}
                  fill="none"
                  stroke={seg.color}
                  strokeWidth="16"
                  strokeDasharray={`${circumference * seg.pct} ${circumference * (1 - seg.pct)}`}
                  strokeDashoffset={circumference * 0.25}
                  transform={`rotate(${seg.rotation} ${cx} ${cy})`}
                  strokeLinecap="butt"
                />
              ) : null
            ))}
          </svg>
          {/* Centre label */}
          <div className="absolute inset-0 flex flex-col items-center justify-center">
            <span className="text-white font-bold text-lg leading-none">{dominantPct}%</span>
            <span className="text-gray-500 text-xs">{ZONE_SHORT[dominantZone]}</span>
          </div>
        </div>

        {/* Legend + bars */}
        <div className="flex-1 space-y-2">
          {zones.map((min, i) => {
            const pct = total > 0 ? Math.round((min / total) * 100) : 0
            return (
              <div key={i} className="flex items-center gap-2">
                <div className={`w-2 h-2 rounded-full shrink-0 ${ZONE_BG_COLORS[i]}`} />
                <span className="text-gray-400 text-xs w-20 shrink-0">{ZONE_LABELS[i]}</span>
                <div className="flex-1 bg-gray-800 rounded-full h-1.5">
                  <div
                    className={`${ZONE_BG_COLORS[i]} h-1.5 rounded-full`}
                    style={{ width: `${pct}%` }}
                  />
                </div>
                <span className="text-gray-500 text-xs w-8 text-right shrink-0">{min}m</span>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}

// ─── Effort Summary (for runs/walks) ─────────────────────────────────────────

function EffortSummary({ activity, raw }: { activity: GarminActivity; raw: Record<string, unknown> }) {
  const avgSpeed = raw.averageSpeed as number | undefined
  const maxSpeed = raw.maxSpeed as number | undefined
  const avgCadence = raw.averageRunningCadenceInStepsPerMinute as number | undefined
  const maxCadence = raw.maxRunningCadenceInStepsPerMinute as number | undefined
  const avgStrideLen = raw.avgStrideLength as number | undefined
  const vo2max = (raw.vO2MaxValue ?? raw.vo2MaxValue) as number | undefined

  const hasData = avgSpeed || avgCadence || vo2max
  if (!hasData) return null

  const items = [
    avgSpeed && activity.distance_m && activity.distance_m > 100
      ? { label: 'Avg Pace', value: formatPace(avgSpeed), sub: null }
      : null,
    maxSpeed && activity.distance_m && activity.distance_m > 100
      ? { label: 'Best Pace', value: formatPace(maxSpeed), sub: null }
      : null,
    avgCadence ? { label: 'Avg Cadence', value: `${Math.round(avgCadence)} spm`, sub: maxCadence ? `max ${Math.round(maxCadence)}` : null } : null,
    avgStrideLen ? { label: 'Stride Length', value: `${(Number(avgStrideLen)).toFixed(2)} m`, sub: null } : null,
    vo2max ? { label: 'VO2 Max', value: String(vo2max), sub: 'mL/kg/min' } : null,
  ].filter(Boolean) as { label: string; value: string; sub: string | null }[]

  if (items.length === 0) return null

  return (
    <div className="bg-gray-900 rounded-2xl p-4">
      <h3 className="text-white font-semibold text-sm mb-3">Performance</h3>
      <div className="grid grid-cols-2 gap-3">
        {items.map(item => (
          <div key={item.label} className="bg-gray-800/60 rounded-xl p-3">
            <p className="text-gray-500 text-xs mb-1">{item.label}</p>
            <p className="text-white font-bold text-base leading-none">{item.value}</p>
            {item.sub && <p className="text-gray-600 text-xs mt-0.5">{item.sub}</p>}
          </div>
        ))}
      </div>
    </div>
  )
}

// ─── Relative Effort Bar ──────────────────────────────────────────────────────

function RelativeEffort({ raw }: { raw: Record<string, unknown> }) {
  const aerobicTE = raw.aerobicTrainingEffect as number | undefined
  const anaerobicTE = raw.anaerobicTrainingEffect as number | undefined
  if (!aerobicTE && !anaerobicTE) return null

  // Combine into overall effort 0–100
  const combined = Math.min(((aerobicTE ?? 0) + (anaerobicTE ?? 0)) / 10 * 100, 100)
  const label = combined < 20 ? 'Very Low' : combined < 40 ? 'Low' : combined < 60 ? 'Moderate' : combined < 80 ? 'High' : 'Very High'
  const color = combined < 40 ? '#22c55e' : combined < 70 ? '#f97316' : '#ef4444'

  return (
    <div className="bg-gray-900 rounded-2xl p-4">
      <div className="flex items-center justify-between mb-2">
        <h3 className="text-white font-semibold text-sm">Relative Effort</h3>
        <span className="text-xs font-bold px-2 py-0.5 rounded-full" style={{ color, background: `${color}22` }}>
          {label}
        </span>
      </div>
      <div className="bg-gray-800 rounded-full h-3 overflow-hidden">
        <div
          className="h-3 rounded-full transition-all duration-1000"
          style={{ width: `${combined}%`, background: `linear-gradient(90deg, #22c55e, ${color})` }}
        />
      </div>
      <div className="flex justify-between text-gray-600 text-xs mt-1">
        <span>Easy</span>
        <span>Max</span>
      </div>
    </div>
  )
}

// ─── Heart Rate Chart + AI Card ───────────────────────────────────────────────

type LapPoint = { cumDistKm: number; hr: number }

/** Build per-lap HR points from raw_payload.laps */
function buildLapHRPoints(laps: unknown[]): LapPoint[] {
  const points: LapPoint[] = []
  let cumDist = 0
  for (const lap of laps) {
    const l = lap as Record<string, unknown>
    const hr = Number(l.averageHR ?? l.avgHR ?? l.averageHeartRate ?? 0)
    const dist = Number(l.distance ?? l.totalDistance ?? 0)
    if (hr > 0 && dist > 0) {
      cumDist += dist / 1000
      points.push({ cumDistKm: cumDist, hr })
    }
  }
  return points
}

function HRChart({ points, avgHr, maxHr }: { points: LapPoint[]; avgHr: number; maxHr: number }) {
  if (points.length < 2) return null

  const W = 300
  const H = 80
  const PAD_L = 2
  const PAD_R = 2
  const PAD_T = 6
  const PAD_B = 2

  const totalDist = points[points.length - 1].cumDistKm
  const hrValues = points.map(p => p.hr)
  const hrMin = Math.max(40, Math.min(...hrValues) - 15)
  const hrMax = Math.max(...hrValues) + 10

  const xScale = (dist: number) => PAD_L + ((dist / totalDist) * (W - PAD_L - PAD_R))
  const yScale = (hr: number) => PAD_T + ((hrMax - hr) / (hrMax - hrMin)) * (H - PAD_T - PAD_B)

  // Build step-chart path: hold each lap's HR until the next lap starts
  let pathD = ''
  for (let i = 0; i < points.length; i++) {
    const x = xScale(points[i].cumDistKm)
    const y = yScale(points[i].hr)
    if (i === 0) {
      pathD += `M ${xScale(0)},${y} L ${x},${y}`
    } else {
      // Step: vertical then horizontal
      const prevY = yScale(points[i - 1].hr)
      pathD += ` L ${x},${prevY} L ${x},${y}`
    }
  }
  // Extend to end then close area
  pathD += ` L ${xScale(totalDist)},${yScale(points[points.length - 1].hr)}`
  const closePath = ` L ${xScale(totalDist)},${H} L ${xScale(0)},${H} Z`

  const avgY = yScale(avgHr)

  // X-axis tick every 1 km
  const kmTicks: number[] = []
  for (let km = 1; km <= Math.floor(totalDist); km++) kmTicks.push(km)

  // Y-axis grid lines at round HR values
  const hrStep = (hrMax - hrMin) > 60 ? 20 : 10
  const hrGridLines: number[] = []
  for (let h = Math.ceil(hrMin / hrStep) * hrStep; h <= hrMax; h += hrStep) hrGridLines.push(h)

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ height: 80 }} preserveAspectRatio="none">
      {/* Subtle HR grid lines */}
      {hrGridLines.map(h => (
        <line key={h} x1={PAD_L} y1={yScale(h)} x2={W - PAD_R} y2={yScale(h)}
          stroke="#374151" strokeWidth="0.5" strokeDasharray="2,3" />
      ))}

      {/* Filled area */}
      <path d={pathD + closePath} fill="rgba(239,68,68,0.25)" />

      {/* Top line */}
      <path d={pathD} fill="none" stroke="#f87171" strokeWidth="1.5" strokeLinejoin="round" />

      {/* Avg HR dashed line */}
      <line x1={PAD_L} y1={avgY} x2={W - PAD_R} y2={avgY}
        stroke="#ffffff" strokeWidth="1" strokeDasharray="4,3" opacity="0.6" />

      {/* X-axis km ticks */}
      {kmTicks.map(km => (
        <line key={km} x1={xScale(km)} y1={H - 3} x2={xScale(km)} y2={H}
          stroke="#4b5563" strokeWidth="0.8" />
      ))}
    </svg>
  )
}

function HRCard({ activity, raw, hrInsight, hrInsightLoading }: {
  activity: GarminActivity
  raw: Record<string, unknown>
  hrInsight: string | null
  hrInsightLoading: boolean
}) {
  const avgHr = activity.avg_hr
  const maxHr = activity.max_hr
  if (!avgHr && !maxHr && !hrInsight && !hrInsightLoading) return null

  const laps = raw.laps as unknown[] | undefined
  const points = laps && laps.length >= 2 ? buildLapHRPoints(laps) : []

  // HR zone distribution for the stats row
  const hrZoneSec = [1, 2, 3, 4, 5].map(i => {
    const val = raw[`hrTimeInZone_${i}`] ?? raw[`timeInHRZone${i}`]
    return val != null ? Number(val) : 0
  })
  const totalHRSec = hrZoneSec.reduce((s, v) => s + v, 0)
  const dominantZoneIdx = totalHRSec > 0 ? hrZoneSec.indexOf(Math.max(...hrZoneSec)) : -1
  const HR_ZONE_NAMES = ['Warm Up', 'Easy', 'Aerobic', 'Threshold', 'Max']
  const HR_ZONE_COLORS_LIST = ['#6b7280', '#3b82f6', '#22c55e', '#f97316', '#ef4444']

  return (
    <div className="bg-gray-900 rounded-2xl overflow-hidden">
      {/* Chart area */}
      {points.length >= 2 && avgHr && maxHr && (
        <div className="px-4 pt-4 pb-1">
          <div className="flex items-center justify-between mb-2">
            <h3 className="text-white font-semibold text-sm">Heart Rate</h3>
            {dominantZoneIdx >= 0 && (
              <span className="text-[10px] px-2 py-0.5 rounded-full font-medium"
                style={{ backgroundColor: HR_ZONE_COLORS_LIST[dominantZoneIdx] + '33', color: HR_ZONE_COLORS_LIST[dominantZoneIdx] }}>
                Mostly {HR_ZONE_NAMES[dominantZoneIdx]}
              </span>
            )}
          </div>

          {/* Y-axis labels float left of chart */}
          <div className="relative">
            <div className="absolute left-0 top-0 bottom-0 flex flex-col justify-between pointer-events-none" style={{ width: 28 }}>
              <span className="text-gray-600 text-[8px] leading-none">{maxHr}</span>
              <span className="text-gray-600 text-[8px] leading-none">{avgHr}</span>
              <span className="text-gray-600 text-[8px] leading-none">bpm</span>
            </div>
            <div className="ml-7">
              <HRChart points={points} avgHr={avgHr} maxHr={maxHr} />
            </div>
          </div>

          {/* X-axis distance labels */}
          <div className="ml-7 flex justify-between mt-0.5">
            {[...Array(Math.floor(points[points.length - 1].cumDistKm) + 1)].map((_, i) => (
              i % 1 === 0 && (
                <span key={i} className="text-gray-600 text-[8px]">
                  {i === 0 ? '' : `${i} km`}
                </span>
              )
            ))}
          </div>
        </div>
      )}

      {/* Stats row */}
      <div className="px-4 py-3 flex gap-6 border-t border-gray-800">
        {avgHr && (
          <div>
            <p className="text-gray-500 text-[10px] uppercase tracking-wider">Avg Heart Rate</p>
            <p className="text-white font-bold text-xl">{avgHr} <span className="text-gray-500 text-sm font-normal">bpm</span></p>
          </div>
        )}
        {maxHr && (
          <div>
            <p className="text-gray-500 text-[10px] uppercase tracking-wider">Max Heart Rate</p>
            <p className="text-white font-bold text-xl">{maxHr} <span className="text-gray-500 text-sm font-normal">bpm</span></p>
          </div>
        )}
        {dominantZoneIdx >= 0 && totalHRSec > 0 && (
          <div>
            <p className="text-gray-500 text-[10px] uppercase tracking-wider">Peak Zone</p>
            <p className="font-bold text-xl" style={{ color: HR_ZONE_COLORS_LIST[dominantZoneIdx] }}>
              Z{dominantZoneIdx + 1}
            </p>
          </div>
        )}
      </div>

      {/* Athlete Intelligence — HR insight */}
      {(hrInsight || hrInsightLoading) && (
        <div className="px-4 pb-4 pt-0 border-t border-gray-800">
          <div className="flex items-center gap-2 mb-2 pt-3">
            <div className="w-5 h-5 bg-orange-500 rounded-full flex items-center justify-center text-[10px] font-bold text-white shrink-0">A</div>
            <p className="text-orange-400 text-[10px] font-bold uppercase tracking-wider">Athlete Intelligence</p>
          </div>
          {hrInsightLoading && !hrInsight ? (
            <div className="flex items-center gap-2 text-gray-500 text-xs">
              <span className="w-3 h-3 border border-orange-400 border-t-transparent rounded-full animate-spin" />
              Analysing heart rate...
            </div>
          ) : hrInsight ? (
            <p className="text-gray-200 text-sm leading-relaxed">{hrInsight}</p>
          ) : null}
        </div>
      )}
    </div>
  )
}

// ─── Pace Zones Card ──────────────────────────────────────────────────────────
//
// Zone boundaries are derived from the user's Garmin 5K predicted time, matching
// Garmin's threshold-based pace zone model. Distribution comes from lap data
// fetched during sync (raw_payload.laps).  Falls back to HR zone distribution
// when lap data isn't available (older activities or non-GPS runs).

// Zone definitions ordered fastest → slowest (Garmin display order: Z6 at top)
// Multipliers are of 5K pace (sec/km). Smaller multiplier = faster speed.
const PACE_ZONE_DEFS = [
  { label: 'Z6 Anaerobic', shortLabel: 'Z6', color: '#7c3aed', loMult: 0,    hiMult: 0.86  },
  { label: 'Z5 VO₂ Max',   shortLabel: 'Z5', color: '#ef4444', loMult: 0.86, hiMult: 0.92  },
  { label: 'Z4 Threshold', shortLabel: 'Z4', color: '#f97316', loMult: 0.92, hiMult: 0.98  },
  { label: 'Z3 Tempo',     shortLabel: 'Z3', color: '#22c55e', loMult: 0.98, hiMult: 1.10  },
  { label: 'Z2 Aerobic',   shortLabel: 'Z2', color: '#3b82f6', loMult: 1.10, hiMult: 1.28  },
  { label: 'Z1 Recovery',  shortLabel: 'Z1', color: '#6b7280', loMult: 1.28, hiMult: Infinity },
] as const

// HR zone fallback (5 zones, index 0 = Z1 slowest)
const HR_ZONE_DEFS = [
  { label: 'Z1 Warm Up',   color: '#6b7280' },
  { label: 'Z2 Easy',      color: '#3b82f6' },
  { label: 'Z3 Aerobic',   color: '#22c55e' },
  { label: 'Z4 Threshold', color: '#f97316' },
  { label: 'Z5 Max',       color: '#ef4444' },
] as const

/** Extract 5K predicted time in seconds from race_predictions JSONB array */
function extract5KTimeSec(preds: Record<string, unknown>[] | null): number | null {
  if (!preds) return null
  // Garmin returns distance in metres (5000), km (5), or as a race type string
  const p = preds.find(r =>
    r.distance === 5000 || r.distance === 5 ||
    String(r.raceType ?? r.type ?? r.name ?? '').toLowerCase().includes('5k') ||
    String(r.raceType ?? r.type ?? r.name ?? '').toLowerCase().includes('5000')
  )
  if (!p) return null
  const sec = Number(p.time ?? p.seconds ?? p.predictedTime ?? p.timeSec ?? 0)
  return sec > 60 ? sec : null
}

/**
 * Derive 5K-equivalent pace (sec/km) from multiple sources, best → fallback.
 * All zone boundaries are expressed as multiples of this pace (calibrated from
 * Garmin's actual zone model with a 5K reference).
 *
 * Priority:
 *   1. raw.lactateThresholdSpeed (m/s) — Garmin embeds this in some activities.
 *      Multiply by 1.065 to convert LT pace to equivalent 5K pace (LT is ~6.5%
 *      slower than 5K pace for most runners).
 *   2. profiles.race_predictions 5K time ÷ 5 — direct 5K pace.
 *   3. raw.vO2MaxValue → estimate 5K pace via Jack Daniels VDOT formula:
 *      5K_pace ≈ 947 × e^(−0.01991 × VO2Max)  (error ±15 sec/km, ±1 zone width)
 *      This works for VO2Max range 20–80 ml/kg/min.
 */
function deriveThresholdPaceSec(
  raw: Record<string, unknown>,
  racePredictions: Record<string, unknown>[] | null,
): { paceSec: number; source: 'lts' | '5k' | 'vo2max' } | null {
  // Source 1: lactateThresholdSpeed (m/s) → LT pace → equivalent 5K pace
  const lts = Number(raw.lactateThresholdSpeed ?? raw.lactateThresholdBikingSpeed ?? 0)
  if (lts > 0.5) {
    const ltPaceSec = 1000 / lts
    // LT pace is ~6.5% slower than 5K pace; convert so zone multipliers remain valid
    return { paceSec: Math.round(ltPaceSec / 1.065), source: 'lts' }
  }

  // Source 2: race predictions 5K time → pace
  const p5kSec = extract5KTimeSec(racePredictions)
  if (p5kSec) return { paceSec: Math.round(p5kSec / 5), source: '5k' }

  // Source 3: VO2Max → estimated 5K pace (Jack Daniels VDOT empirical formula)
  const vo2max = Number(raw.vO2MaxValue ?? raw.vo2MaxValue ?? raw.maxVO2 ?? 0)
  if (vo2max >= 20 && vo2max <= 85) {
    // Formula calibrated from Daniels VDOT table (35→472, 45→372, 60→287 sec/km)
    const estimated5kPaceSec = Math.round(947 * Math.exp(-0.01991 * vo2max))
    return { paceSec: estimated5kPaceSec, source: 'vo2max' }
  }

  return null
}

/** Compute seconds spent in each of the 6 Garmin-style pace zones from lap data */
function calcPaceZonesFromLaps(laps: unknown[], p5kSec: number): number[] {
  const zones = [0, 0, 0, 0, 0, 0]  // index 0 = Z6 (fastest)
  for (const lap of laps) {
    const l = lap as Record<string, unknown>
    const speed = Number(l.averageSpeed ?? l.avgSpeed ?? 0)
    if (speed <= 0) continue
    const paceSec = 1000 / speed    // sec/km
    const dur = Number(l.duration ?? l.movingDuration ?? l.elapsedDuration ?? 0)
    if (dur <= 0) continue
    // Match pace to zone (boundaries are multiples of P5K)
    const idx = PACE_ZONE_DEFS.findIndex(z => paceSec >= p5kSec * z.loMult && paceSec < p5kSec * z.hiMult)
    if (idx >= 0) zones[idx] += dur
  }
  return zones
}

/**
 * Compute seconds in 6 pace zones from treadmill speed segments.
 * Uses 5K prediction pace as zone boundaries when available (same as GPS mode),
 * falls back to avg pace if not.
 */
function calcTreadmillPaceZones(segments: TreadmillSegment[], boundaryBase: number): number[] {
  const zones = [0, 0, 0, 0, 0, 0]
  for (const seg of segments) {
    if (!seg.speed_kmh || seg.speed_kmh <= 0) continue
    const segPace = 3600 / seg.speed_kmh
    const dur = (seg.end_min - seg.start_min) * 60
    const idx = PACE_ZONE_DEFS.findIndex(z => segPace >= boundaryBase * z.loMult && segPace < boundaryBase * z.hiMult)
    if (idx >= 0) zones[idx] += dur
  }
  return zones
}

function PaceZonesCard({ activity, raw, treadmillSegments, paceInsight, paceInsightLoading, racePredictions }: {
  activity: GarminActivity
  raw: Record<string, unknown>
  treadmillSegments: TreadmillSegment[] | null
  paceInsight: string | null
  paceInsightLoading: boolean
  racePredictions: Record<string, unknown>[] | null
}) {
  const avgSpeed = raw.averageSpeed as number | undefined
  const maxSpeed = raw.maxSpeed as number | undefined
  const isRun = activity.distance_m != null && activity.distance_m > 100 && avgSpeed

  const avgPaceSecPerKm = avgSpeed && avgSpeed > 0 ? Math.round(1000 / avgSpeed) : null

  // ── Determine zone distribution source ──────────────────────────────────────
  const laps = raw.laps as unknown[] | undefined
  // Derive threshold pace from lactateThresholdSpeed (best) or 5K prediction (fallback)
  const thresholdResult = deriveThresholdPaceSec(raw, racePredictions)
  const thresholdPaceSec = thresholdResult?.paceSec ?? null   // sec/km at lactate threshold
  const thresholdSource = thresholdResult?.source ?? null

  type ZoneMode = 'gps_pace' | 'treadmill_pace' | 'hr_fallback'
  let mode: ZoneMode = 'hr_fallback'
  let zoneSec: number[] = []
  let zoneDefs: typeof PACE_ZONE_DEFS | typeof HR_ZONE_DEFS = HR_ZONE_DEFS

  if (laps && laps.length > 0 && thresholdPaceSec) {
    // Best case: real GPS laps + threshold pace → authentic Garmin-style pace zones
    zoneSec = calcPaceZonesFromLaps(laps, thresholdPaceSec)
    if (zoneSec.some(v => v > 0)) {
      mode = 'gps_pace'
      zoneDefs = PACE_ZONE_DEFS
    }
  }

  if (mode === 'hr_fallback' && treadmillSegments && treadmillSegments.length > 0) {
    // Treadmill: use threshold pace as boundary base (same zones as GPS) if available,
    // otherwise fall back to avg pace. This ensures 7:19/km avg maps to Z4 Threshold
    // rather than Z3 Tempo when lactate threshold is ~7:49/km.
    const boundaryBase = thresholdPaceSec ?? avgPaceSecPerKm
    const computed = boundaryBase ? calcTreadmillPaceZones(treadmillSegments, boundaryBase) : []
    if (computed.some(v => v > 0)) {
      zoneSec = computed
      mode = 'treadmill_pace'
      zoneDefs = PACE_ZONE_DEFS
    }
  }

  if (mode === 'hr_fallback') {
    // Fallback: HR zone times from Garmin, shown in ascending order (Z1 slow → Z5 fast)
    zoneSec = [1, 2, 3, 4, 5].map(i => {
      const val = raw[`hrTimeInZone_${i}`] ?? raw[`timeInHRZone${i}`]
      return val != null ? Number(val) : 0
    })
    zoneDefs = HR_ZONE_DEFS
  }

  const totalSec = zoneSec.reduce((s, v) => s + v, 0)
  if (!isRun && totalSec === 0 && !paceInsight && !paceInsightLoading) return null

  // Pace range labels — use threshold pace (same base used to compute zones)
  const labelBase = mode !== 'hr_fallback' ? (thresholdPaceSec ?? avgPaceSecPerKm) : null
  const paceRangeLabels: string[] = labelBase
    ? PACE_ZONE_DEFS.map((z, i) => {
        if (i === 0) return `<${formatSecPerKm(labelBase * z.hiMult)} /km`
        if (i === 5) return `>${formatSecPerKm(labelBase * z.loMult)} /km`
        return `${formatSecPerKm(labelBase * z.loMult)}–${formatSecPerKm(labelBase * z.hiMult)} /km`
      })
    : Array(zoneDefs.length).fill('')

  // Subtitle line — shows which data source determined zone boundaries
  const thresholdLabel = thresholdPaceSec
    ? thresholdSource === 'lts'
      ? `Lactate threshold ${formatSecPerKm(thresholdPaceSec)} /km`
      : thresholdSource === 'vo2max'
      ? `VO₂Max-estimated 5K pace ${formatSecPerKm(thresholdPaceSec)} /km`
      : `Predicted 5K pace ${formatSecPerKm(thresholdPaceSec)} /km`
    : avgPaceSecPerKm
    ? `Avg pace ${formatSecPerKm(avgPaceSecPerKm)} /km (no threshold data)`
    : null
  const subtitle = mode === 'gps_pace'
    ? thresholdLabel ?? 'GPS lap data'
    : mode === 'treadmill_pace'
    ? `Treadmill · ${thresholdLabel ?? 'speed segments'}`
    : 'Heart rate zone distribution'

  return (
    <div className="bg-gray-900 rounded-2xl p-4">
      {/* Header */}
      <div className="flex items-start justify-between mb-0.5">
        <h3 className="text-white font-semibold text-sm">
          {mode === 'hr_fallback' ? 'HR Zones' : 'Pace Zones'}
        </h3>
        {mode === 'hr_fallback' && totalSec > 0 && (
          <span className="text-[9px] text-gray-600 uppercase tracking-wider">from heart rate</span>
        )}
      </div>
      <p className="text-[10px] text-gray-500 mb-4">{subtitle}</p>

      {/* Avg + Best pace */}
      {isRun && avgSpeed && (
        <div className="flex gap-6 mb-4">
          <div>
            <p className="text-gray-500 text-[10px] uppercase tracking-wider">Avg Pace</p>
            <p className="text-white font-bold text-2xl leading-tight">{formatPace(avgSpeed)}</p>
          </div>
          {maxSpeed && maxSpeed > avgSpeed && (
            <div>
              <p className="text-gray-500 text-[10px] uppercase tracking-wider">Best Pace</p>
              <p className="text-orange-400 font-bold text-2xl leading-tight">{formatPace(maxSpeed)}</p>
            </div>
          )}
        </div>
      )}

      {/* Zone bars */}
      {totalSec > 0 && (
        <div className="space-y-2.5 mb-4">
          {zoneSec.map((sec, i) => {
            const def = (zoneDefs as readonly { label: string; color: string }[])[i]
            const pct = totalSec > 0 ? Math.round((sec / totalSec) * 100) : 0
            const mins = Math.floor(sec / 60)
            const durLabel = sec > 0
              ? (mins >= 60 ? `${Math.floor(mins/60)}h ${mins%60}m` : mins > 0 ? `${mins}m` : '<1m')
              : ''
            return (
              <div key={i} className="flex items-center gap-2">
                <span className="text-gray-400 text-xs w-24 shrink-0">{def.label}</span>
                <div className="flex-1 bg-gray-800 rounded-full h-5 overflow-hidden">
                  <div
                    className="h-5 rounded-full flex items-center justify-end pr-1.5 transition-all duration-700"
                    style={{
                      width: `${Math.max(pct > 0 ? 6 : 0, pct)}%`,
                      backgroundColor: def.color,
                      minWidth: pct > 0 ? 24 : 0,
                    }}
                  >
                    {pct >= 12 && <span className="text-white text-[9px] font-bold">{pct}%</span>}
                  </div>
                </div>
                <span className="text-gray-600 text-[9px] w-24 text-right shrink-0 leading-tight">
                  {pct > 0 ? (paceRangeLabels[i] || durLabel) : ''}
                </span>
              </div>
            )
          })}
        </div>
      )}

      {/* Pace range legend (GPS mode only, shown below bars) */}
      {mode === 'gps_pace' && totalSec > 0 && (
        <div className="grid grid-cols-2 gap-x-4 gap-y-0.5 mb-3 border-t border-gray-800 pt-3">
          {PACE_ZONE_DEFS.map((z, i) => (
            <div key={i} className="flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: z.color }} />
              <span className="text-gray-500 text-[9px]">{z.label}</span>
              <span className="text-gray-600 text-[9px] ml-auto">{paceRangeLabels[i]}</span>
            </div>
          ))}
        </div>
      )}

      {/* Athlete Intelligence — pace insight */}
      {(paceInsight || paceInsightLoading) && (
        <div className={totalSec > 0 ? 'pt-4 border-t border-gray-800' : ''}>
          <div className="flex items-center gap-2 mb-2">
            <div className="w-5 h-5 bg-orange-500 rounded-full flex items-center justify-center text-[10px] font-bold text-white shrink-0">A</div>
            <p className="text-orange-400 text-[10px] font-bold uppercase tracking-wider">Athlete Intelligence</p>
          </div>
          {paceInsightLoading && !paceInsight ? (
            <div className="flex items-center gap-2 text-gray-500 text-xs">
              <span className="w-3 h-3 border border-orange-400 border-t-transparent rounded-full animate-spin" />
              Analysing effort...
            </div>
          ) : paceInsight ? (
            <p className="text-gray-200 text-sm leading-relaxed">{paceInsight}</p>
          ) : null}
        </div>
      )}
    </div>
  )
}

// ─── Treadmill Segments Display ───────────────────────────────────────────────

function inclineColor(pct: number | null): string {
  if (pct == null) return '#374151'
  if (pct === 0) return '#3b82f6'
  if (pct <= 0.5) return '#22c55e'
  if (pct <= 1) return '#84cc16'
  if (pct <= 2) return '#f97316'
  return '#ef4444'
}

function TreadmillDetailsCard({ segments, notes, editedAt, onEdit }: {
  segments: TreadmillSegment[]
  notes: string | null
  editedAt: string | null
  onEdit: () => void
}) {
  if (segments.length === 0) return null
  const totalMin = segments[segments.length - 1]?.end_min ?? 0
  const fmtDate = editedAt ? new Date(editedAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : null

  return (
    <div className="bg-gray-900 rounded-2xl p-4">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-white font-semibold text-sm">🏃 Treadmill Details</h3>
        <button type="button" onClick={onEdit} className="text-[10px] text-gray-500 hover:text-gray-300 underline">Edit</button>
      </div>
      {notes && <p className="text-gray-400 text-xs mb-3 leading-relaxed">{notes}</p>}

      {/* Timeline bar */}
      <div className="mb-4">
        <div className="flex rounded-lg overflow-hidden h-8 gap-px">
          {segments.map((seg, i) => {
            const pct = totalMin > 0 ? ((seg.end_min - seg.start_min) / totalMin) * 100 : 0
            return (
              <div key={i} className="flex items-center justify-center text-[9px] font-bold text-white relative"
                style={{ width: `${pct}%`, background: inclineColor(seg.incline_pct), minWidth: 24 }}>
                {seg.incline_pct != null ? `${seg.incline_pct}%` : '?'}
              </div>
            )
          })}
        </div>
        <div className="flex justify-between text-gray-600 text-[9px] mt-1">
          <span>0 min</span>
          <span>{totalMin} min</span>
        </div>
      </div>

      {/* Segment rows */}
      <div className="space-y-2">
        {segments.map((seg, i) => (
          <div key={i} className="flex items-center gap-3">
            <div className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: inclineColor(seg.incline_pct) }} />
            <span className="text-gray-400 text-xs w-24 shrink-0">{seg.start_min}–{seg.end_min} min</span>
            <div className="flex-1 flex gap-3 flex-wrap">
              {seg.incline_pct != null && (
                <span className="text-xs font-semibold" style={{ color: inclineColor(seg.incline_pct) }}>
                  {seg.incline_pct === 0 ? 'Flat (0%)' : `${seg.incline_pct}% incline`}
                </span>
              )}
              {seg.speed_kmh != null && (
                <span className="text-xs text-gray-400">{seg.speed_kmh} km/h</span>
              )}
            </div>
            <span className="text-gray-600 text-[10px] shrink-0">{seg.end_min - seg.start_min}min</span>
          </div>
        ))}
      </div>
      {fmtDate && <p className="text-gray-700 text-[10px] mt-3">Added {fmtDate}</p>}
    </div>
  )
}

// ─── Treadmill Edit Modal ─────────────────────────────────────────────────────

function TreadmillEditModal({ activity, onSaved, onDismiss }: {
  activity: GarminActivity
  onSaved: (segments: TreadmillSegment[], notes: string) => void
  onDismiss: () => void
}) {
  const [text, setText] = useState(activity.user_activity_notes ?? '')
  const [parsing, setParsing] = useState(false)
  const [preview, setPreview] = useState<{ segments: TreadmillSegment[]; notes: string; confidence: string } | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const durationMin = activity.duration_sec ? Math.round(activity.duration_sec / 60) : null
  const isEdit = !!activity.user_edited_at

  const handleParse = async () => {
    if (!text.trim()) return
    setParsing(true); setError(null); setPreview(null)
    try {
      const res = await fetch('/api/activities/edit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ activityId: activity.id, userText: text, durationMin, confirmSave: false }),
      })
      const data = await res.json() as { segments?: TreadmillSegment[]; notes?: string; confidence?: string; error?: string }
      if (!res.ok || data.error) throw new Error(data.error ?? 'Parse failed')
      setPreview({ segments: data.segments!, notes: data.notes!, confidence: data.confidence! })
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Something went wrong')
    } finally {
      setParsing(false)
    }
  }

  const handleSave = async () => {
    if (!preview) return
    setSaving(true); setError(null)
    try {
      const res = await fetch('/api/activities/edit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ activityId: activity.id, userText: text, durationMin, confirmSave: true }),
      })
      const data = await res.json() as { error?: string }
      if (!res.ok || data.error) throw new Error(data.error ?? 'Save failed')
      onSaved(preview.segments, preview.notes)
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Save failed')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center px-4"
      style={{ background: 'rgba(0,0,0,0.88)' }}
      onClick={e => { if (e.target === e.currentTarget) onDismiss() }}>
      <div className="w-full max-w-md rounded-3xl overflow-y-auto"
        style={{ background: '#111827', border: '1px solid #374151', maxHeight: '92vh' }}>

        {/* Header */}
        <div className="flex items-center justify-between px-5 pt-5 pb-4 border-b border-gray-800">
          <div>
            <p className="text-orange-400 text-xs font-bold tracking-widest">🏃 TREADMILL DETAILS</p>
            <p className="text-white font-semibold text-sm mt-0.5">
              {isEdit ? 'Update your session notes' : 'Garmin missed this — add it now'}
            </p>
          </div>
          <button type="button" onClick={onDismiss}
            className="w-8 h-8 rounded-full flex items-center justify-center text-gray-400 hover:text-white hover:bg-gray-800 transition-colors">
            ✕
          </button>
        </div>

        <div className="px-5 py-4">
          {!preview ? (
            <>
              <p className="text-gray-400 text-xs mb-3 leading-relaxed">
                Describe your session in plain English. Include incline %, speed, and time splits — the AI will structure it for you.
              </p>
              <div className="rounded-xl px-3 py-2 mb-3 text-[11px] text-gray-500" style={{ background: '#1a2236' }}>
                e.g. &quot;First 20 mins at 1% incline at 9km/h, then 20 mins flat at 10km/h&quot;
              </div>
              <textarea
                value={text}
                onChange={e => setText(e.target.value)}
                placeholder="Describe what you did..."
                rows={4}
                autoFocus
                className="w-full bg-gray-800 text-white text-sm rounded-xl px-4 py-3 resize-none outline-none placeholder-gray-600 focus:ring-1 focus:ring-orange-500 mb-3"
              />
              {error && <p className="text-red-400 text-xs mb-3">{error}</p>}
              <div className="flex gap-2">
                <button type="button" onClick={onDismiss}
                  className="flex-1 py-3 rounded-xl text-sm font-semibold text-gray-400 transition-colors"
                  style={{ background: '#1f2937' }}>
                  Skip for now
                </button>
                <button type="button" onClick={handleParse} disabled={!text.trim() || parsing}
                  className="flex-1 py-3 rounded-xl text-sm font-bold text-white disabled:opacity-40 transition-colors"
                  style={{ background: '#f97316' }}>
                  {parsing ? '⏳ Reading...' : 'Parse with AI →'}
                </button>
              </div>
            </>
          ) : (
            <>
              <p className="text-xs font-semibold mb-3" style={{ color: preview.confidence === 'low' ? '#f97316' : '#22c55e' }}>
                {preview.confidence === 'low' ? '⚠ Low confidence — please check below' : '✓ AI understood your session'}
              </p>

              {/* Preview timeline bar */}
              {preview.segments.length > 0 && (() => {
                const total = Math.max(preview.segments[preview.segments.length - 1]?.end_min ?? 1, 1)
                return (
                  <>
                    <div className="flex rounded-xl overflow-hidden h-9 gap-px mb-3">
                      {preview.segments.map((seg, i) => {
                        const w = ((seg.end_min - seg.start_min) / total) * 100
                        return (
                          <div key={i} className="flex flex-col items-center justify-center text-[9px] font-bold text-white px-1"
                            style={{ width: `${w}%`, background: inclineColor(seg.incline_pct), minWidth: 28 }}>
                            <span>{seg.incline_pct != null ? `${seg.incline_pct}%` : '?'}</span>
                            <span className="text-[8px] opacity-75">{seg.end_min - seg.start_min}m</span>
                          </div>
                        )
                      })}
                    </div>
                    <div className="space-y-2 mb-3">
                      {preview.segments.map((seg, i) => (
                        <div key={i} className="flex items-center gap-2 text-xs bg-gray-800 rounded-xl px-3 py-2">
                          <div className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: inclineColor(seg.incline_pct) }} />
                          <span className="text-gray-400 w-16 shrink-0">{seg.start_min}–{seg.end_min} min</span>
                          <span className="text-white font-medium">
                            {seg.incline_pct != null ? (seg.incline_pct === 0 ? 'Flat (0%)' : `${seg.incline_pct}% incline`) : 'Unknown incline'}
                          </span>
                          {seg.speed_kmh != null && <span className="text-gray-400 ml-auto">{seg.speed_kmh} km/h</span>}
                        </div>
                      ))}
                    </div>
                  </>
                )
              })()}

              <p className="text-gray-500 text-xs mb-4 italic leading-relaxed">&ldquo;{preview.notes}&rdquo;</p>
              {error && <p className="text-red-400 text-xs mb-3">{error}</p>}
              <div className="flex gap-2">
                <button type="button" onClick={() => setPreview(null)}
                  className="flex-1 py-3 rounded-xl text-sm font-semibold text-gray-400"
                  style={{ background: '#1f2937' }}>
                  ← Try again
                </button>
                <button type="button" onClick={handleSave} disabled={saving}
                  className="flex-1 py-3 rounded-xl text-sm font-bold text-white disabled:opacity-40"
                  style={{ background: '#1d4ed8' }}>
                  {saving ? 'Saving…' : '✓ Save & Update AI'}
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}

// ─── Exercise Sets Card ────────────────────────────────────────────────────────

function ExerciseSetsCard({ sets }: { sets: ExerciseSet[] }) {
  if (sets.length === 0) return null

  // Group by exercise name
  const order: string[] = []
  const grouped: Record<string, ExerciseSet[]> = {}
  for (const s of sets) {
    const name = (s.exercise_name ?? s.category ?? 'Unknown').replace(/_/g, ' ')
    if (!grouped[name]) { grouped[name] = []; order.push(name) }
    grouped[name].push(s)
  }

  return (
    <div className="bg-gray-900 rounded-2xl p-4">
      <h3 className="text-white font-semibold text-sm mb-4">💪 Exercise Sets</h3>
      <div className="space-y-5">
        {order.map(name => {
          const exSets = grouped[name]
          const activeSets = exSets.filter(s => !s.set_type || s.set_type.toUpperCase() === 'ACTIVE' || s.set_type.toUpperCase() === 'NORMAL')
          const totalVol = activeSets.reduce((t, s) => t + (s.reps ?? 0) * (s.weight_kg ?? 0), 0)
          return (
            <div key={name}>
              <div className="flex items-center justify-between mb-2">
                <p className="text-gray-200 text-sm font-semibold capitalize">{name.toLowerCase()}</p>
                {totalVol > 0 && (
                  <p className="text-[10px] text-gray-500">vol: {totalVol.toFixed(0)} kg</p>
                )}
              </div>
              <div className="space-y-1">
                {exSets.map((s, i) => {
                  const isRest = s.set_type?.toUpperCase() === 'REST'
                  if (isRest) return null
                  return (
                    <div key={i} className="flex items-center gap-2 text-xs bg-gray-800/60 rounded-lg px-3 py-2">
                      <span className="text-gray-500 w-12 shrink-0">Set {i + 1}</span>
                      {s.reps != null && (
                        <span className="text-white font-semibold">{s.reps} reps</span>
                      )}
                      {s.weight_kg != null && s.weight_kg > 0 && (
                        <span className="text-gray-300">@ {s.weight_kg.toFixed(1)} kg</span>
                      )}
                      {s.duration_sec != null && s.reps == null && (
                        <span className="text-gray-400">{s.duration_sec}s</span>
                      )}
                      {s.reps != null && s.weight_kg != null && s.weight_kg > 0 && (
                        <span className="text-gray-600 ml-auto">{(s.reps * s.weight_kg).toFixed(0)} kg vol</span>
                      )}
                    </div>
                  )
                })}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function ActivityDetailPage() {
  const router = useRouter()
  const params = useParams()
  const id = params.id as string

  const [activity, setActivity] = useState<GarminActivity | null>(null)
  const [loading, setLoading] = useState(true)
  const [analysis, setAnalysis] = useState<{ headline: string; body: string } | null>(null)
  const [analysisLoading, setAnalysisLoading] = useState(false)
  const [analysisError, setAnalysisError] = useState<string | null>(null)
  const [analysisExpanded, setAnalysisExpanded] = useState(false)
  const [analysisGeneratedAt, setAnalysisGeneratedAt] = useState<string | null>(null)
  const [recentActivities, setRecentActivities] = useState<Record<string, unknown>[]>([])
  const [treadmillSegments, setTreadmillSegments] = useState<TreadmillSegment[] | null>(null)
  const [treadmillNotes, setTreadmillNotes] = useState<string | null>(null)
  const [editModalOpen, setEditModalOpen] = useState(false)
  const [paceInsight, setPaceInsight] = useState<string | null>(null)
  const [hrInsight, setHrInsight] = useState<string | null>(null)
  const [exerciseSets, setExerciseSets] = useState<ExerciseSet[]>([])
  const [racePredictions, setRacePredictions] = useState<Record<string, unknown>[] | null>(null)

  useEffect(() => {
    const load = async () => {
      const { data: session } = await supabase.auth.getSession()
      if (!session.session) { router.push('/login'); return }

      const { data } = await supabase
        .from('garmin_activities')
        .select('id, activity_type, start_time, duration_sec, distance_m, calories, avg_hr, max_hr, training_effect, raw_payload, treadmill_segments, user_activity_notes, user_edited_at, ai_activity_summary')
        .eq('id', id)
        .eq('user_id', session.session.user.id)
        .single()

      if (!data) { router.push('/activities'); return }
      const act = data as GarminActivity
      setActivity(act)
      if (act.treadmill_segments) setTreadmillSegments(act.treadmill_segments)
      if (act.ai_activity_summary) setTreadmillNotes(act.ai_activity_summary)

      // Fetch exercise sets (for strength activities — table may not exist yet, fail gracefully)
      const { data: setsData } = await supabase
        .from('garmin_exercise_sets')
        .select('set_order, exercise_name, category, weight_kg, reps, duration_sec, set_type')
        .eq('user_id', session.session.user.id)
        .eq('activity_id', id)
        .order('set_order', { ascending: true })
      if (setsData && setsData.length > 0) setExerciseSets(setsData as ExerciseSet[])

      // Fetch race predictions from profile (used for pace zone boundaries)
      const { data: profileData } = await supabase
        .from('profiles')
        .select('race_predictions')
        .eq('user_id', session.session.user.id)
        .single()
      if (profileData?.race_predictions) {
        const preds = Array.isArray(profileData.race_predictions)
          ? profileData.race_predictions
          : (profileData.race_predictions as Record<string, unknown>).racePredictions
        if (Array.isArray(preds)) setRacePredictions(preds as Record<string, unknown>[])
      }

      // Fetch recent activities of same type for comparison (last 20, excluding this one)
      const thirtyDaysAgo = new Date(Date.now() - 30 * 86400000).toISOString()
      const { data: recent } = await supabase
        .from('garmin_activities')
        .select('duration_sec, distance_m, avg_hr, calories, raw_payload, start_time')
        .eq('user_id', session.session.user.id)
        .neq('id', id)
        .gte('start_time', thirtyDaysAgo)
        .order('start_time', { ascending: false })
        .limit(20)
      setRecentActivities((recent ?? []) as Record<string, unknown>[])

      setLoading(false)
    }
    load()
  }, [id, router])

  const localDateStr = (d: Date) => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`

  const isTreadmillActivity = (act: GarminActivity) => {
    const raw = act.raw_payload ?? {}
    const rawTypeKey = ((raw.activityType as Record<string, unknown> | undefined)?.typeKey as string | undefined ?? '').toLowerCase()
    const legacyType = (act.activity_type ?? '').toLowerCase()
    return rawTypeKey.includes('treadmill') || rawTypeKey.includes('indoor_run') ||
           legacyType.includes('treadmill') || legacyType.includes('indoor_run') ||
           (raw.activityName as string | undefined ?? '').toLowerCase().includes('treadmill')
  }

  const runAnalysis = (act: GarminActivity, recent: Record<string, unknown>[], segs: TreadmillSegment[] | null) => {
    setAnalysisLoading(true)
    setAnalysisError(null)
    fetch('/api/coach/activity', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ activity: act, recentActivities: recent, treadmillSegments: segs }),
    })
      .then(r => r.json())
      .then(d => {
        if (d.error) setAnalysisError(d.error)
        else {
          setAnalysis({ headline: d.headline ?? '', body: d.analysis ?? '' })
          if (d.paceInsight) setPaceInsight(d.paceInsight)
          if (d.hrInsight) setHrInsight(d.hrInsight)
          setAnalysisGeneratedAt(new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }))
        }
      })
      .catch(e => setAnalysisError(e instanceof Error ? e.message : 'Analysis failed'))
      .finally(() => setAnalysisLoading(false))
  }

  // Run analysis on load (after both activity + recent activities are ready)
  useEffect(() => {
    if (!activity) return
    runAnalysis(activity, recentActivities, treadmillSegments)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activity, recentActivities])

  // Auto-open edit modal for treadmill activities completed today that haven't been edited
  useEffect(() => {
    if (!activity) return
    const isToday = localDateStr(new Date(activity.start_time)) === localDateStr(new Date())
    if (isTreadmillActivity(activity) && isToday && !activity.user_edited_at) {
      setEditModalOpen(true)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activity])

  if (loading || !activity) {
    return (
      <main className="min-h-screen bg-gray-950 flex items-center justify-center pb-16">
        <p className="text-gray-400">Loading activity...</p>
        <BottomNav />
      </main>
    )
  }

  const raw = activity.raw_payload ?? {}
  const rawName = raw.activityName as string | undefined
  const rawTypeKey = (raw.activityType as Record<string, unknown> | undefined)?.typeKey as string | undefined

  const isTreadmill = isTreadmillActivity(activity)
  const type = rawTypeKey ? rawTypeKey.replace(/_/g, ' ') : cleanType(activity.activity_type)
  const title = rawName ?? `${timeOfDay(new Date(activity.start_time))} ${type}`
  const emoji = activityEmoji(type)
  const location = raw.locationName as string | undefined

  const date = new Date(activity.start_time)
  const dateStr = date.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })
  const timeStr = date.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })

  const avgSpeed = raw.averageSpeed as number | undefined
  const aerobicTE = raw.aerobicTrainingEffect as number | undefined
  const anaerobicTE = raw.anaerobicTrainingEffect as number | undefined
  const steps = raw.steps as number | undefined

  // Primary stats grid
  const stats: { label: string; value: string; highlight?: boolean }[] = [
    activity.duration_sec ? { label: 'Duration', value: formatDuration(activity.duration_sec) } : null,
    activity.distance_m && activity.distance_m > 100 ? { label: 'Distance', value: formatDistance(activity.distance_m) } : null,
    avgSpeed && activity.distance_m && activity.distance_m > 100 ? { label: 'Avg Pace', value: formatPace(avgSpeed), highlight: true } : null,
    // Avg HR / Max HR shown in dedicated HRCard above — skip here to avoid duplication
    activity.calories ? { label: 'Calories', value: `${Math.round(activity.calories)} kcal` } : null,
    steps && steps > 20 ? { label: 'Steps', value: steps.toLocaleString() } : null,
  ].filter(Boolean) as { label: string; value: string; highlight?: boolean }[]

  return (
    <main className="min-h-screen bg-gray-950 p-4 md:p-8 pb-32">
      <div className="mx-auto max-w-2xl space-y-4">

        {/* Back */}
        <a href="/activities" className="text-gray-500 text-sm hover:text-gray-300">← Activities</a>

        {/* Header */}
        <div className="bg-gray-900 rounded-2xl p-5">
          <div className="flex items-start gap-3">
            <span className="text-4xl mt-1 shrink-0">{emoji}</span>
            <div className="flex-1 min-w-0">
              <h1 className="text-white font-bold text-xl leading-snug">{title}</h1>
              <p className="text-gray-400 text-sm mt-1">{dateStr} · {timeStr}</p>
              {location && <p className="text-gray-500 text-xs mt-0.5">📍 {location}</p>}
            </div>
          </div>
        </div>

        {/* Athlete Intelligence — collapsed headline, expandable full analysis */}
        <div className="bg-gray-900 rounded-2xl overflow-hidden">
          <button
            type="button"
            className="w-full text-left"
            onClick={() => {
              if (analysis) setAnalysisExpanded(e => !e)
            }}
          >
            <div className="flex items-center justify-between px-4 pt-4 pb-3">
              <div className="flex items-center gap-2">
                <div className="w-6 h-6 bg-orange-500 rounded-full flex items-center justify-center text-xs font-bold text-white shrink-0">A</div>
                <p className="text-orange-400 text-xs font-bold uppercase tracking-wider">Athlete Intelligence</p>
                {analysisGeneratedAt && (
                  <span className="text-[10px] text-gray-600">{analysisGeneratedAt}</span>
                )}
              </div>
              {analysis && (
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}
                  className={`w-4 h-4 text-gray-500 transition-transform ${analysisExpanded ? 'rotate-180' : ''}`}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                </svg>
              )}
            </div>
            <div className="px-4 pb-4">
              {analysisLoading && (
                <div className="flex items-center gap-2 text-gray-400 text-sm">
                  <span className="w-4 h-4 border border-orange-400 border-t-transparent rounded-full animate-spin" />
                  Analysing your session...
                </div>
              )}
              {analysisError && <p className="text-red-400 text-sm">{analysisError}</p>}
              {analysis && !analysisExpanded && (
                <p className="text-white font-semibold text-sm leading-snug">{analysis.headline}</p>
              )}
              {analysis && analysisExpanded && (
                <div className="space-y-3">
                  <p className="text-white font-bold text-base leading-snug">{analysis.headline}</p>
                  {analysis.body.split('\n').filter(l => l.trim()).map((para, i) => (
                    <p key={i} className="text-gray-300 text-sm leading-relaxed">
                      {para.replace(/\*\*(.*?)\*\*/g, '$1')}
                    </p>
                  ))}
                </div>
              )}
              {analysis && (
                <p className="text-[10px] text-gray-600 mt-2">
                  {analysisExpanded ? 'Tap to collapse' : 'Tap to read full analysis'}
                </p>
              )}
            </div>
          </button>
        </div>

        {/* Heart Rate chart + AI HR insight */}
        <HRCard activity={activity} raw={raw} hrInsight={hrInsight} hrInsightLoading={analysisLoading} />

        {/* Pace Zones + Athlete Intelligence pace insight */}
        <PaceZonesCard activity={activity} raw={raw} treadmillSegments={treadmillSegments} paceInsight={paceInsight} paceInsightLoading={analysisLoading} racePredictions={racePredictions} />

        {/* Primary stats */}
        {stats.length > 0 && (
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
            {stats.map(s => <Stat key={s.label} label={s.label} value={s.value} highlight={s.highlight} />)}
          </div>
        )}

        {/* Relative effort bar */}
        <RelativeEffort raw={raw} />

        {/* Training effect gauges */}
        <TrainingEffectGauge aerobic={aerobicTE} anaerobic={anaerobicTE} />

        {/* HR Zone donut + breakdown */}
        <HrZones raw={raw} />

        {/* Exercise Sets (strength activities) */}
        {exerciseSets.length > 0 && <ExerciseSetsCard sets={exerciseSets} />}

        {/* Performance stats (pace, cadence, VO2) */}
        <EffortSummary activity={activity} raw={raw} />

        {/* Treadmill details card — shows saved segments */}
        {treadmillSegments && treadmillSegments.length > 0 && (
          <TreadmillDetailsCard
            segments={treadmillSegments}
            notes={treadmillNotes}
            editedAt={activity.user_edited_at}
            onEdit={() => setEditModalOpen(true)}
          />
        )}

        {/* Re-open edit for treadmill activities with no segments yet */}
        {isTreadmill && !treadmillSegments && (
          <button type="button" onClick={() => setEditModalOpen(true)}
            className="w-full py-3 rounded-2xl text-sm font-semibold text-orange-400 border border-orange-400/30 hover:bg-orange-400/10 transition-colors">
            🏃 Add treadmill details (incline / speed)
          </button>
        )}

      </div>

      {/* Treadmill edit modal — auto-opens for today's treadmill run */}
      {editModalOpen && (
        <TreadmillEditModal
          activity={activity}
          onDismiss={() => setEditModalOpen(false)}
          onSaved={(segs, notes) => {
            setTreadmillSegments(segs)
            setTreadmillNotes(notes)
            setEditModalOpen(false)
            // Re-run AI analysis with the new treadmill data
            runAnalysis(activity, recentActivities, segs)
          }}
        />
      )}

      <BottomNav />
    </main>
  )
}

'use client'

import { useEffect, useState, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '../../lib/supabase'
import { BottomNav } from '../../components/BottomNav'

type TimeRange = 'week' | 'month' | 'year'
type HistoryTab = 'treadmill' | 'steps' | 'strength'
type TreadmillMetric = 'pace' | 'duration' | 'distance' | 'hr'

type TreadmillPoint = { date: string; paceMinPerKm: number; distanceKm: number; avgHr: number | null }
type StepsPoint = { date: string; steps: number }
type StrengthPoint = { date: string; durationMin: number; calories: number | null }

function localDateStr(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function daysAgo(n: number) {
  return localDateStr(new Date(Date.now() - n * 86400000))
}

function formatDate(dateStr: string, range: TimeRange) {
  const d = new Date(dateStr + 'T00:00:00')
  if (range === 'week') return d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric' })
  if (range === 'month') return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
}

function fmtPace(minPerKm: number) {
  const m = Math.floor(minPerKm)
  const s = Math.round((minPerKm - m) * 60)
  return `${m}:${String(s).padStart(2, '0')}`
}

function fmtDuration(min: number) {
  if (min >= 60) {
    const h = Math.floor(min / 60)
    const m = Math.round(min % 60)
    return `${h}h${m > 0 ? ` ${m}m` : ''}`
  }
  return `${Math.round(min)}m`
}

// Generic SVG line chart with filled area
function LineChart({
  data,
  color,
  yLabel,
  formatY,
  formatX,
  invertY = false,
}: {
  data: { x: string; y: number }[]
  color: string
  yLabel: string
  formatY: (v: number) => string
  formatX: (s: string) => string
  invertY?: boolean
}) {
  if (data.length === 0) {
    return (
      <div className="flex items-center justify-center h-40 text-gray-500 text-sm">
        No data available for this period
      </div>
    )
  }

  const W = 300, H = 120, padL = 36, padR = 8, padT = 12, padB = 28
  const ys = data.map(d => d.y)
  const rawMin = Math.min(...ys)
  const rawMax = Math.max(...ys)
  const yMin = rawMin === rawMax ? rawMin * 0.9 : rawMin - (rawMax - rawMin) * 0.1
  const yMax = rawMin === rawMax ? rawMax * 1.1 : rawMax + (rawMax - rawMin) * 0.1
  const chartW = W - padL - padR
  const chartH = H - padT - padB

  const xS = (i: number) => padL + (data.length === 1 ? chartW / 2 : (i / (data.length - 1)) * chartW)
  const yS = (v: number) => {
    const norm = (v - yMin) / (yMax - yMin || 1)
    return padT + chartH - (invertY ? (1 - norm) : norm) * chartH
  }

  const pts = data.map((d, i) => `${xS(i).toFixed(1)},${yS(d.y).toFixed(1)}`).join(' ')
  const pathD = data.map((d, i) => `${i === 0 ? 'M' : 'L'}${xS(i).toFixed(1)},${yS(d.y).toFixed(1)}`).join(' ')
  const areaD = data.length > 1
    ? `${pathD} L${xS(data.length - 1).toFixed(1)},${(padT + chartH).toFixed(1)} L${padL},${(padT + chartH).toFixed(1)} Z`
    : ''

  // Y axis labels (3 levels)
  const yTicks = [yMin, (yMin + yMax) / 2, yMax].map(v => ({ v, y: yS(v) }))

  // X axis: show at most 6 labels evenly spaced
  const xStep = Math.max(1, Math.ceil(data.length / 6))
  const xLabels = data.filter((_, i) => i % xStep === 0 || i === data.length - 1).map((d, _, arr) => {
    const origIdx = data.indexOf(d)
    return { label: formatX(d.x), x: xS(origIdx) }
  })

  const gradId = `lg-${color.replace('#', '')}`

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full">
      <defs>
        <linearGradient id={gradId} x1="0%" y1="0%" x2="0%" y2="100%">
          <stop offset="0%" stopColor={color} stopOpacity="0.20" />
          <stop offset="100%" stopColor={color} stopOpacity="0.02" />
        </linearGradient>
      </defs>

      {/* Grid lines */}
      {yTicks.map(({ v, y }) => (
        <g key={v}>
          <line x1={padL} y1={y} x2={W - padR} y2={y} stroke="#374151" strokeWidth={0.5} />
          <text x={padL - 3} y={y + 3.5} textAnchor="end" fontSize="8" fill="#6b7280">{formatY(v)}</text>
        </g>
      ))}

      {/* Area fill */}
      {areaD && <path d={areaD} fill={`url(#${gradId})`} />}

      {/* Line */}
      {data.length > 1 && (
        <path d={pathD} fill="none" stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
      )}

      {/* Dots */}
      {data.map((d, i) => (
        <circle key={i} cx={xS(i)} cy={yS(d.y)} r={data.length <= 14 ? 3 : 2} fill={color} />
      ))}

      {/* X labels */}
      {xLabels.map(({ label, x }, i) => (
        <text key={i} x={x} y={H - 4} textAnchor="middle" fontSize="8" fill="#6b7280">{label}</text>
      ))}

      {/* Y axis label */}
      <text x={4} y={padT + chartH / 2} textAnchor="middle" fontSize="8" fill="#9ca3af"
        transform={`rotate(-90, 4, ${padT + chartH / 2})`}>{yLabel}</text>
    </svg>
  )
}

export default function HistoryPage() {
  const router = useRouter()
  const [loading, setLoading] = useState(true)
  const [tab, setTab] = useState<HistoryTab>('treadmill')
  const [range, setRange] = useState<TimeRange>('month')
  const [treadmillMetric, setTreadmillMetric] = useState<TreadmillMetric>('pace')

  const [treadmillData, setTreadmillData] = useState<TreadmillPoint[]>([])
  const [stepsData, setStepsData] = useState<StepsPoint[]>([])
  const [strengthData, setStrengthData] = useState<StrengthPoint[]>([])

  const loadData = useCallback(async () => {
    const { data: sessionData } = await supabase.auth.getSession()
    const user = sessionData.session?.user
    if (!user) { router.push('/login'); return }
    const uid = user.id
    const days365 = daysAgo(365)

    const [treadRes, stepsRes, strengthRes] = await Promise.all([
      supabase
        .from('garmin_activities')
        .select('start_time, duration_sec, distance_m, avg_hr')
        .eq('user_id', uid)
        .or('activity_type.ilike.%treadmill%,activity_type.ilike.%running%')
        .gte('start_time', days365 + 'T00:00:00')
        .order('start_time', { ascending: true }),
      supabase
        .from('garmin_daily_steps')
        .select('step_date, total_steps')
        .eq('user_id', uid)
        .gte('step_date', days365)
        .order('step_date', { ascending: true }),
      supabase
        .from('garmin_activities')
        .select('start_time, duration_sec, calories, activity_type')
        .eq('user_id', uid)
        .or('activity_type.ilike.%strength%,activity_type.ilike.%fitness%')
        .gte('start_time', days365 + 'T00:00:00')
        .order('start_time', { ascending: true }),
    ])

    // Treadmill: compute pace min/km
    const treadmill: TreadmillPoint[] = (treadRes.data ?? [])
      .filter(r => {
        const d = r.distance_m as number | null
        const dur = r.duration_sec as number | null
        return d != null && d > 100 && dur != null && dur > 60
      })
      .map(r => {
        const distKm = (r.distance_m as number) / 1000
        const durMin = (r.duration_sec as number) / 60
        const paceMinPerKm = durMin / distKm
        return {
          date: (r.start_time as string).split('T')[0],
          paceMinPerKm,
          distanceKm: distKm,
          avgHr: r.avg_hr as number | null,
        }
      })
    setTreadmillData(treadmill)

    // Steps
    const steps: StepsPoint[] = (stepsRes.data ?? [])
      .filter(r => r.total_steps != null)
      .map(r => ({ date: r.step_date as string, steps: r.total_steps as number }))
    setStepsData(steps)

    // Strength
    const strength: StrengthPoint[] = (strengthRes.data ?? [])
      .filter(r => r.duration_sec != null)
      .map(r => ({
        date: (r.start_time as string).split('T')[0],
        durationMin: Math.round((r.duration_sec as number) / 60),
        calories: r.calories as number | null,
      }))
    setStrengthData(strength)
    setLoading(false)
  }, [router])

  useEffect(() => { loadData() }, [loadData])

  function filterByRange<T extends { date: string }>(arr: T[]): T[] {
    const cutoff = range === 'week' ? daysAgo(7) : range === 'month' ? daysAgo(30) : daysAgo(365)
    return arr.filter(r => r.date >= cutoff)
  }

  const fmtX = (s: string) => formatDate(s, range)

  const treadmillFiltered = filterByRange(treadmillData)
  const stepsFiltered = filterByRange(stepsData)
  const strengthFiltered = filterByRange(strengthData)

  const tabBtn = (key: HistoryTab, label: string) => (
    <button
      type="button"
      onClick={() => setTab(key)}
      className={`flex-1 py-2 text-xs font-semibold rounded-xl transition-colors ${tab === key ? 'bg-indigo-600 text-white' : 'text-gray-400 hover:text-white'}`}
    >
      {label}
    </button>
  )

  const rangeBtn = (key: TimeRange, label: string) => (
    <button
      type="button"
      onClick={() => setRange(key)}
      className={`flex-1 py-1.5 text-xs rounded-lg transition-colors ${range === key ? 'bg-gray-700 text-white' : 'text-gray-500 hover:text-gray-300'}`}
    >
      {label}
    </button>
  )

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-900 flex items-center justify-center">
        <div className="w-8 h-8 border-2 border-gray-600 border-t-indigo-400 rounded-full animate-spin" />
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gray-900 pb-24 text-white">
      <div className="max-w-2xl mx-auto px-4 pt-6">

        {/* Header */}
        <div className="mb-5">
          <p className="text-xs text-gray-500 uppercase tracking-widest mb-1">
            {new Date().toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' })}
          </p>
          <h1 className="text-2xl font-bold">History</h1>
        </div>

        {/* Tab bar */}
        <div className="flex gap-1 bg-gray-800/60 rounded-2xl p-1 mb-4">
          {tabBtn('treadmill', 'Treadmill')}
          {tabBtn('steps', 'Steps')}
          {tabBtn('strength', 'Strength')}
        </div>

        {/* Range bar */}
        <div className="flex gap-1 bg-gray-800/60 border border-gray-700/50 rounded-xl p-1 mb-5">
          {rangeBtn('week', 'Week')}
          {rangeBtn('month', 'Month')}
          {rangeBtn('year', 'Year')}
        </div>

        {/* Treadmill tab */}
        {tab === 'treadmill' && (() => {
          // Metric selector config
          const metrics: { key: TreadmillMetric; label: string; color: string; yLabel: string; invertY: boolean; subtitle: string; formatY: (v: number) => string; getData: (d: TreadmillPoint) => number | null }[] = [
            {
              key: 'pace', label: 'Pace', color: '#6366f1', yLabel: 'min/km', invertY: true,
              subtitle: 'Lower is faster — downward trend means improving',
              formatY: fmtPace,
              getData: d => d.paceMinPerKm,
            },
            {
              key: 'duration', label: 'Duration', color: '#3b82f6', yLabel: 'min', invertY: false,
              subtitle: 'Session duration in minutes',
              formatY: v => `${Math.round(v)}m`,
              getData: d => d.paceMinPerKm * d.distanceKm,
            },
            {
              key: 'distance', label: 'Distance', color: '#22c55e', yLabel: 'km', invertY: false,
              subtitle: 'Distance covered per run in km',
              formatY: v => `${v.toFixed(1)}`,
              getData: d => d.distanceKm,
            },
            {
              key: 'hr', label: 'Avg HR', color: '#ef4444', yLabel: 'bpm', invertY: false,
              subtitle: 'Average heart rate during run',
              formatY: v => `${Math.round(v)}`,
              getData: d => d.avgHr,
            },
          ]
          const cfg = metrics.find(m => m.key === treadmillMetric)!
          const chartPoints = treadmillFiltered
            .map(d => { const y = cfg.getData(d); return y != null ? { x: d.date, y } : null })
            .filter((p): p is { x: string; y: number } => p !== null)

          // Stats
          const paceVals = treadmillFiltered.map(d => d.paceMinPerKm)
          const distVals = treadmillFiltered.map(d => d.distanceKm)
          const durVals = treadmillFiltered.map(d => d.paceMinPerKm * d.distanceKm)
          const hrVals = treadmillFiltered.map(d => d.avgHr).filter((v): v is number => v != null)

          const statsRows: { value: string; label: string; accent?: string }[] = ({
            pace: [
              { value: fmtPace(Math.min(...paceVals)), label: 'Best pace', accent: 'text-indigo-400' },
              { value: fmtPace(paceVals.reduce((s, v) => s + v, 0) / paceVals.length), label: 'Avg pace', accent: 'text-indigo-400' },
              { value: `${distVals.reduce((s, v) => s + v, 0).toFixed(1)} km`, label: 'Total distance', accent: 'text-white' },
            ],
            duration: [
              { value: fmtDuration(Math.max(...durVals)), label: 'Longest run', accent: 'text-blue-400' },
              { value: fmtDuration(durVals.reduce((s, v) => s + v, 0) / durVals.length), label: 'Avg session', accent: 'text-blue-400' },
              { value: fmtDuration(durVals.reduce((s, v) => s + v, 0)), label: 'Total time', accent: 'text-white' },
            ],
            distance: [
              { value: `${Math.max(...distVals).toFixed(2)} km`, label: 'Longest run', accent: 'text-green-400' },
              { value: `${(distVals.reduce((s, v) => s + v, 0) / distVals.length).toFixed(2)} km`, label: 'Avg distance', accent: 'text-green-400' },
              { value: `${distVals.reduce((s, v) => s + v, 0).toFixed(1)} km`, label: 'Total distance', accent: 'text-white' },
            ],
            hr: hrVals.length > 0 ? [
              { value: `${Math.min(...hrVals)} bpm`, label: 'Lowest avg HR', accent: 'text-red-400' },
              { value: `${Math.round(hrVals.reduce((s, v) => s + v, 0) / hrVals.length)} bpm`, label: 'Period avg HR', accent: 'text-red-400' },
              { value: `${hrVals.length}`, label: 'Runs with HR', accent: 'text-white' },
            ] : [],
          } as Record<TreadmillMetric, { value: string; label: string; accent?: string }[]>)[treadmillMetric]

          return (
            <div className="space-y-4">
              {/* Metric selector */}
              <div className="flex gap-1 bg-gray-800/60 border border-gray-700/50 rounded-xl p-1">
                {metrics.map(m => (
                  <button
                    key={m.key}
                    type="button"
                    onClick={() => setTreadmillMetric(m.key)}
                    className={`flex-1 py-1.5 text-xs font-medium rounded-lg transition-colors ${treadmillMetric === m.key ? 'text-white' : 'text-gray-500 hover:text-gray-300'}`}
                    style={treadmillMetric === m.key ? { backgroundColor: cfg.color + '33', color: cfg.color } : {}}
                  >
                    {m.label}
                  </button>
                ))}
              </div>

              {/* Chart card */}
              <div className="rounded-2xl bg-gray-800/60 border border-gray-700/50 p-4">
                <div className="flex items-center justify-between mb-1">
                  <p className="text-sm font-semibold text-white" style={{ color: cfg.color }}>{cfg.label}</p>
                  <p className="text-xs text-gray-500">{treadmillFiltered.length} runs</p>
                </div>
                <p className="text-[10px] text-gray-500 mb-3">{cfg.subtitle}</p>
                <LineChart
                  data={chartPoints}
                  color={cfg.color}
                  yLabel={cfg.yLabel}
                  formatY={cfg.formatY}
                  formatX={fmtX}
                  invertY={cfg.invertY}
                />
              </div>

              {/* Stats */}
              {treadmillFiltered.length > 0 && statsRows && statsRows.length > 0 && (
                <div className={`grid gap-3 grid-cols-${statsRows.length}`}>
                  {statsRows.map((stat, i) => (
                    <div key={i} className="rounded-2xl bg-gray-800/60 border border-gray-700/50 p-3 text-center">
                      <p className={`text-lg font-bold ${stat.accent ?? 'text-white'}`}>{stat.value}</p>
                      <p className="text-[10px] text-gray-500 mt-1">{stat.label}</p>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )
        })()}

        {/* Steps tab */}
        {tab === 'steps' && (
          <div className="space-y-4">
            <div className="rounded-2xl bg-gray-800/60 border border-gray-700/50 p-4">
              <div className="flex items-center justify-between mb-1">
                <p className="text-sm font-semibold text-white">Daily Steps</p>
                <p className="text-xs text-gray-500">{stepsFiltered.length} days</p>
              </div>
              <p className="text-[10px] text-gray-500 mb-3">Goal: 10,000 steps/day</p>
              <LineChart
                data={stepsFiltered.map(d => ({ x: d.date, y: d.steps }))}
                color="#22c55e"
                yLabel="steps"
                formatY={(v) => v >= 1000 ? `${(v / 1000).toFixed(0)}k` : String(Math.round(v))}
                formatX={fmtX}
              />
            </div>

            {stepsFiltered.length > 0 && (
              <div className="grid grid-cols-3 gap-3">
                <div className="rounded-2xl bg-gray-800/60 border border-gray-700/50 p-3 text-center">
                  <p className="text-lg font-bold text-green-400">{(stepsFiltered.reduce((s, d) => s + d.steps, 0) / stepsFiltered.length / 1000).toFixed(1)}k</p>
                  <p className="text-[10px] text-gray-500 mt-1">Daily avg</p>
                </div>
                <div className="rounded-2xl bg-gray-800/60 border border-gray-700/50 p-3 text-center">
                  <p className="text-lg font-bold text-green-400">{(Math.max(...stepsFiltered.map(d => d.steps)) / 1000).toFixed(1)}k</p>
                  <p className="text-[10px] text-gray-500 mt-1">Best day</p>
                </div>
                <div className="rounded-2xl bg-gray-800/60 border border-gray-700/50 p-3 text-center">
                  <p className="text-lg font-bold text-white">{stepsFiltered.filter(d => d.steps >= 10000).length}</p>
                  <p className="text-[10px] text-gray-500 mt-1">10k+ days</p>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Strength tab */}
        {tab === 'strength' && (
          <div className="space-y-4">
            <div className="rounded-2xl bg-gray-800/60 border border-gray-700/50 p-4">
              <div className="flex items-center justify-between mb-1">
                <p className="text-sm font-semibold text-white">Session Duration (min)</p>
                <p className="text-xs text-gray-500">{strengthFiltered.length} sessions</p>
              </div>
              <p className="text-[10px] text-gray-500 mb-3">Strength training and fitness activities</p>
              <LineChart
                data={strengthFiltered.map(d => ({ x: d.date, y: d.durationMin }))}
                color="#f97316"
                yLabel="min"
                formatY={(v) => `${Math.round(v)}m`}
                formatX={fmtX}
              />
            </div>

            {strengthFiltered.length > 0 && (
              <div className="grid grid-cols-3 gap-3">
                <div className="rounded-2xl bg-gray-800/60 border border-gray-700/50 p-3 text-center">
                  <p className="text-lg font-bold text-orange-400">{Math.round(strengthFiltered.reduce((s, d) => s + d.durationMin, 0) / strengthFiltered.length)}m</p>
                  <p className="text-[10px] text-gray-500 mt-1">Avg session</p>
                </div>
                <div className="rounded-2xl bg-gray-800/60 border border-gray-700/50 p-3 text-center">
                  <p className="text-lg font-bold text-orange-400">{Math.max(...strengthFiltered.map(d => d.durationMin))}m</p>
                  <p className="text-[10px] text-gray-500 mt-1">Longest</p>
                </div>
                <div className="rounded-2xl bg-gray-800/60 border border-gray-700/50 p-3 text-center">
                  <p className="text-lg font-bold text-white">{strengthFiltered.length}</p>
                  <p className="text-[10px] text-gray-500 mt-1">Sessions</p>
                </div>
              </div>
            )}
          </div>
        )}

      </div>
      <BottomNav />
    </div>
  )
}

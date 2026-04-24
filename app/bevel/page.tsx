'use client'

import { useEffect, useState, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '../../lib/supabase'
import { BottomNav } from '../../components/BottomNav'

// ─── Types ────────────────────────────────────────────────────────────────────

type DayMetric = {
  date: string
  hrv: number | null
  rhr: number | null
  stress: number | null
  sleep: number | null
  sleepDuration: number | null
  deepSleep: number | null
  load: number
  steps: number | null
  bb: number | null
  spo2: number | null
}

type BevelScores = {
  total: number | null
  heart: number | null
  sleep: number | null
  energy: number | null
  move: number | null
  calm: number | null
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function clamp(v: number, lo: number, hi: number) { return Math.max(lo, Math.min(hi, v)) }
function mean(arr: number[]) { return arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0 }
function localDateStr(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

// ─── Score Engine ─────────────────────────────────────────────────────────────

function calcBevelScores(d: DayMetric): BevelScores {
  // Heart: 60% HRV (normalised 20–120ms) + 40% RHR (inverted 40–80bpm)
  const heart = (() => {
    let s = 0, w = 0
    if (d.hrv != null) { s += clamp((d.hrv - 20) / 100, 0, 1) * 100 * 0.6; w += 0.6 }
    if (d.rhr != null) { s += clamp((80 - d.rhr) / 40, 0, 1) * 100 * 0.4; w += 0.4 }
    return w > 0 ? Math.round(s / w) : null
  })()

  // Sleep: direct sleep score
  const sleep = d.sleep

  // Energy: body battery (direct)
  const energy = d.bb

  // Move: steps as % of 10k goal
  const move = d.steps != null ? Math.round(clamp(d.steps / 10000 * 100, 0, 100)) : null

  // Calm: inverse of stress
  const calm = d.stress != null ? Math.round(100 - d.stress) : null

  // Bevel Score: weighted composite
  let total = 0, weight = 0
  if (heart != null) { total += heart * 0.30; weight += 0.30 }
  if (sleep != null) { total += sleep * 0.25; weight += 0.25 }
  if (energy != null) { total += energy * 0.20; weight += 0.20 }
  if (move != null) { total += move * 0.15; weight += 0.15 }
  if (calm != null) { total += calm * 0.10; weight += 0.10 }

  return {
    total: weight > 0 ? Math.round(total / weight) : null,
    heart, sleep, energy, move, calm,
  }
}

function scoreLabel(v: number | null): { label: string; arrow: string; color: string } {
  if (v == null) return { label: '—', arrow: '·', color: '#4b5563' }
  if (v >= 75) return { label: 'Great', arrow: '↑', color: '#22c55e' }
  if (v >= 55) return { label: 'Good', arrow: '→', color: '#a855f7' }
  if (v >= 35) return { label: 'Fair', arrow: '→', color: '#eab308' }
  return { label: 'Low', arrow: '↓', color: '#ef4444' }
}

function generateInsights(history: DayMetric[], today: DayMetric): string[] {
  const insights: string[] = []

  // HRV vs 28-day baseline
  const pastHRV = history.slice(0, -1).map(d => d.hrv).filter((v): v is number => v != null)
  if (pastHRV.length >= 7 && today.hrv != null) {
    const baseline = mean(pastHRV)
    const pct = Math.round(((today.hrv - baseline) / baseline) * 100)
    if (pct >= 10) {
      insights.push(`HRV is ${pct}% above your ${pastHRV.length}-day average — an ideal day to train hard or think deeply.`)
    } else if (pct <= -10) {
      insights.push(`HRV is ${Math.abs(pct)}% below baseline — your nervous system needs support. Go easy and recover.`)
    } else {
      insights.push(`HRV is within ${Math.abs(pct)}% of your baseline — a steady, average recovery day.`)
    }
  }

  // Sleep trend
  const recentSleep = history.slice(-5).map(d => d.sleep).filter((v): v is number => v != null)
  if (recentSleep.length >= 3) {
    const avg = mean(recentSleep.slice(0, -1))
    const last = recentSleep[recentSleep.length - 1]
    if (last > avg + 7) {
      insights.push(`Sleep quality improved — last night scored ${last}/100, up from a ${Math.round(avg)} average.`)
    } else if (last < avg - 10) {
      insights.push(`Sleep dropped to ${last}/100 vs a recent average of ${Math.round(avg)}. Expect lower output today.`)
    } else if (last >= 75) {
      insights.push(`Solid sleep last night (${last}/100) — recovery processes were efficient during the night.`)
    } else if (last < 60) {
      insights.push(`Sleep quality was below average (${last}/100) — consider your wind-down routine tonight.`)
    }
  }

  // RHR trend
  const rhrHistory = history.slice(-14).map(d => d.rhr).filter((v): v is number => v != null)
  if (rhrHistory.length >= 5 && today.rhr != null) {
    const rhrBaseline = mean(rhrHistory.slice(0, -1))
    if (today.rhr > rhrBaseline + 4) {
      insights.push(`Resting HR is ${Math.round(today.rhr - rhrBaseline)} bpm above your norm — monitor for signs of fatigue or oncoming illness.`)
    } else if (today.rhr <= rhrBaseline - 3) {
      insights.push(`Resting HR is lower than usual — a positive sign of cardiovascular adaptation and good fitness.`)
    }
  }

  // Body battery
  if (today.bb != null && insights.length < 3) {
    if (today.bb >= 80) {
      insights.push(`Body Battery is fully charged at ${today.bb} — you have maximum energy reserves to draw on today.`)
    } else if (today.bb < 25) {
      insights.push(`Body Battery is critically low at ${today.bb} — energy reserves need to rebuild before intense demands.`)
    }
  }

  // Movement
  if (insights.length < 3) {
    const recentSteps = history.slice(-7).map(d => d.steps).filter((v): v is number => v != null)
    if (recentSteps.length >= 4) {
      const avgSteps = Math.round(mean(recentSteps))
      if (avgSteps >= 10000) {
        insights.push(`Averaging ${(avgSteps / 1000).toFixed(1)}k steps per day this week — excellent daily movement consistency.`)
      } else if (avgSteps < 5000) {
        insights.push(`Step count is averaging ${(avgSteps / 1000).toFixed(1)}k/day — adding a 20-min walk would boost your Move score significantly.`)
      }
    }
  }

  return insights.slice(0, 3)
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function BevelPage() {
  const router = useRouter()
  const [loading, setLoading] = useState(true)
  const [history, setHistory] = useState<DayMetric[]>([])

  const loadData = useCallback(async () => {
    const { data: sessionData } = await supabase.auth.getSession()
    const user = sessionData.session?.user
    if (!user) { router.push('/login'); return }

    const userId = user.id
    const ago30 = localDateStr(new Date(Date.now() - 29 * 86400000))

    const [healthRes, legacyRes, sleepRes, stepsRes] = await Promise.all([
      supabase.from('garmin_daily_health_metrics')
        .select('metric_date, hrv_avg, stress_avg, body_battery_end, spo2_avg')
        .eq('user_id', userId).gte('metric_date', ago30)
        .order('metric_date', { ascending: true }),
      supabase.from('daily_health_metrics')
        .select('metric_date, garmin_hrv_nightly_avg, resting_hr, resting_heart_rate_bpm, garmin_stress_avg')
        .eq('user_id', userId).gte('metric_date', ago30)
        .order('metric_date', { ascending: true }),
      supabase.from('garmin_sleep_data')
        .select('sleep_date, sleep_score, sleep_duration_seconds, deep_sleep_seconds')
        .eq('user_id', userId).gte('sleep_date', ago30)
        .order('sleep_date', { ascending: true }),
      supabase.from('garmin_daily_steps')
        .select('step_date, total_steps, active_minutes, moderate_intensity_minutes, vigorous_intensity_minutes')
        .eq('user_id', userId).gte('step_date', ago30)
        .order('step_date', { ascending: true }),
    ])

    const healthMap = new Map((healthRes.data ?? []).map(r => [r.metric_date, r]))
    const legacyMap = new Map((legacyRes.data ?? []).map(r => [r.metric_date, r]))
    const sleepMap = new Map((sleepRes.data ?? []).map(r => [r.sleep_date, r]))
    const stepsMap = new Map((stepsRes.data ?? []).map(r => [r.step_date, r]))

    const days: DayMetric[] = []
    for (let i = 29; i >= 0; i--) {
      const date = localDateStr(new Date(Date.now() - i * 86400000))
      const h = healthMap.get(date)
      const l = legacyMap.get(date)
      const s = sleepMap.get(date)
      const st = stepsMap.get(date)
      const mod = st?.moderate_intensity_minutes ?? null
      const vig = st?.vigorous_intensity_minutes ?? null
      const active = st?.active_minutes ?? null
      const load = mod != null || vig != null ? (mod ?? 0) + (vig ?? 0) * 2 : (active ?? 0) * 0.6
      days.push({
        date,
        hrv: h?.hrv_avg ?? l?.garmin_hrv_nightly_avg ?? null,
        rhr: l?.resting_hr ?? l?.resting_heart_rate_bpm ?? null,
        stress: h?.stress_avg ?? l?.garmin_stress_avg ?? null,
        sleep: s?.sleep_score ?? null,
        sleepDuration: s?.sleep_duration_seconds ?? null,
        deepSleep: s?.deep_sleep_seconds ?? null,
        load,
        steps: st?.total_steps ?? null,
        bb: h?.body_battery_end ?? null,
        spo2: h?.spo2_avg ?? null,
      })
    }

    setHistory(days)
    setLoading(false)
  }, [router])

  useEffect(() => { loadData() }, [loadData])

  if (loading) return (
    <div className="min-h-screen flex items-center justify-center" style={{ background: '#060610' }}>
      <p className="text-purple-400 text-sm animate-pulse font-bold tracking-widest">LOADING...</p>
    </div>
  )

  const today = history[history.length - 1] ?? null
  const scores = today ? calcBevelScores(today) : { total: null, heart: null, sleep: null, energy: null, move: null, calm: null }
  const insights = today ? generateInsights(history, today) : []

  // 30-day Bevel score trend
  const trend = history.map(d => ({ date: d.date, score: calcBevelScores(d).total }))
  const validTrend = trend.filter(d => d.score != null)
  const minS = validTrend.length ? Math.max(0, Math.min(...validTrend.map(d => d.score!)) - 5) : 0
  const maxS = validTrend.length ? Math.min(100, Math.max(...validTrend.map(d => d.score!)) + 5) : 100

  const W = 280, H = 64
  const pts = trend.map((d, i) => ({
    x: (i / 29) * W,
    y: d.score != null ? H - ((d.score - minS) / (maxS - minS)) * H : null,
    score: d.score,
    date: d.date,
  })).filter(p => p.y != null)

  const pathD = pts.length > 1
    ? pts.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x.toFixed(1)},${p.y!.toFixed(1)}`).join(' ')
    : ''
  const areaD = pathD && pts.length > 1
    ? `${pathD} L${pts[pts.length - 1].x.toFixed(1)},${H} L${pts[0].x.toFixed(1)},${H} Z`
    : ''

  // Biomarker calculations
  const hrv28 = (() => {
    const v = history.slice(-28).map(d => d.hrv).filter((v): v is number => v != null)
    return v.length ? Math.round(mean(v)) : null
  })()
  const rhr14 = (() => {
    const v = history.slice(-14).map(d => d.rhr).filter((v): v is number => v != null)
    return v.length ? Math.round(mean(v)) : null
  })()
  const sleep7 = (() => {
    const v = history.slice(-7).map(d => d.sleep).filter((v): v is number => v != null)
    return v.length ? Math.round(mean(v)) : null
  })()
  const steps7 = (() => {
    const v = history.slice(-7).map(d => d.steps).filter((v): v is number => v != null)
    return v.length ? Math.round(mean(v) / 1000 * 10) / 10 : null
  })()

  // Score ring
  const sc = scores.total
  const ringColor = sc == null ? '#4b5563' : sc >= 75 ? '#a855f7' : sc >= 55 ? '#6366f1' : sc >= 35 ? '#eab308' : '#ef4444'
  const cx = 90, cy = 90, R = 72
  const circ = 2 * Math.PI * R

  // Category pillars
  const pillars = [
    { key: 'heart', label: 'Heart', icon: '❤️', value: scores.heart, color: '#f43f5e', desc: 'HRV + RHR' },
    { key: 'sleep', label: 'Sleep', icon: '😴', value: scores.sleep, color: '#818cf8', desc: 'Sleep score' },
    { key: 'energy', label: 'Energy', icon: '⚡', value: scores.energy, color: '#22d3ee', desc: 'Body battery' },
    { key: 'move', label: 'Move', icon: '🏃', value: scores.move, color: '#22c55e', desc: '% of 10k steps' },
    { key: 'calm', label: 'Calm', icon: '🧘', value: scores.calm, color: '#fb923c', desc: '100 − stress' },
  ]

  // Trend arrow vs yesterday
  const yesterdayScore = history.length >= 2 ? calcBevelScores(history[history.length - 2]).total : null
  const trendArrow = sc != null && yesterdayScore != null
    ? sc > yesterdayScore + 3 ? { symbol: '↑', color: '#22c55e' }
    : sc < yesterdayScore - 3 ? { symbol: '↓', color: '#ef4444' }
    : { symbol: '→', color: '#9ca3af' }
    : null

  return (
    <div className="min-h-screen pb-20" style={{ background: '#060610', fontFamily: 'system-ui,sans-serif' }}>
      <div className="max-w-md mx-auto">

      {/* Header */}
      <div className="px-4 pt-6 pb-2">
        <div className="flex items-baseline gap-2 mb-0.5">
          <span className="font-black text-xl tracking-widest"
            style={{ background: 'linear-gradient(90deg,#a855f7,#6366f1)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>
            BEVEL
          </span>
          <span className="text-[10px] text-gray-600 tracking-wider">wellness intelligence</span>
        </div>
        <p className="text-gray-600 text-xs">
          {new Date().toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' })}
        </p>
      </div>

      <div className="px-4 space-y-3">

        {/* Bevel Score ring */}
        <div className="rounded-2xl p-5 flex flex-col items-center"
          style={{ background: '#0d0d1a', border: '1px solid #1a1a2e' }}>
          <p className="text-[10px] font-bold tracking-[0.2em] text-gray-600 mb-2">BEVEL SCORE</p>
          <svg viewBox="0 0 180 180" className="w-44 h-44">
            <defs>
              <filter id="bevelGlow" x="-50%" y="-50%" width="200%" height="200%">
                <feGaussianBlur stdDeviation="5" result="blur" />
                <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
              </filter>
              <linearGradient id="bevelGrad" x1="0%" y1="0%" x2="100%" y2="100%">
                <stop offset="0%" stopColor="#a855f7" />
                <stop offset="100%" stopColor="#6366f1" />
              </linearGradient>
            </defs>
            {/* Track */}
            <circle cx={cx} cy={cy} r={R} fill="none" stroke="#111128" strokeWidth={12} />
            {/* Fill */}
            {sc != null && (
              <circle cx={cx} cy={cy} r={R} fill="none" stroke="url(#bevelGrad)" strokeWidth={12}
                strokeDasharray={`${(sc / 100) * circ} ${circ}`}
                transform={`rotate(-90 ${cx} ${cy})`}
                strokeLinecap="round" filter="url(#bevelGlow)" />
            )}
            {/* Score */}
            <text x={cx} y={cy - 8} textAnchor="middle" fill="white" fontSize="42" fontWeight="900" fontFamily="system-ui">
              {sc ?? '—'}
            </text>
            {trendArrow && (
              <text x={cx} y={cy + 14} textAnchor="middle" fontSize="18" fontWeight="900" fill={trendArrow.color}>
                {trendArrow.symbol}
              </text>
            )}
            <text x={cx} y={cy + (trendArrow ? 30 : 16)} textAnchor="middle" fontSize="8" fill="#4b5563" letterSpacing="2">
              WELLNESS SCORE
            </text>
          </svg>

          {/* Pillar mini bars */}
          <div className="flex gap-2 mt-2 w-full justify-center">
            {pillars.map(p => (
              <div key={p.key} className="flex flex-col items-center gap-1 flex-1 max-w-[44px]">
                <div className="w-full h-1 rounded-full" style={{ background: '#111128' }}>
                  <div className="h-full rounded-full transition-all" style={{
                    width: `${p.value ?? 0}%`,
                    background: p.color,
                  }} />
                </div>
                <span className="text-[7px] text-gray-600">{p.label}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Pillar cards */}
        <div className="grid grid-cols-5 gap-1.5">
          {pillars.map(p => {
            const sl = scoreLabel(p.value)
            return (
              <div key={p.key} className="rounded-xl p-2 flex flex-col items-center gap-0.5"
                style={{ background: '#0d0d1a', border: `1px solid ${p.color}20` }}>
                <span className="text-base">{p.icon}</span>
                <p className="text-sm font-black tabular-nums" style={{ color: p.color }}>{p.value ?? '—'}</p>
                <p className="text-[8px] text-gray-600">{p.label}</p>
                <p className="text-[9px] font-bold" style={{ color: sl.color }}>{sl.arrow} {sl.label}</p>
              </div>
            )
          })}
        </div>

        {/* 30-day trend */}
        <div className="rounded-2xl p-4" style={{ background: '#0d0d1a', border: '1px solid #1a1a2e' }}>
          <div className="flex items-center justify-between mb-3">
            <p className="text-[10px] font-bold tracking-widest text-gray-600">30-DAY TREND</p>
            {validTrend.length > 0 && (
              <span className="text-[10px] text-gray-600">
                avg <strong style={{ color: '#a855f7' }}>{Math.round(mean(validTrend.map(d => d.score!)))}</strong>
              </span>
            )}
          </div>
          {pathD ? (
            <svg viewBox={`0 0 ${W} ${H + 14}`} className="w-full">
              <defs>
                <linearGradient id="areaGrad" x1="0%" y1="0%" x2="0%" y2="100%">
                  <stop offset="0%" stopColor="#a855f7" stopOpacity="0.25" />
                  <stop offset="100%" stopColor="#a855f7" stopOpacity="0" />
                </linearGradient>
              </defs>
              {/* Grid lines */}
              {[25, 50, 75].map(v => {
                const y = H - ((v - minS) / (maxS - minS)) * H
                if (y < 0 || y > H) return null
                return (
                  <g key={v}>
                    <line x1={0} y1={y} x2={W} y2={y} stroke="#1a1a2e" strokeWidth={1} />
                    <text x={0} y={y - 2} fontSize="7" fill="#2d2d4e">{v}</text>
                  </g>
                )
              })}
              {/* Area */}
              {areaD && <path d={areaD} fill="url(#areaGrad)" />}
              {/* Line */}
              <path d={pathD} fill="none" stroke="#a855f7" strokeWidth={1.5}
                strokeLinecap="round" strokeLinejoin="round" />
              {/* Today dot */}
              {pts.length > 0 && (() => {
                const last = pts[pts.length - 1]
                return (
                  <>
                    <circle cx={last.x} cy={last.y!} r={4} fill="#a855f7" />
                    <text x={last.x} y={last.y! - 6} textAnchor="middle" fontSize="8" fill="#a855f7" fontWeight="700">
                      {last.score}
                    </text>
                  </>
                )
              })()}
              <text x={0} y={H + 12} fontSize="7" fill="#374151">30d ago</text>
              <text x={W} y={H + 12} textAnchor="end" fontSize="7" fill="#374151">Today</text>
            </svg>
          ) : (
            <p className="text-gray-600 text-xs text-center py-4">Building your trend — sync daily to fill this in</p>
          )}
        </div>

        {/* Insights */}
        {insights.length > 0 && (
          <div className="rounded-2xl p-4 space-y-3" style={{ background: '#0d0d1a', border: '1px solid #1a1a2e' }}>
            <p className="text-[10px] font-bold tracking-widest text-gray-600">INSIGHTS</p>
            {insights.map((insight, i) => (
              <div key={i} className="flex gap-3 items-start">
                <div className="w-1.5 h-1.5 rounded-full mt-1.5 flex-shrink-0" style={{ background: '#a855f7' }} />
                <p className="text-xs text-gray-300 leading-relaxed">{insight}</p>
              </div>
            ))}
          </div>
        )}

        {/* Biomarkers */}
        <div className="rounded-2xl p-4" style={{ background: '#0d0d1a', border: '1px solid #1a1a2e' }}>
          <p className="text-[10px] font-bold tracking-widest text-gray-600 mb-3">BIOMARKER BASELINES</p>
          <div className="grid grid-cols-2 gap-2">
            {[
              { label: 'HRV 28-day avg', value: hrv28 != null ? `${hrv28} ms` : '—', color: '#a855f7', icon: '💜' },
              { label: 'RHR 14-day avg', value: rhr14 != null ? `${rhr14} bpm` : '—', color: '#f43f5e', icon: '❤️' },
              { label: 'Sleep 7-day avg', value: sleep7 != null ? `${sleep7}/100` : '—', color: '#818cf8', icon: '😴' },
              { label: 'Steps 7-day avg', value: steps7 != null ? `${steps7}k/day` : '—', color: '#22c55e', icon: '🏃' },
            ].map(bm => (
              <div key={bm.label} className="rounded-xl p-3 flex items-center gap-2.5"
                style={{ background: '#060610', border: `1px solid ${bm.color}15` }}>
                <span className="text-lg flex-shrink-0">{bm.icon}</span>
                <div>
                  <p className="text-sm font-bold" style={{ color: bm.color }}>{bm.value}</p>
                  <p className="text-[9px] text-gray-600 mt-0.5">{bm.label}</p>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Pillar weights explainer */}
        <div className="rounded-2xl p-4" style={{ background: '#0d0d1a', border: '1px solid #1a1a2e' }}>
          <p className="text-[10px] font-bold tracking-widest text-gray-600 mb-3">SCORE COMPOSITION</p>
          <div className="space-y-2">
            {[
              { label: 'Heart (HRV + RHR)', pct: 30, color: '#f43f5e', value: scores.heart },
              { label: 'Sleep', pct: 25, color: '#818cf8', value: scores.sleep },
              { label: 'Energy (Body Battery)', pct: 20, color: '#22d3ee', value: scores.energy },
              { label: 'Move (Steps)', pct: 15, color: '#22c55e', value: scores.move },
              { label: 'Calm (Stress)', pct: 10, color: '#fb923c', value: scores.calm },
            ].map(row => (
              <div key={row.label} className="flex items-center gap-2">
                <span className="text-[9px] text-gray-600 w-36 flex-shrink-0">{row.label}</span>
                <div className="flex-1 h-1.5 rounded-full" style={{ background: '#111128' }}>
                  <div className="h-full rounded-full" style={{ width: `${row.value ?? 0}%`, background: row.color }} />
                </div>
                <span className="text-[9px] font-bold w-6 text-right" style={{ color: row.color }}>{row.value ?? '—'}</span>
                <span className="text-[9px] text-gray-700 w-6">{row.pct}%</span>
              </div>
            ))}
          </div>
        </div>

      </div>
      </div>
      <BottomNav />
    </div>
  )
}

'use client'

import { useEffect, useState, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '../../lib/supabase'
import { BottomNav } from '../../components/BottomNav'

// ─── Types ────────────────────────────────────────────────────────────────────

type DayMetric = {
  date: string
  hrv: number | null
  stress: number | null
  sleep: number | null
  load: number
  steps: number | null
  bb: number | null
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function clamp(v: number, lo: number, hi: number) { return Math.max(lo, Math.min(hi, v)) }
function mean(arr: number[]) { return arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0 }
function localDateStr(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

// ─── Score Calculations ───────────────────────────────────────────────────────

function calcRecovery(history: DayMetric[], today: DayMetric) {
  // Baseline = mean of previous days (exclude today)
  const pastHRV = history.slice(0, -1).map(d => d.hrv).filter((v): v is number => v != null)
  if (pastHRV.length < 3 || today.hrv == null) return { score: null, baseline: null, deviation: null }
  const baseline = mean(pastHRV)
  const deviation = ((today.hrv - baseline) / baseline) * 100
  // Map deviation: ±50% range maps to 0–100, centred at 50
  const hrvScore = clamp(50 + deviation * 1.5, 0, 100)
  // Blend in sleep quality: sleep 80 = +6, sleep 40 = -6
  const sleepAdj = today.sleep != null ? (today.sleep - 70) * 0.2 : 0
  return {
    score: Math.round(clamp(hrvScore + sleepAdj, 0, 100)),
    baseline: Math.round(baseline),
    deviation: Math.round(deviation),
  }
}

function calcACWR(history: DayMetric[]) {
  if (history.length < 7) return null
  const sorted = [...history].sort((a, b) => a.date.localeCompare(b.date))
  const acute = sorted.slice(-7).reduce((s, d) => s + d.load, 0)
  const last28 = sorted.slice(-28)
  const chronic = last28.reduce((s, d) => s + d.load, 0) / 4
  if (chronic < 1) return null
  return { acwr: +(acute / chronic).toFixed(2), acute: Math.round(acute), chronicWeekly: Math.round(chronic) }
}

function getRecommendation(recovery: number | null, acwr: number | null) {
  if (recovery == null) return { label: 'NO DATA', emoji: '⏳', color: '#6b7280', bg: '#111827', desc: 'Sync Garmin to see your recommendation.' }
  if (recovery >= 70 && (acwr == null || acwr <= 1.3)) return { label: 'PUSH', emoji: '🟢', color: '#22c55e', bg: '#052e16', desc: 'Recovery is strong and load is in check. Body is primed for high intensity.' }
  if (recovery >= 70 && acwr != null && acwr > 1.3) return { label: 'TRAIN SMART', emoji: '🟡', color: '#eab308', bg: '#1c1a06', desc: 'Good recovery but cumulative load is high. Go moderate — protect the gains.' }
  if (recovery >= 50) return { label: 'MAINTAIN', emoji: '🟡', color: '#eab308', bg: '#1c1a06', desc: 'Decent recovery. A solid session is fine — nothing maximal.' }
  if (recovery >= 30) return { label: 'RECOVER', emoji: '🟠', color: '#f97316', bg: '#1c0a05', desc: 'Sub-optimal recovery. Low intensity or active rest only today.' }
  return { label: 'REST', emoji: '🔴', color: '#ef4444', bg: '#1c0505', desc: 'Recovery score is poor. Sleep, nutrition, and recovery are the priority.' }
}

function recoveryColor(score: number | null) {
  if (score == null) return '#374151'
  if (score >= 70) return '#22c55e'
  if (score >= 50) return '#eab308'
  if (score >= 30) return '#f97316'
  return '#ef4444'
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function AthlyticPage() {
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
        .select('metric_date, hrv_avg, stress_avg, body_battery_end')
        .eq('user_id', userId).gte('metric_date', ago30)
        .order('metric_date', { ascending: true }),
      supabase.from('daily_health_metrics')
        .select('metric_date, garmin_hrv_nightly_avg, garmin_stress_avg')
        .eq('user_id', userId).gte('metric_date', ago30)
        .order('metric_date', { ascending: true }),
      supabase.from('garmin_sleep_data')
        .select('sleep_date, sleep_score')
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
        stress: h?.stress_avg ?? l?.garmin_stress_avg ?? null,
        sleep: s?.sleep_score ?? null,
        load,
        steps: st?.total_steps ?? null,
        bb: h?.body_battery_end ?? null,
      })
    }

    setHistory(days)
    setLoading(false)
  }, [router])

  useEffect(() => { loadData() }, [loadData])

  if (loading) return (
    <div className="min-h-screen flex items-center justify-center" style={{ background: '#050505' }}>
      <p className="text-[#22c55e] text-sm animate-pulse font-bold tracking-widest">LOADING...</p>
    </div>
  )

  const today = history[history.length - 1] ?? null
  const { score: recovScore, baseline: hrvBaseline, deviation: hrvDeviation } = today
    ? calcRecovery(history, today)
    : { score: null, baseline: null, deviation: null }
  const acwrData = calcACWR(history)
  const rec = getRecommendation(recovScore, acwrData?.acwr ?? null)
  const rc = recoveryColor(recovScore)

  // Recovery arc (270° sweep)
  const cx = 90, cy = 90, R = 72
  const circ = 2 * Math.PI * R
  const recPct = (recovScore ?? 0) / 100
  const arcOffset = circ * 0.125 // start at 7 o'clock
  const arcTotal = circ * 0.75   // 270°

  // Zone thresholds along the 270° arc
  const zones = [
    { pct: 0.30, color: '#ef4444' }, // REST 0–30
    { pct: 0.20, color: '#f97316' }, // RECOVER 30–50
    { pct: 0.20, color: '#eab308' }, // MAINTAIN 50–70
    { pct: 0.30, color: '#22c55e' }, // PUSH 70–100
  ]

  // HRV chart: last 14 days
  const last14 = history.slice(-14)
  const maxHRV = Math.max(...last14.map(d => d.hrv ?? 0), 10)

  // Load chart: last 14 days
  const maxLoad = Math.max(...last14.map(d => d.load), 1)

  // This week stats
  const last7 = history.slice(-7)
  const weekSessions = last7.filter(d => d.load > 10).length
  const weekLoad = Math.round(last7.reduce((s, d) => s + d.load, 0))
  const weekSteps = Math.round(last7.reduce((s, d) => s + (d.steps ?? 0), 0) / 1000)
  const goodSleeps = last7.filter(d => (d.sleep ?? 0) >= 70).length

  const dayLetter = (date: string) => new Date(date).toLocaleDateString('en-GB', { weekday: 'short' }).charAt(0)

  return (
    <div className="min-h-screen pb-20" style={{ background: '#050505', fontFamily: 'system-ui,sans-serif' }}>

      {/* Header */}
      <div className="px-4 pt-6 pb-2 flex items-center justify-between">
        <div>
          <div className="flex items-baseline gap-2">
            <span className="font-black text-lg tracking-widest" style={{ color: '#22c55e' }}>ATHLYTIC</span>
            <span className="text-[10px] text-gray-600 tracking-wider">× Garmin</span>
          </div>
          <p className="text-gray-600 text-xs mt-0.5">
            {new Date().toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' })}
          </p>
        </div>
        {hrvBaseline != null && (
          <div className="text-right bg-gray-900 rounded-xl px-3 py-1.5">
            <p className="text-[9px] text-gray-600 uppercase tracking-wider">HRV Baseline</p>
            <p className="text-sm font-bold" style={{ color: '#22c55e' }}>{hrvBaseline} ms</p>
          </div>
        )}
      </div>

      <div className="px-4 space-y-3">

        {/* Recovery ring */}
        <div className="rounded-2xl p-5 flex flex-col items-center"
          style={{ background: '#0a0a0a', border: '1px solid #1a1a1a' }}>
          <p className="text-[10px] font-bold tracking-[0.2em] text-gray-600 mb-2">RECOVERY SCORE</p>

          <svg viewBox="0 0 180 180" className="w-44 h-44">
            <defs>
              <filter id="athGlow" x="-50%" y="-50%" width="200%" height="200%">
                <feGaussianBlur stdDeviation="5" result="blur" />
                <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
              </filter>
            </defs>

            {/* Zone background arcs */}
            {zones.reduce<{ el: React.ReactNode[]; offset: number }>((acc, z) => {
              const len = z.pct * arcTotal
              acc.el.push(
                <circle key={z.color} cx={cx} cy={cy} r={R} fill="none" stroke={z.color}
                  strokeWidth={12} opacity={0.12}
                  strokeDasharray={`${len} ${circ}`}
                  strokeDashoffset={-(arcOffset + (1 - acc.offset - z.pct) * arcTotal - arcTotal + len)}
                  strokeLinecap="butt" />
              )
              acc.offset += z.pct
              return acc
            }, { el: [], offset: 0 }).el}

            {/* Track */}
            <circle cx={cx} cy={cy} r={R} fill="none" stroke="#111" strokeWidth={12}
              strokeDasharray={`${arcTotal} ${circ}`} strokeDashoffset={-arcOffset} strokeLinecap="round" />

            {/* Fill arc */}
            {recovScore != null && (
              <circle cx={cx} cy={cy} r={R} fill="none" stroke={rc} strokeWidth={12}
                strokeDasharray={`${recPct * arcTotal} ${circ}`}
                strokeDashoffset={-arcOffset}
                strokeLinecap="round" filter="url(#athGlow)" />
            )}

            {/* Score text */}
            <text x={cx} y={cy - 8} textAnchor="middle" fill="white" fontSize="42" fontWeight="900" fontFamily="system-ui">
              {recovScore ?? '—'}
            </text>
            <text x={cx} y={cy + 12} textAnchor="middle" fontSize="8" fill="#4b5563" letterSpacing="2" fontFamily="system-ui">
              RECOVERY
            </text>
            {hrvDeviation != null && (
              <text x={cx} y={cy + 27} textAnchor="middle" fontSize="11" fontWeight="700" fontFamily="system-ui"
                fill={hrvDeviation >= 0 ? '#22c55e' : '#ef4444'}>
                {hrvDeviation >= 0 ? '+' : ''}{hrvDeviation}% HRV
              </text>
            )}
          </svg>

          {/* Zone bar */}
          <div className="flex gap-1.5 mt-1 items-end">
            {[{ l: 'REST', c: '#ef4444', lo: 0 }, { l: 'RECOVER', c: '#f97316', lo: 30 },
              { l: 'MAINTAIN', c: '#eab308', lo: 50 }, { l: 'PUSH', c: '#22c55e', lo: 70 }].map(z => {
              const active = recovScore != null && recovScore >= z.lo &&
                (z.lo === 70 ? true : recovScore < z.lo + (z.lo === 0 ? 30 : z.lo === 30 ? 20 : 20))
              return (
                <div key={z.l} className="flex flex-col items-center gap-1">
                  <div className="h-0.5 w-10 rounded-full transition-all" style={{ background: z.c, opacity: active ? 1 : 0.2 }} />
                  <span className="text-[8px] font-bold tracking-wider" style={{ color: active ? z.c : '#374151' }}>{z.l}</span>
                </div>
              )
            })}
          </div>
        </div>

        {/* Recommendation */}
        <div className="rounded-2xl px-4 py-3.5 flex items-center gap-3"
          style={{ background: rec.bg, border: `1px solid ${rec.color}25` }}>
          <span className="text-2xl flex-shrink-0">{rec.emoji}</span>
          <div>
            <p className="font-black tracking-widest text-sm" style={{ color: rec.color }}>{rec.label}</p>
            <p className="text-xs text-gray-400 mt-0.5 leading-relaxed">{rec.desc}</p>
          </div>
        </div>

        {/* Key stats */}
        <div className="grid grid-cols-4 gap-2">
          {[
            {
              label: 'HRV', unit: 'ms', color: '#a855f7',
              value: today?.hrv != null ? Math.round(today.hrv) : null,
              sub: today?.hrv != null && hrvBaseline != null
                ? `${today.hrv >= hrvBaseline ? '+' : ''}${Math.round(today.hrv - hrvBaseline)}` : null,
            },
            {
              label: 'Sleep', unit: '/100', color: '#818cf8',
              value: today?.sleep ?? null,
              sub: today?.sleep != null ? (today.sleep >= 75 ? 'Great' : today.sleep >= 60 ? 'Good' : 'Poor') : null,
            },
            {
              label: 'Stress', unit: '', color: today?.stress != null ? (today.stress < 40 ? '#22c55e' : today.stress < 65 ? '#eab308' : '#ef4444') : '#6b7280',
              value: today?.stress != null ? Math.round(today.stress) : null,
              sub: today?.stress != null ? (today.stress < 40 ? 'Low' : today.stress < 65 ? 'Moderate' : 'High') : null,
            },
            {
              label: 'ACWR', unit: '', color: acwrData?.acwr != null ? (acwrData.acwr <= 1.3 ? '#22c55e' : acwrData.acwr <= 1.5 ? '#eab308' : '#ef4444') : '#6b7280',
              value: acwrData?.acwr ?? null,
              sub: acwrData?.acwr != null ? (acwrData.acwr <= 0.8 ? 'Detrain' : acwrData.acwr <= 1.3 ? 'Optimal' : acwrData.acwr <= 1.5 ? 'Caution' : 'Risky') : null,
            },
          ].map(s => (
            <div key={s.label} className="rounded-xl p-2.5 text-center" style={{ background: '#0a0a0a', border: '1px solid #1a1a1a' }}>
              <p className="text-sm font-black tabular-nums" style={{ color: s.color }}>
                {s.value ?? '—'}<span className="text-[9px] text-gray-600">{s.unit}</span>
              </p>
              {s.sub && <p className="text-[9px] mt-0.5" style={{ color: s.color, opacity: 0.7 }}>{s.sub}</p>}
              <p className="text-[8px] text-gray-600 mt-0.5 uppercase tracking-wider">{s.label}</p>
            </div>
          ))}
        </div>

        {/* HRV 14-day bar chart */}
        <div className="rounded-2xl p-4" style={{ background: '#0a0a0a', border: '1px solid #1a1a1a' }}>
          <p className="text-[10px] font-bold tracking-widest text-gray-600 mb-3">HRV — 14 DAY TREND</p>
          {last14.some(d => d.hrv != null) ? (
            <>
              <svg viewBox="0 0 280 75" className="w-full">
                {/* Baseline dashed line */}
                {hrvBaseline != null && (() => {
                  const by = 65 - (hrvBaseline / maxHRV) * 60
                  return (
                    <>
                      <line x1={0} y1={by} x2={280} y2={by} stroke="#374151" strokeWidth={1} strokeDasharray="4 3" />
                      <text x={276} y={by - 3} textAnchor="end" fontSize="7" fill="#4b5563">{hrvBaseline}ms</text>
                    </>
                  )
                })()}
                {last14.map((day, i) => {
                  if (day.hrv == null) return null
                  const barH = Math.max(4, (day.hrv / maxHRV) * 60)
                  const x = 10 + (i / 13) * 260
                  const color = hrvBaseline != null
                    ? day.hrv >= hrvBaseline * 1.08 ? '#22c55e'
                    : day.hrv >= hrvBaseline * 0.92 ? '#eab308' : '#ef4444'
                    : '#22c55e'
                  const isToday = i === 13
                  return (
                    <g key={day.date}>
                      <rect x={x - 7} y={65 - barH} width={14} height={barH} rx={3}
                        fill={color} opacity={isToday ? 1 : 0.65} />
                      {isToday && <rect x={x - 7} y={65 - barH} width={14} height={2} rx={1} fill="white" opacity={0.4} />}
                      <text x={x} y={73} textAnchor="middle" fontSize="7" fill={isToday ? '#9ca3af' : '#4b5563'}>
                        {dayLetter(day.date)}
                      </text>
                    </g>
                  )
                })}
              </svg>
              <div className="flex gap-4 mt-2">
                {[{ c: '#22c55e', l: '≥+8% baseline' }, { c: '#eab308', l: '±8% baseline' }, { c: '#ef4444', l: '≤−8% baseline' }].map(z => (
                  <div key={z.l} className="flex items-center gap-1">
                    <div className="w-2 h-2 rounded-sm flex-shrink-0" style={{ background: z.c }} />
                    <span className="text-[9px] text-gray-600">{z.l}</span>
                  </div>
                ))}
              </div>
            </>
          ) : (
            <p className="text-gray-600 text-xs text-center py-4">No HRV data yet — sync Garmin to populate</p>
          )}
        </div>

        {/* Training Load chart */}
        <div className="rounded-2xl p-4" style={{ background: '#0a0a0a', border: '1px solid #1a1a1a' }}>
          <div className="flex items-center justify-between mb-3">
            <p className="text-[10px] font-bold tracking-widest text-gray-600">TRAINING LOAD — 14 DAYS</p>
            {acwrData && (
              <span className="text-[10px] font-bold px-2 py-0.5 rounded-full" style={{
                color: acwrData.acwr <= 1.3 ? '#22c55e' : acwrData.acwr <= 1.5 ? '#eab308' : '#ef4444',
                background: acwrData.acwr <= 1.3 ? '#052e16' : acwrData.acwr <= 1.5 ? '#1c1a06' : '#1c0505',
              }}>ACWR {acwrData.acwr}</span>
            )}
          </div>
          {last14.some(d => d.load > 0) ? (
            <svg viewBox="0 0 280 70" className="w-full">
              {/* Divider between chronic and acute zones */}
              <line x1={140} y1={0} x2={140} y2={60} stroke="#1e3a5f" strokeWidth={1} strokeDasharray="3 3" />
              <text x={70} y={8} textAnchor="middle" fontSize="7" fill="#1d4ed8" opacity={0.5}>Chronic zone</text>
              <text x={210} y={8} textAnchor="middle" fontSize="7" fill="#3b82f6">Acute zone (7d)</text>
              {last14.map((day, i) => {
                const barH = Math.max(day.load > 0 ? 4 : 0, (day.load / maxLoad) * 52)
                const x = 10 + (i / 13) * 260
                const isAcute = i >= 7
                const isToday = i === 13
                return (
                  <g key={day.date}>
                    <rect x={x - 7} y={60 - barH} width={14} height={barH} rx={3}
                      fill={isAcute ? '#3b82f6' : '#1e3a5f'} opacity={isToday ? 1 : 0.75} />
                    <text x={x} y={68} textAnchor="middle" fontSize="7" fill={isToday ? '#9ca3af' : '#374151'}>
                      {dayLetter(day.date)}
                    </text>
                  </g>
                )
              })}
            </svg>
          ) : (
            <p className="text-gray-600 text-xs text-center py-4">No training load data yet</p>
          )}
          {acwrData && (
            <div className="mt-2 flex gap-4 text-[9px] text-gray-600">
              <span>Acute (7d): <strong className="text-blue-400">{acwrData.acute} pts</strong></span>
              <span>Chronic avg: <strong className="text-gray-400">{acwrData.chronicWeekly} pts/wk</strong></span>
            </div>
          )}
        </div>

        {/* This Week */}
        <div className="rounded-2xl p-4" style={{ background: '#0a0a0a', border: '1px solid #1a1a1a' }}>
          <p className="text-[10px] font-bold tracking-widest text-gray-600 mb-3">THIS WEEK</p>
          <div className="grid grid-cols-4 gap-2">
            {[
              { label: 'Sessions', value: weekSessions, color: '#22c55e' },
              { label: 'Load pts', value: weekLoad, color: '#ffffff' },
              { label: 'K steps', value: weekSteps, color: '#ffffff' },
              { label: 'Good sleeps', value: `${goodSleeps}/7`, color: goodSleeps >= 5 ? '#22c55e' : goodSleeps >= 3 ? '#eab308' : '#ef4444' },
            ].map(s => (
              <div key={s.label} className="text-center">
                <p className="text-xl font-black tabular-nums" style={{ color: s.color }}>{s.value}</p>
                <p className="text-[9px] text-gray-600 uppercase tracking-wider mt-0.5">{s.label}</p>
              </div>
            ))}
          </div>
        </div>

      </div>
      <BottomNav />
    </div>
  )
}

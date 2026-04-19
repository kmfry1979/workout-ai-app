'use client'

import { useEffect, useState, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '../../lib/supabase'
import { BottomNav } from '../../components/BottomNav'

// ─── Types ────────────────────────────────────────────────────────────────────

type RawActivity = {
  raw_payload: Record<string, unknown> | null
  start_time: string
}

type HealthData = {
  hrv: number | null
  hrvStatus: string | null
  respiration: number | null
  stressAvg: number | null
  bodyBatteryEnd: number | null
  sleepScore: number | null
  sleepDurationSeconds: number | null
  deepSleepSeconds: number | null
  sleepRespiration: number | null
  modIntMin: number | null
  vigIntMin: number | null
  activeMin: number | null
  rhr: number | null
  rhrBaseline: number | null
  respirationHistory: (number | null)[]
  vo2max: number | null
  dob: string | null
  displayName: string | null
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function localDateStr(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

function clamp(v: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, v))
}

// ─── Score Calculations ───────────────────────────────────────────────────────

function calcRecovery(hrv: number | null, sleepScore: number | null, rhr: number | null): number | null {
  let score = 0
  let weight = 0

  if (hrv != null) {
    const hrvScore = ((clamp(hrv, 20, 120) - 20) / 100) * 100
    score += hrvScore * 0.45
    weight += 0.45
  }
  if (sleepScore != null) {
    score += sleepScore * 0.35
    weight += 0.35
  }
  if (rhr != null) {
    const rhrScore = ((clamp(rhr, 40, 80) - 40) / 40) * 100
    score += (100 - rhrScore) * 0.20
    weight += 0.20
  }

  if (weight === 0) return null
  return Math.round(score / weight)
}

function calcStrain(modMin: number | null, vigMin: number | null, activeMin: number | null): number {
  const intensity = modMin != null || vigMin != null
    ? (modMin ?? 0) + (vigMin ?? 0) * 2
    : (activeMin ?? 0) * 0.6
  return Math.min(21, 21 * Math.log10(1 + intensity) / Math.log10(301))
}

function recoveryColor(score: number | null): string {
  if (score == null) return '#4b5563'
  if (score >= 67) return '#21FF00'
  if (score >= 34) return '#FFFF00'
  return '#FF0000'
}

function recoveryLabel(score: number | null): string {
  if (score == null) return 'No data'
  if (score >= 67) return 'Recovered'
  if (score >= 34) return 'Moderate'
  return 'Low'
}

function detectEarlyWarning(today: number | null, history: (number | null)[]): {
  triggered: boolean; pct: number; baseline: number
} {
  const valid = history.filter((v): v is number => v != null && v > 0)
  if (valid.length < 3 || today == null) return { triggered: false, pct: 0, baseline: 0 }
  const baseline = valid.reduce((a, b) => a + b, 0) / valid.length
  const pct = ((today - baseline) / baseline) * 100
  return { triggered: pct > 12, pct, baseline }
}

type BioAgeResult = {
  bioAge: number
  adjustments: { label: string; delta: number; achieved: boolean }[]
} | null

function calcBioAge(dob: string | null, vo2max: number | null, rhr: number | null, rhrBaseline: number | null, deepSleepSeconds: number | null, totalSleepSeconds: number | null): BioAgeResult {
  if (!dob) return null
  const birthDate = new Date(dob)
  const now = new Date()
  const chronoAge = Math.floor((now.getTime() - birthDate.getTime()) / (365.25 * 24 * 3600 * 1000))
  if (chronoAge < 10 || chronoAge > 110) return null

  const vo2Thresholds: Record<string, number> = {
    '20': 55, '30': 52, '40': 48, '50': 44, '60': 40,
  }
  const decade = String(Math.floor(Math.min(chronoAge, 69) / 10) * 10)
  const vo2Threshold = vo2Thresholds[decade] ?? 40

  const adjustments: { label: string; delta: number; achieved: boolean }[] = []
  let bioAge = chronoAge

  // VO2 max: top 20% for age = -2 years
  const vo2Achieved = vo2max != null && vo2max >= vo2Threshold
  adjustments.push({ label: `VO2 Max ${vo2max != null ? `${vo2max.toFixed(0)} ml/kg/min` : '(no data)'}`, delta: -2, achieved: vo2Achieved })
  if (vo2Achieved) bioAge -= 2

  // RHR elevated > baseline + 5 = +1 year
  const rhrElevated = rhr != null && rhrBaseline != null && rhr > rhrBaseline + 5
  adjustments.push({ label: `Resting HR ${rhr != null ? `${rhr} bpm` : '(no data)'}`, delta: 1, achieved: rhrElevated })
  if (rhrElevated) bioAge += 1

  // Deep sleep > 20% of total = -1 year
  const deepPct = deepSleepSeconds != null && totalSleepSeconds != null && totalSleepSeconds > 0
    ? deepSleepSeconds / totalSleepSeconds
    : null
  const deepAchieved = deepPct != null && deepPct > 0.20
  adjustments.push({ label: `Deep Sleep ${deepPct != null ? `${Math.round(deepPct * 100)}%` : '(no data)'}`, delta: -1, achieved: deepAchieved })
  if (deepAchieved) bioAge -= 1

  return { bioAge, adjustments }
}

// ─── SVG Ring ─────────────────────────────────────────────────────────────────

function RecoveryStrainRing({ recovery, strain }: { recovery: number | null; strain: number }) {
  const cx = 120, cy = 120
  const rOuter = 86, rInner = 66
  const swOuter = 10, swInner = 16
  const circumOuter = 2 * Math.PI * rOuter
  const circumInner = 2 * Math.PI * rInner
  const color = recoveryColor(recovery)
  const recPct = recovery != null ? clamp(recovery, 0, 100) / 100 : 0
  const strainPct = clamp(strain, 0, 21) / 21

  return (
    <svg viewBox="0 0 240 240" className="w-56 h-56">
      {/* Track circles */}
      <circle cx={cx} cy={cy} r={rOuter} fill="none" stroke="#1f1f1f" strokeWidth={swOuter} />
      <circle cx={cx} cy={cy} r={rInner} fill="none" stroke="#1f1f1f" strokeWidth={swInner} />
      {/* Recovery arc (outer) */}
      <circle
        cx={cx} cy={cy} r={rOuter} fill="none"
        stroke={color} strokeWidth={swOuter} strokeLinecap="round"
        strokeDasharray={`${recPct * circumOuter} ${circumOuter}`}
        transform={`rotate(-90 ${cx} ${cy})`}
      />
      {/* Strain arc (inner, blue) */}
      <circle
        cx={cx} cy={cy} r={rInner} fill="none"
        stroke="#3b82f6" strokeWidth={swInner} strokeLinecap="round"
        strokeDasharray={`${strainPct * circumInner} ${circumInner}`}
        transform={`rotate(-90 ${cx} ${cy})`}
      />
      {/* Center: recovery number */}
      <text x={cx} y={cy - 10} textAnchor="middle" fill="white" fontSize="38" fontWeight="bold" fontFamily="system-ui,sans-serif">
        {recovery != null ? Math.round(recovery) : '—'}
      </text>
      <text x={cx} y={cy + 12} textAnchor="middle" fill="#9ca3af" fontSize="10" fontFamily="system-ui,sans-serif" letterSpacing="3">
        RECOVERY
      </text>
      <text x={cx} y={cy + 28} textAnchor="middle" fill="#3b82f6" fontSize="10" fontFamily="system-ui,sans-serif" letterSpacing="2">
        {strain.toFixed(1)} STRAIN
      </text>
    </svg>
  )
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function HealthPage() {
  const router = useRouter()
  const [loading, setLoading] = useState(true)
  const [data, setData] = useState<HealthData | null>(null)
  const [briefing, setBriefing] = useState<string | null>(null)
  const [briefingLoading, setBriefingLoading] = useState(false)

  const loadData = useCallback(async () => {
    const { data: sessionData } = await supabase.auth.getSession()
    const user = sessionData.session?.user
    if (!user) { router.push('/login'); return }

    const userId = user.id
    const today = localDateStr(new Date())
    const fourteenAgo = localDateStr(new Date(Date.now() - 13 * 86400000))
    const sevenAgo = localDateStr(new Date(Date.now() - 6 * 86400000))

    const [
      todayHealthRes,
      history14Res,
      todayLegacyRes,
      history7LegacyRes,
      sleepRes,
      stepsRes,
      activitiesRes,
      profileRes,
    ] = await Promise.all([
      supabase.from('garmin_daily_health_metrics')
        .select('hrv_avg, hrv_status, respiration_avg_bpm, stress_avg, body_battery_end')
        .eq('user_id', userId).eq('metric_date', today).maybeSingle(),
      supabase.from('garmin_daily_health_metrics')
        .select('metric_date, respiration_avg_bpm')
        .eq('user_id', userId).gte('metric_date', fourteenAgo).order('metric_date'),
      supabase.from('daily_health_metrics')
        .select('resting_hr, resting_heart_rate_bpm')
        .eq('user_id', userId).eq('metric_date', today).maybeSingle(),
      supabase.from('daily_health_metrics')
        .select('metric_date, resting_hr, resting_heart_rate_bpm')
        .eq('user_id', userId).gte('metric_date', sevenAgo).order('metric_date'),
      supabase.from('garmin_sleep_data')
        .select('sleep_score, sleep_duration_seconds, deep_sleep_seconds, avg_respiration_bpm')
        .eq('user_id', userId).gte('sleep_date', sevenAgo).order('sleep_date', { ascending: false }).limit(1).maybeSingle(),
      supabase.from('garmin_daily_steps')
        .select('moderate_intensity_minutes, vigorous_intensity_minutes, active_minutes')
        .eq('user_id', userId).eq('step_date', today).maybeSingle(),
      supabase.from('garmin_activities')
        .select('raw_payload, start_time')
        .eq('user_id', userId).order('start_time', { ascending: false }).limit(10),
      supabase.from('profiles')
        .select('date_of_birth, display_name, name')
        .eq('user_id', userId).maybeSingle(),
    ])

    const todayHealth = todayHealthRes.data
    const history14 = history14Res.data ?? []
    const todayLegacy = todayLegacyRes.data
    const history7Legacy = history7LegacyRes.data ?? []
    const sleep = sleepRes.data
    const steps = stepsRes.data
    const activities = (activitiesRes.data ?? []) as RawActivity[]
    const profile = profileRes.data as { date_of_birth?: string | null; display_name?: string | null; name?: string | null } | null

    // RHR from legacy table
    const rhr = (todayLegacy as { resting_hr?: number | null; resting_heart_rate_bpm?: number | null } | null)
      ?.resting_hr ?? (todayLegacy as { resting_heart_rate_bpm?: number | null } | null)?.resting_heart_rate_bpm ?? null

    // RHR 7-day baseline
    const rhrHistory = (history7Legacy as { resting_hr?: number | null; resting_heart_rate_bpm?: number | null }[])
      .map(r => r.resting_hr ?? r.resting_heart_rate_bpm ?? null)
      .filter((v): v is number => v != null)
    const rhrBaseline = rhrHistory.length > 0
      ? rhrHistory.reduce((a, b) => a + b, 0) / rhrHistory.length
      : null

    // 14-day respiration history
    const respirationHistory = history14.map(r => (r as { respiration_avg_bpm?: number | null }).respiration_avg_bpm ?? null)

    // VO2 max from most recent activity raw_payload
    const vo2max = activities.reduce<number | null>((best, a) => {
      const raw = a.raw_payload
      const v = raw?.vO2MaxValue ?? raw?.vo2MaxValue
      if (typeof v === 'number' && v > 0) return best == null ? v : Math.max(best, v)
      return best
    }, null)

    const healthData: HealthData = {
      hrv: (todayHealth as { hrv_avg?: number | null } | null)?.hrv_avg ?? null,
      hrvStatus: (todayHealth as { hrv_status?: string | null } | null)?.hrv_status ?? null,
      respiration: (todayHealth as { respiration_avg_bpm?: number | null } | null)?.respiration_avg_bpm ?? null,
      stressAvg: (todayHealth as { stress_avg?: number | null } | null)?.stress_avg ?? null,
      bodyBatteryEnd: (todayHealth as { body_battery_end?: number | null } | null)?.body_battery_end ?? null,
      sleepScore: (sleep as { sleep_score?: number | null } | null)?.sleep_score ?? null,
      sleepDurationSeconds: (sleep as { sleep_duration_seconds?: number | null } | null)?.sleep_duration_seconds ?? null,
      deepSleepSeconds: (sleep as { deep_sleep_seconds?: number | null } | null)?.deep_sleep_seconds ?? null,
      sleepRespiration: (sleep as { avg_respiration_bpm?: number | null } | null)?.avg_respiration_bpm ?? null,
      modIntMin: (steps as { moderate_intensity_minutes?: number | null } | null)?.moderate_intensity_minutes ?? null,
      vigIntMin: (steps as { vigorous_intensity_minutes?: number | null } | null)?.vigorous_intensity_minutes ?? null,
      activeMin: (steps as { active_minutes?: number | null } | null)?.active_minutes ?? null,
      rhr,
      rhrBaseline,
      respirationHistory,
      vo2max,
      dob: profile?.date_of_birth ?? null,
      displayName: profile?.display_name ?? profile?.name ?? null,
    }

    setData(healthData)
    setLoading(false)
  }, [router])

  useEffect(() => { loadData() }, [loadData])

  const fetchBriefing = useCallback(async () => {
    if (!data || briefingLoading) return
    setBriefingLoading(true)
    try {
      const recovery = calcRecovery(data.hrv, data.sleepScore, data.rhr)
      const strain = calcStrain(data.modIntMin, data.vigIntMin, data.activeMin)
      const warning = detectEarlyWarning(data.respiration ?? data.sleepRespiration, data.respirationHistory)
      const res = await fetch('/api/ai/snapshot', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          mode: 'health-engine',
          recovery,
          strain,
          hrv: data.hrv,
          sleepScore: data.sleepScore,
          respiration: data.respiration ?? data.sleepRespiration,
          respirationBaseline: warning.baseline || null,
          hour: new Date().getHours(),
        }),
      })
      if (res.ok) {
        const json = await res.json() as { insight?: string }
        setBriefing(json.insight ?? null)
      }
    } finally {
      setBriefingLoading(false)
    }
  }, [data, briefingLoading])

  useEffect(() => {
    if (data) fetchBriefing()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data])

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ background: '#0a0a0a' }}>
        <div className="w-8 h-8 border-2 border-gray-600 border-t-white rounded-full animate-spin" />
      </div>
    )
  }

  const recovery = data ? calcRecovery(data.hrv, data.sleepScore, data.rhr) : null
  const strain = data ? calcStrain(data.modIntMin, data.vigIntMin, data.activeMin) : 0
  const color = recoveryColor(recovery)
  const label = recoveryLabel(recovery)
  const warning = data ? detectEarlyWarning(data.respiration ?? data.sleepRespiration, data.respirationHistory) : { triggered: false, pct: 0, baseline: 0 }
  const overreaching = recovery != null && recovery < 30 && strain > 10
  const bioAge = data ? calcBioAge(data.dob, data.vo2max, data.rhr, data.rhrBaseline, data.deepSleepSeconds, data.sleepDurationSeconds) : null
  const chronoAge = data?.dob ? Math.floor((Date.now() - new Date(data.dob).getTime()) / (365.25 * 24 * 3600 * 1000)) : null
  const hour = new Date().getHours()
  const briefingLabel = hour < 12 ? '🌅 Morning Briefing' : hour < 18 ? '☀️ Afternoon Check-in' : '🌙 Evening Briefing'

  const fmt = (sec: number | null) => sec != null
    ? `${Math.floor(sec / 3600)}h ${Math.floor((sec % 3600) / 60)}m`
    : '—'

  return (
    <div className="min-h-screen pb-20 text-white" style={{ background: '#0a0a0a' }}>
      <div className="max-w-md mx-auto px-4 pt-6">

        {/* Header */}
        <div className="mb-6">
          <p className="text-xs text-gray-500 uppercase tracking-widest mb-1">
            {new Date().toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' })}
          </p>
          <h1 className="text-2xl font-bold">Health Engine</h1>
          {data?.displayName && <p className="text-sm text-gray-400 mt-0.5">{data.displayName}</p>}
        </div>

        {/* Overreaching Warning */}
        {overreaching && (
          <div className="mb-4 rounded-2xl p-4 border border-red-500/50 bg-red-950/40">
            <p className="text-sm font-bold text-red-400 mb-1">⚠️ High Risk of Overreaching</p>
            <p className="text-xs text-red-300">Recovery is critically low ({Math.round(recovery!)}%) while strain is high ({strain.toFixed(1)}). Prioritise full rest today.</p>
          </div>
        )}

        {/* Recovery & Strain Ring */}
        <div className="rounded-3xl p-6 mb-4 flex flex-col items-center" style={{ background: '#111111' }}>
          <p className="text-xs text-gray-500 uppercase tracking-widest mb-4">Recovery & Strain</p>
          <RecoveryStrainRing recovery={recovery} strain={strain} />
          <div className="flex gap-12 mt-4">
            <div className="text-center">
              <p className="text-2xl font-bold" style={{ color }}>{recovery != null ? `${Math.round(recovery)}%` : '—'}</p>
              <p className="text-xs text-gray-500 uppercase tracking-wider mt-0.5">{label}</p>
            </div>
            <div className="w-px bg-gray-800" />
            <div className="text-center">
              <p className="text-2xl font-bold text-blue-400">{strain.toFixed(1)}</p>
              <p className="text-xs text-gray-500 uppercase tracking-wider mt-0.5">Strain / 21</p>
            </div>
          </div>
          {data?.hrvStatus && (
            <p className="mt-3 text-xs text-gray-500">HRV Status: <span className="text-gray-300">{data.hrvStatus}</span></p>
          )}
        </div>

        {/* Bento Boxes: Sleep / HRV / Respiration */}
        <div className="grid grid-cols-3 gap-3 mb-4">
          {/* Sleep */}
          <div className="rounded-2xl p-4" style={{ background: '#111111' }}>
            <p className="text-[10px] text-gray-500 uppercase tracking-wider mb-2">Sleep</p>
            <p className="text-lg font-bold text-white">{fmt(data?.sleepDurationSeconds ?? null)}</p>
            <p className="text-[10px] text-gray-400 mt-1">Score <span className="text-white font-semibold">{data?.sleepScore ?? '—'}</span></p>
            {data?.deepSleepSeconds != null && data.sleepDurationSeconds != null && (
              <p className="text-[10px] text-gray-500 mt-0.5">
                Deep {Math.round((data.deepSleepSeconds / data.sleepDurationSeconds) * 100)}%
              </p>
            )}
          </div>

          {/* HRV */}
          <div className="rounded-2xl p-4" style={{ background: '#111111' }}>
            <p className="text-[10px] text-gray-500 uppercase tracking-wider mb-2">HRV</p>
            <p className="text-lg font-bold text-white">{data?.hrv != null ? `${data.hrv}ms` : '—'}</p>
            <p className="text-[10px] text-gray-400 mt-1">RHR <span className="text-white font-semibold">{data?.rhr != null ? `${data.rhr}bpm` : '—'}</span></p>
            {data?.rhrBaseline != null && data.rhr != null && (
              <p className="text-[10px] mt-0.5" style={{ color: data.rhr > data.rhrBaseline + 5 ? '#FF0000' : '#9ca3af' }}>
                Base {Math.round(data.rhrBaseline)}bpm
              </p>
            )}
          </div>

          {/* Respiration */}
          <div className="rounded-2xl p-4" style={{ background: '#111111' }}>
            <p className="text-[10px] text-gray-500 uppercase tracking-wider mb-2">Respiration</p>
            <p className="text-lg font-bold" style={{ color: warning.triggered ? '#FF0000' : 'white' }}>
              {data?.respiration != null ? `${data.respiration.toFixed(1)}` : data?.sleepRespiration != null ? `${data.sleepRespiration.toFixed(1)}` : '—'}
            </p>
            <p className="text-[10px] text-gray-400 mt-1">brpm</p>
            <p className="text-[10px] mt-0.5" style={{ color: warning.triggered ? '#FF0000' : '#9ca3af' }}>
              {warning.triggered ? `+${warning.pct.toFixed(0)}%` : 'Stable'}
            </p>
          </div>
        </div>

        {/* Early Warning System */}
        {warning.triggered && (
          <div className="mb-4 rounded-2xl p-4 border border-red-500/60" style={{ background: 'rgba(127,0,0,0.25)', boxShadow: '0 0 20px rgba(255,0,0,0.15)' }}>
            <p className="text-sm font-bold text-red-400 mb-2">🦠 Anomaly Detected</p>
            <p className="text-xs text-red-200">
              Your respiration rate is {warning.pct.toFixed(0)}% above your 14-day baseline ({warning.baseline.toFixed(1)} brpm). This may indicate your body is fighting an infection. Consider a full rest day and monitor tomorrow.
            </p>
          </div>
        )}

        {/* Biological Age */}
        <div className="rounded-3xl p-6 mb-4" style={{ background: '#111111' }}>
          <p className="text-xs text-gray-500 uppercase tracking-widest mb-4">Biological Age</p>
          {bioAge ? (
            <>
              <div className="text-center mb-4">
                <p className="text-5xl font-bold" style={{ color: bioAge.bioAge < (chronoAge ?? 99) ? '#21FF00' : bioAge.bioAge > (chronoAge ?? 0) ? '#FF0000' : '#FFFF00' }}>
                  {bioAge.bioAge}
                </p>
                <p className="text-sm text-gray-400 mt-2">
                  {bioAge.bioAge === chronoAge
                    ? `Same as your chronological age of ${chronoAge}`
                    : bioAge.bioAge < (chronoAge ?? 99)
                    ? `${(chronoAge ?? 0) - bioAge.bioAge} year${(chronoAge ?? 0) - bioAge.bioAge !== 1 ? 's' : ''} younger than your chronological age of ${chronoAge}`
                    : `${bioAge.bioAge - (chronoAge ?? 0)} year${bioAge.bioAge - (chronoAge ?? 0) !== 1 ? 's' : ''} older than your chronological age of ${chronoAge}`}
                </p>
              </div>
              <div className="space-y-2">
                {bioAge.adjustments.map((adj, i) => (
                  <div key={i} className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span className="text-sm">{adj.delta < 0 ? (adj.achieved ? '✅' : '○') : (adj.achieved ? '⚠️' : '○')}</span>
                      <span className="text-xs text-gray-300">{adj.label}</span>
                    </div>
                    <span className="text-xs font-semibold" style={{ color: adj.achieved ? (adj.delta < 0 ? '#21FF00' : '#FF0000') : '#6b7280' }}>
                      {adj.achieved ? (adj.delta > 0 ? `+${adj.delta}yr` : `${adj.delta}yr`) : `${adj.delta > 0 ? '+' : ''}${adj.delta}yr (not met)`}
                    </span>
                  </div>
                ))}
              </div>
            </>
          ) : (
            <div className="text-center py-4">
              <p className="text-gray-500 text-sm mb-2">Date of birth required</p>
              <button
                onClick={() => router.push('/profile')}
                className="text-xs px-4 py-2 rounded-lg border border-gray-600 text-gray-300 hover:border-gray-400"
              >
                Add DOB in Profile
              </button>
            </div>
          )}
        </div>

        {/* AI Briefing */}
        <div className="rounded-3xl p-6 mb-4" style={{ background: '#111111' }}>
          <p className="text-xs text-gray-500 uppercase tracking-widest mb-3">{briefingLabel}</p>
          {briefingLoading ? (
            <div className="flex items-center gap-2">
              <div className="w-4 h-4 border border-gray-600 border-t-white rounded-full animate-spin" />
              <span className="text-xs text-gray-500">Analysing your data…</span>
            </div>
          ) : briefing ? (
            <p className="text-sm text-gray-200 leading-relaxed">{briefing}</p>
          ) : (
            <button
              onClick={fetchBriefing}
              className="text-xs px-4 py-2 rounded-lg border border-gray-600 text-gray-300 hover:border-gray-400"
            >
              Generate Briefing
            </button>
          )}
        </div>

        {/* Legend */}
        <div className="rounded-2xl p-4 mb-4" style={{ background: '#111111' }}>
          <p className="text-[10px] text-gray-600 uppercase tracking-widest mb-3">How scores are calculated</p>
          <div className="space-y-1.5 text-[10px] text-gray-500">
            <p><span className="text-gray-300">Recovery</span> = HRV (45%) + Sleep Score (35%) + Resting HR (20%), normalised 0–100</p>
            <p><span className="text-gray-300">Strain</span> = Intensity minutes mapped logarithmically to 0–21 scale</p>
            <p><span className="text-gray-300">Early Warning</span> = Respiration &gt;12% above 14-day rolling baseline</p>
            <p><span className="text-gray-300">Bio Age</span> = Chronological age ± adjustments for VO2 max, RHR trend, deep sleep</p>
          </div>
        </div>

      </div>
      <BottomNav />
    </div>
  )
}

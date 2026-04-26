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

type ActivityDetail = {
  activity_type: string | null
  duration_sec: number | null
  distance_m: number | null
  avg_hr: number | null
  max_hr: number | null
  calories: number | null
  start_time: string
}

type WeeklyPlan = {
  generated_at: string
  week_start: string
  days: { day: string; session: string; detail: string; intensity: 'rest' | 'low' | 'moderate' | 'high' }[]
}

type RaceGoal = {
  name: string
  distance_km: number
  target_sec: number
  race_date: string
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
  // Training Readiness + Status (from Garmin)
  trainingReadinessScore: number | null
  trainingReadinessLabel: string | null
  trainingStatusPhase: string | null
  // Analytics
  hrvHistory30: { date: string; hrv: number | null }[]
  stepsHistory28: { date: string; load: number }[]
  sleepHistory30: { date: string; score: number | null }[]
  sleepHistory7durations: (number | null)[]
  activities90: ActivityDetail[]
  journalHistory: { date: string; tags: string[] }[]
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

function calcRecovery(hrv: number | null, sleepScore: number | null, rhr: number | null, hrvStatus?: string | null): number | null {
  const status = (hrvStatus ?? '').toLowerCase()
  const hrvScore = hrv != null
    ? status.includes('balanced') || status.includes('good') ? Math.min(85, 50 + (hrv - 30) * 1.5)
    : status.includes('poor') || status.includes('low') ? Math.max(15, 40 - (40 - hrv))
    : Math.max(0, Math.min(100, ((hrv - 20) / 60) * 100))
    : null
  let score = 0, weight = 0
  if (hrvScore != null) { score += hrvScore * 0.45; weight += 0.45 }
  if (sleepScore != null) { score += sleepScore * 0.35; weight += 0.35 }
  if (rhr != null) { score += (100 - ((Math.max(40, Math.min(80, rhr)) - 40) / 40) * 100) * 0.20; weight += 0.20 }
  return weight > 0 ? Math.round(score / weight) : null
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
  if (score >= 34) return '#f97316'
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
  const vo2Thresholds: Record<string, number> = { '20': 55, '30': 52, '40': 48, '50': 44, '60': 40 }
  const decade = String(Math.floor(Math.min(chronoAge, 69) / 10) * 10)
  const vo2Threshold = vo2Thresholds[decade] ?? 40
  const adjustments: { label: string; delta: number; achieved: boolean }[] = []
  let bioAge = chronoAge
  const vo2Achieved = vo2max != null && vo2max >= vo2Threshold
  adjustments.push({ label: `VO2 Max ${vo2max != null ? `${vo2max.toFixed(0)} ml/kg/min` : '(no data)'}`, delta: -2, achieved: vo2Achieved })
  if (vo2Achieved) bioAge -= 2
  const rhrElevated = rhr != null && rhrBaseline != null && rhr > rhrBaseline + 5
  adjustments.push({ label: `Resting HR ${rhr != null ? `${rhr} bpm` : '(no data)'}`, delta: 1, achieved: rhrElevated })
  if (rhrElevated) bioAge += 1
  const deepPct = deepSleepSeconds != null && totalSleepSeconds != null && totalSleepSeconds > 0
    ? deepSleepSeconds / totalSleepSeconds : null
  const deepAchieved = deepPct != null && deepPct > 0.20
  adjustments.push({ label: `Deep Sleep ${deepPct != null ? `${Math.round(deepPct * 100)}%` : '(no data)'}`, delta: -1, achieved: deepAchieved })
  if (deepAchieved) bioAge -= 1
  return { bioAge, adjustments }
}

// ─── Analytics Calculations ───────────────────────────────────────────────────

function calcACWR(stepsHistory28: { date: string; load: number }[]) {
  if (stepsHistory28.length < 7) return null
  const sorted = [...stepsHistory28].sort((a, b) => a.date.localeCompare(b.date))
  const acute = sorted.slice(-7).reduce((s, d) => s + d.load, 0)
  const chronic = sorted.reduce((s, d) => s + d.load, 0) / 4
  if (chronic < 1) return null
  return { acwr: acute / chronic, acute: Math.round(acute), chronic: Math.round(chronic) }
}

function calcHRVTrend(hrvHistory: { date: string; hrv: number | null }[]) {
  const sorted = [...hrvHistory].sort((a, b) => a.date.localeCompare(b.date))
  const values = sorted.map(r => r.hrv)
  const rolling7: (number | null)[] = values.map((_, i) => {
    const window = values.slice(Math.max(0, i - 6), i + 1).filter((v): v is number => v != null)
    return window.length > 0 ? Math.round(window.reduce((a, b) => a + b, 0) / window.length) : null
  })
  const valid = values.filter((v): v is number => v != null)
  const avg = valid.length > 0 ? valid.reduce((a, b) => a + b, 0) / valid.length : null
  const recent7 = values.slice(-7).filter((v): v is number => v != null)
  const recent7Avg = recent7.length > 0 ? recent7.reduce((a, b) => a + b, 0) / recent7.length : null
  const older7 = values.slice(-14, -7).filter((v): v is number => v != null)
  const older7Avg = older7.length > 0 ? older7.reduce((a, b) => a + b, 0) / older7.length : null
  const trend = recent7Avg != null && older7Avg != null ? ((recent7Avg - older7Avg) / older7Avg) * 100 : null
  return { values, rolling7, avg, trend, dates: sorted.map(r => r.date) }
}

function calcSleepCorrelation(
  sleepHistory: { date: string; score: number | null }[],
  hrvHistory: { date: string; hrv: number | null }[]
) {
  const sleepMap = new Map(sleepHistory.map(r => [r.date, r.score]))
  const hrvMap = new Map(hrvHistory.map(r => [r.date, r.hrv]))
  const pairs: { sleep: number; hrv: number }[] = []
  for (const [date, hrv] of hrvMap) {
    const prevDate = localDateStr(new Date(new Date(date).getTime() - 86400000))
    const sleep = sleepMap.get(prevDate)
    if (hrv != null && sleep != null) pairs.push({ sleep, hrv })
  }
  if (pairs.length < 5) return null
  const n = pairs.length
  const sumX = pairs.reduce((s, p) => s + p.sleep, 0)
  const sumY = pairs.reduce((s, p) => s + p.hrv, 0)
  const sumXY = pairs.reduce((s, p) => s + p.sleep * p.hrv, 0)
  const sumX2 = pairs.reduce((s, p) => s + p.sleep ** 2, 0)
  const sumY2 = pairs.reduce((s, p) => s + p.hrv ** 2, 0)
  const num = n * sumXY - sumX * sumY
  const den = Math.sqrt((n * sumX2 - sumX ** 2) * (n * sumY2 - sumY ** 2))
  const r = den > 0 ? num / den : 0
  return { r: Math.round(r * 100) / 100, n, pairs }
}

type ZoneData = { zone: number; label: string; color: string; minutes: number }

function calcTrainingZones(activities: ActivityDetail[], maxHR: number): ZoneData[] {
  const zones: ZoneData[] = [
    { zone: 1, label: 'Z1 Recovery', color: '#6b7280', minutes: 0 },
    { zone: 2, label: 'Z2 Aerobic', color: '#3b82f6', minutes: 0 },
    { zone: 3, label: 'Z3 Tempo', color: '#21FF00', minutes: 0 },
    { zone: 4, label: 'Z4 Threshold', color: '#f97316', minutes: 0 },
    { zone: 5, label: 'Z5 Max', color: '#FF0000', minutes: 0 },
  ]
  for (const act of activities) {
    if (act.avg_hr == null || act.duration_sec == null) continue
    const pct = act.avg_hr / maxHR
    const z = pct < 0.6 ? 0 : pct < 0.7 ? 1 : pct < 0.8 ? 2 : pct < 0.9 ? 3 : 4
    zones[z].minutes += Math.round(act.duration_sec / 60)
  }
  return zones
}

type PR = { label: string; value: string; date: string }
type PRsByType = Record<string, PR[]>

function calcPersonalRecords(activities: ActivityDetail[]): PRsByType {
  const byType: Record<string, ActivityDetail[]> = {}
  for (const a of activities) {
    const t = friendlyActivityType(a.activity_type)
    if (!byType[t]) byType[t] = []
    byType[t].push(a)
  }
  const result: PRsByType = {}
  for (const [type, acts] of Object.entries(byType)) {
    const prs: PR[] = []
    const withDist = acts.filter(a => a.distance_m != null && a.distance_m > 100)
    if (withDist.length > 0) {
      const best = withDist.reduce((b, a) => (a.distance_m ?? 0) > (b.distance_m ?? 0) ? a : b)
      const km = ((best.distance_m ?? 0) / 1000).toFixed(2)
      prs.push({ label: 'Longest distance', value: `${km} km`, date: best.start_time.split('T')[0] })
    }
    const withPace = acts.filter(a => a.distance_m != null && a.duration_sec != null && a.distance_m > 500)
    if (withPace.length > 0) {
      const best = withPace.reduce((b, a) => {
        const paceA = (a.distance_m ?? 0) / (a.duration_sec ?? 1)
        const paceB = (b.distance_m ?? 0) / (b.duration_sec ?? 1)
        return paceA > paceB ? a : b
      })
      const mps = (best.distance_m ?? 0) / (best.duration_sec ?? 1)
      const secPerKm = 1000 / mps
      const paceMin = Math.floor(secPerKm / 60)
      const paceSec = Math.round(secPerKm % 60)
      prs.push({ label: 'Best pace', value: `${paceMin}:${String(paceSec).padStart(2, '0')} /km`, date: best.start_time.split('T')[0] })
    }
    const withCal = acts.filter(a => a.calories != null && a.calories > 0)
    if (withCal.length > 0) {
      const best = withCal.reduce((b, a) => (a.calories ?? 0) > (b.calories ?? 0) ? a : b)
      prs.push({ label: 'Most calories', value: `${best.calories} kcal`, date: best.start_time.split('T')[0] })
    }
    if (prs.length > 0) result[type] = prs
  }
  return result
}

function calcWeeklySummary(stepsHistory28: { date: string; load: number }[], sleepHistory30: { date: string; score: number | null }[], hrvHistory30: { date: string; hrv: number | null }[], activities90: ActivityDetail[]) {
  const today = new Date()
  const dayOfWeek = (today.getDay() + 6) % 7 // Mon=0
  const thisMonday = new Date(today); thisMonday.setDate(today.getDate() - dayOfWeek)
  const lastMonday = new Date(thisMonday); lastMonday.setDate(thisMonday.getDate() - 7)

  const inRange = (dateStr: string, from: Date, to: Date) => {
    const d = new Date(dateStr); return d >= from && d < to
  }

  const thisWeekSteps = stepsHistory28.filter(r => inRange(r.date, thisMonday, today)).reduce((s, r) => s + r.load, 0)
  const lastWeekSteps = stepsHistory28.filter(r => inRange(r.date, lastMonday, thisMonday)).reduce((s, r) => s + r.load, 0)

  const thisWeekSleep = sleepHistory30.filter(r => inRange(r.date, thisMonday, today)).map(r => r.score).filter((v): v is number => v != null)
  const lastWeekSleep = sleepHistory30.filter(r => inRange(r.date, lastMonday, thisMonday)).map(r => r.score).filter((v): v is number => v != null)

  const thisWeekHRV = hrvHistory30.filter(r => inRange(r.date, thisMonday, today)).map(r => r.hrv).filter((v): v is number => v != null)
  const lastWeekHRV = hrvHistory30.filter(r => inRange(r.date, lastMonday, thisMonday)).map(r => r.hrv).filter((v): v is number => v != null)

  const thisWeekActs = activities90.filter(a => inRange(a.start_time, thisMonday, today)).length
  const lastWeekActs = activities90.filter(a => inRange(a.start_time, lastMonday, thisMonday)).length

  const avg = (arr: number[]) => arr.length > 0 ? Math.round(arr.reduce((a, b) => a + b, 0) / arr.length) : null

  return {
    load: { this: Math.round(thisWeekSteps), last: Math.round(lastWeekSteps) },
    sleep: { this: avg(thisWeekSleep), last: avg(lastWeekSleep) },
    hrv: { this: avg(thisWeekHRV), last: avg(lastWeekHRV) },
    activities: { this: thisWeekActs, last: lastWeekActs },
  }
}

// ─── Pace Trend ──────────────────────────────────────────────────────────────

function calcPaceTrend(activities: ActivityDetail[]): { date: string; paceMinPerKm: number }[] {
  return activities
    .filter(a => {
      const t = friendlyActivityType(a.activity_type).toLowerCase()
      return (t.includes('run') || t.includes('treadmill') || t.includes('jog'))
        && a.distance_m != null && a.distance_m > 500
        && a.duration_sec != null && a.duration_sec > 0
    })
    .map(a => ({
      date: a.start_time.split('T')[0],
      paceMinPerKm: (a.duration_sec! / 60) / (a.distance_m! / 1000),
    }))
    .sort((a, b) => a.date.localeCompare(b.date))
}

// ─── Sleep Debt ───────────────────────────────────────────────────────────────

const SLEEP_TARGET_SEC = 8 * 3600

function calcSleepDebt(durations: (number | null)[]): { debtSec: number; actualSec: number; targetSec: number; nights: number } | null {
  const valid = durations.filter((v): v is number => v != null && v > 0)
  if (valid.length === 0) return null
  const actualSec = valid.reduce((s, v) => s + v, 0)
  const targetSec = SLEEP_TARGET_SEC * valid.length
  return { debtSec: targetSec - actualSec, actualSec, targetSec, nights: valid.length }
}

// ─── Journal / Lifestyle Correlation ─────────────────────────────────────────

const TAG_META: Record<string, { emoji: string; label: string }> = {
  alcohol:       { emoji: '🍺', label: 'Alcohol' },
  late_night:    { emoji: '🌙', label: 'Late Night' },
  high_stress:   { emoji: '😰', label: 'High Stress' },
  travel:        { emoji: '✈️', label: 'Travel' },
  illness:       { emoji: '🤒', label: 'Illness' },
  poor_nutrition:{ emoji: '🍔', label: 'Poor Nutrition' },
  good_nutrition:{ emoji: '🥗', label: 'Good Nutrition' },
  meditation:    { emoji: '🧘', label: 'Meditation' },
  cold_exposure: { emoji: '🧊', label: 'Cold' },
}

type TagCorrelation = {
  tag: string; emoji: string; label: string
  taggedAvg: number; baselineAvg: number; delta: number; n: number
}

function calcTagCorrelations(
  journal: { date: string; tags: string[] }[],
  hrvHistory: { date: string; hrv: number | null }[]
): TagCorrelation[] {
  const hrvMap = new Map(hrvHistory.map(r => [r.date, r.hrv]))
  const allHRVs = hrvHistory.map(r => r.hrv).filter((v): v is number => v != null)
  const overallAvg = allHRVs.length > 0 ? allHRVs.reduce((s, v) => s + v, 0) / allHRVs.length : null
  if (overallAvg == null) return []

  const allTags = new Set<string>()
  for (const j of journal) j.tags.forEach(t => allTags.add(t))

  const results: TagCorrelation[] = []
  for (const tag of allTags) {
    const taggedDates = new Set(journal.filter(j => j.tags.includes(tag)).map(j => j.date))
    const nonTaggedDates = new Set(journal.filter(j => !j.tags.includes(tag)).map(j => j.date))
    const taggedHRVs: number[] = []
    const baselineHRVs: number[] = []
    for (const [date, hrv] of hrvMap) {
      if (hrv == null) continue
      const prevDate = localDateStr(new Date(new Date(date).getTime() - 86400000))
      if (taggedDates.has(prevDate)) taggedHRVs.push(hrv)
      else if (nonTaggedDates.has(prevDate)) baselineHRVs.push(hrv)
    }
    if (taggedHRVs.length < 3) continue
    const taggedAvg = taggedHRVs.reduce((s, v) => s + v, 0) / taggedHRVs.length
    const baselineAvg = baselineHRVs.length >= 2
      ? baselineHRVs.reduce((s, v) => s + v, 0) / baselineHRVs.length
      : overallAvg
    const delta = Math.round((taggedAvg - baselineAvg) * 10) / 10
    const meta = TAG_META[tag] ?? { emoji: '•', label: tag }
    results.push({ tag, emoji: meta.emoji, label: meta.label, taggedAvg: Math.round(taggedAvg), baselineAvg: Math.round(baselineAvg), delta, n: taggedHRVs.length })
  }
  return results.sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta))
}

function friendlyActivityType(raw: string | null): string {
  if (!raw) return 'Other'
  // Python dict (all-caps keys): {'TYPEKEY': 'STRENGTH_TRAINING', ...}
  // Python dict (mixed-case keys): {'TypeKey': 'Strength Training', ...}
  const pyMatch = raw.match(/'typekey':\s*'([^']+)'/i)
  if (pyMatch) {
    return pyMatch[1].split('_').map((w: string) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join(' ')
  }
  // JSON: {"typeKey":"strength_training"}
  const jsonMatch = raw.match(/"typeKey"\s*:\s*"([^"]+)"/i)
  if (jsonMatch) {
    return jsonMatch[1].split('_').map((w: string) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join(' ')
  }
  return raw.replace(/_/g, ' ')
}

// ─── Sleep Debt Card ─────────────────────────────────────────────────────────

function SleepDebtCard({ debt }: { debt: { debtSec: number; actualSec: number; targetSec: number; nights: number } }) {
  const fmtH = (sec: number) => {
    const abs = Math.abs(sec)
    const h = Math.floor(abs / 3600)
    const m = Math.floor((abs % 3600) / 60)
    return h > 0 ? `${h}h ${m}m` : `${m}m`
  }
  const pct = Math.min(100, (debt.actualSec / debt.targetSec) * 100)
  const isDebt = debt.debtSec > 0
  const color = debt.debtSec > 4 * 3600 ? '#FF0000' : debt.debtSec > 2 * 3600 ? '#f97316' : debt.debtSec > 0 ? '#FFFF00' : '#21FF00'

  // Semicircle gauge
  const r = 44, cx = 60, cy = 52
  const circ = Math.PI * r
  const fill = (pct / 100) * circ

  return (
    <div className="rounded-3xl p-6 mb-4" style={{ background: '#111111' }}>
      <div className="flex items-center gap-1 mb-4">
        <p className="text-xs text-gray-500 uppercase tracking-widest">Sleep Debt</p>
        <InfoTip text="Rolling 7-night total vs an 8h/night target. Green = on track, yellow = &lt;2h behind, orange = 2–4h behind, red = 4h+ behind." />
      </div>
      <div className="flex items-center gap-6">
        <div className="relative shrink-0">
          <svg width="120" height="68" viewBox="0 0 120 68">
            <path d={`M ${cx - r} ${cy} A ${r} ${r} 0 0 1 ${cx + r} ${cy}`}
              fill="none" stroke="#1f2937" strokeWidth="12" strokeLinecap="round" />
            <path d={`M ${cx - r} ${cy} A ${r} ${r} 0 0 1 ${cx + r} ${cy}`}
              fill="none" stroke={color} strokeWidth="12" strokeLinecap="round"
              strokeDasharray={`${fill.toFixed(1)} ${circ.toFixed(1)}`}
              style={{ transition: 'stroke-dasharray 1s ease' }} />
          </svg>
          <div className="absolute inset-0 flex flex-col items-center justify-end pb-1">
            <span className="text-lg font-bold leading-none" style={{ color }}>{Math.round(pct)}%</span>
          </div>
        </div>
        <div className="flex-1">
          <p className="text-2xl font-bold leading-none mb-1" style={{ color }}>
            {isDebt ? `−${fmtH(debt.debtSec)}` : `+${fmtH(-debt.debtSec)}`}
          </p>
          <p className="text-xs text-gray-400 mb-2">
            {isDebt ? `behind target · ${debt.nights}-night window` : `sleep surplus · ${debt.nights}-night window`}
          </p>
          <div className="space-y-0.5">
            <p className="text-[10px] text-gray-500">Got: <span className="text-gray-300">{fmtH(debt.actualSec)}</span></p>
            <p className="text-[10px] text-gray-500">Target: <span className="text-gray-300">{fmtH(debt.targetSec)}</span> ({debt.nights}×8h)</p>
          </div>
        </div>
      </div>
    </div>
  )
}

// ─── Lifestyle Impact Card ────────────────────────────────────────────────────

function LifestyleImpactCard({ correlations }: { correlations: TagCorrelation[] }) {
  if (correlations.length === 0) return (
    <div className="rounded-3xl p-5 mb-4" style={{ background: '#111111' }}>
      <div className="flex items-center gap-1 mb-1">
        <p className="text-xs text-gray-500 uppercase tracking-widest">Lifestyle Impact on HRV</p>
        <InfoTip text="Log lifestyle factors on your dashboard daily. Once you have 3+ occurrences of a tag, this card shows how each factor affects your next-morning HRV." />
      </div>
      <p className="text-xs text-gray-600 mt-2">
        No data yet. Log lifestyle tags on the dashboard for at least 3 nights to reveal patterns.
      </p>
    </div>
  )
  const maxAbs = Math.max(...correlations.map(c => Math.abs(c.delta)), 1)
  return (
    <div className="rounded-3xl p-5 mb-4" style={{ background: '#111111' }}>
      <div className="flex items-center gap-1 mb-1">
        <p className="text-xs text-gray-500 uppercase tracking-widest">Lifestyle Impact on HRV</p>
        <InfoTip text="Average next-morning HRV on nights you logged each tag vs your baseline. Negative = that factor lowers your HRV. Needs ≥3 logged occurrences per tag." />
      </div>
      <p className="text-[10px] text-gray-600 mb-4">Next-day HRV after logging each factor</p>
      <div className="space-y-4">
        {correlations.map(c => {
          const barPct = (Math.abs(c.delta) / maxAbs) * 100
          const isNeg = c.delta < 0
          return (
            <div key={c.tag}>
              <div className="flex items-center justify-between mb-1">
                <span className="text-sm">{c.emoji} <span className="text-xs text-gray-300">{c.label}</span></span>
                <span className="text-xs font-semibold" style={{ color: isNeg ? '#FF0000' : '#21FF00' }}>
                  {isNeg ? '' : '+'}{c.delta}ms <span className="text-gray-600 font-normal">({c.n}×)</span>
                </span>
              </div>
              <div className="w-full bg-gray-800 rounded-full h-2">
                <div className="h-2 rounded-full" style={{ width: `${barPct}%`, background: isNeg ? '#FF0000' : '#21FF00', opacity: 0.75 }} />
              </div>
              <p className="text-[10px] text-gray-600 mt-0.5">{c.taggedAvg}ms avg · baseline {c.baselineAvg}ms</p>
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ─── Info Tooltip ─────────────────────────────────────────────────────────────

function InfoTip({ text }: { text: string }) {
  return (
    <span className="relative group inline-flex items-center ml-1 align-middle">
      <span className="text-gray-600 hover:text-gray-400 cursor-help text-[11px] select-none">ⓘ</span>
      <span className="absolute bottom-full left-1/2 -translate-x-1/2 mb-1.5 w-52 bg-gray-800 border border-gray-700 text-[10px] text-gray-300 rounded-xl p-2.5 shadow-xl opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none z-50 leading-relaxed">
        {text}
      </span>
    </span>
  )
}

// ─── Training Readiness Helpers ───────────────────────────────────────────────

function readinessColor(score: number): string {
  if (score >= 75) return '#21FF00'
  if (score >= 50) return '#f97316'
  return '#FF0000'
}

function trainingStatusColor(phase: string): string {
  const p = phase.toUpperCase()
  if (p.includes('PEAK')) return '#21FF00'
  if (p.includes('PRODUCT')) return '#3b82f6'
  if (p.includes('MAINTAIN')) return '#22c55e'
  if (p.includes('RECOVERY')) return '#f97316'
  if (p.includes('OVER')) return '#FF0000'
  if (p.includes('DETRAIN')) return '#9ca3af'
  return '#9ca3af'
}

function trainingStatusDesc(phase: string): string {
  const p = phase.toUpperCase()
  if (p.includes('PEAK')) return 'Peak fitness — race-ready'
  if (p.includes('PRODUCT')) return 'Building fitness effectively'
  if (p.includes('MAINTAIN')) return 'Holding current fitness level'
  if (p.includes('RECOVERY')) return 'Body adapting from hard training'
  if (p.includes('OVER')) return 'Too much stress — rest needed'
  if (p.includes('DETRAIN')) return 'Fitness may be declining'
  return 'Monitoring training load'
}

function readinessLabel(score: number | null, label: string | null): string {
  if (label) {
    const l = label.toUpperCase()
    if (l.includes('PRIME') || l.includes('EXCELLENT')) return 'Prime'
    if (l.includes('GOOD') || l.includes('HIGH')) return 'Good'
    if (l.includes('FAIR') || l.includes('MODERATE')) return 'Fair'
    if (l.includes('LOW') || l.includes('POOR')) return 'Low'
  }
  if (score == null) return '—'
  if (score >= 75) return 'Prime'
  if (score >= 50) return 'Good'
  if (score >= 25) return 'Fair'
  return 'Low'
}

// ─── Chart Components ─────────────────────────────────────────────────────────

function SparkLine({ values, color = '#f97316', height = 48 }: { values: (number | null)[]; color?: string; height?: number }) {
  const valid = values.filter((v): v is number => v != null)
  if (valid.length < 2) return <div className="flex items-center justify-center text-xs text-gray-600" style={{ height }}>No data</div>
  const min = Math.min(...valid)
  const max = Math.max(...valid)
  const range = max - min || 1
  const w = 300, h = height
  const pts = values.map((v, i) => ({
    x: (i / (values.length - 1)) * w,
    y: v != null ? h - ((v - min) / range) * (h - 4) - 2 : null,
  })).filter((p): p is { x: number; y: number } => p.y != null)
  const d = pts.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ')
  return (
    <svg viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" className="w-full" style={{ height }}>
      <path d={d} fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

function HorizBar({ value, max, color }: { value: number; max: number; color: string }) {
  const pct = Math.min(100, max > 0 ? (value / max) * 100 : 0)
  return (
    <div className="w-full bg-gray-800 rounded-full h-2">
      <div className="h-2 rounded-full transition-all" style={{ width: `${pct}%`, background: color }} />
    </div>
  )
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
      <circle cx={cx} cy={cy} r={rOuter} fill="none" stroke="#1f1f1f" strokeWidth={swOuter} />
      <circle cx={cx} cy={cy} r={rInner} fill="none" stroke="#1f1f1f" strokeWidth={swInner} />
      <circle cx={cx} cy={cy} r={rOuter} fill="none" stroke={color} strokeWidth={swOuter} strokeLinecap="round"
        strokeDasharray={`${recPct * circumOuter} ${circumOuter}`} transform={`rotate(-90 ${cx} ${cy})`} />
      <circle cx={cx} cy={cy} r={rInner} fill="none" stroke="#3b82f6" strokeWidth={swInner} strokeLinecap="round"
        strokeDasharray={`${strainPct * circumInner} ${circumInner}`} transform={`rotate(-90 ${cx} ${cy})`} />
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
  const [view, setView] = useState<'today' | 'analytics'>('today')
  const [analyticsTab, setAnalyticsTab] = useState<'trends' | 'training' | 'records'>('trends')
  // Weekly planner
  const [currentUserId, setCurrentUserId] = useState<string | null>(null)
  const [weeklyPlan, setWeeklyPlan] = useState<WeeklyPlan | null>(null)
  const [planLoading, setPlanLoading] = useState(false)
  const [expandedDay, setExpandedDay] = useState<string | null>(null)
  // Race goal
  const [raceGoal, setRaceGoal] = useState<RaceGoal | null>(null)
  const [showRaceModal, setShowRaceModal] = useState(false)
  const [raceForm, setRaceForm] = useState({ name: '', distance_km: '5', target_time: '', race_date: '' })
  const [savingRace, setSavingRace] = useState(false)

  const loadData = useCallback(async () => {
    const { data: sessionData } = await supabase.auth.getSession()
    const user = sessionData.session?.user
    if (!user) { router.push('/login'); return }

    const userId = user.id
    const today = localDateStr(new Date())
    const fourteenAgo = localDateStr(new Date(Date.now() - 13 * 86400000))
    const sevenAgo = localDateStr(new Date(Date.now() - 6 * 86400000))
    const thirtyAgo = localDateStr(new Date(Date.now() - 29 * 86400000))
    const twentyEightAgo = localDateStr(new Date(Date.now() - 27 * 86400000))
    const ninetyAgo = new Date(Date.now() - 89 * 86400000).toISOString()

    const [
      todayHealthRes,
      history14Res,
      todayLegacyRes,
      history7LegacyRes,
      sleepRes,
      stepsRes,
      activitiesRes,
      profileRes,
      // Analytics data
      hrv30Res,
      steps28Res,
      sleep30Res,
      journalRes,
      acts90Res,
    ] = await Promise.all([
      supabase.from('garmin_daily_health_metrics')
        .select('hrv_avg, hrv_status, respiration_avg_bpm, stress_avg, body_battery_end, training_readiness_score, training_readiness_label, training_status_phase')
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
        .select('date_of_birth, display_name, name, weekly_plan, race_goal')
        .eq('user_id', userId).maybeSingle(),
      // Analytics
      supabase.from('garmin_daily_health_metrics')
        .select('metric_date, hrv_avg')
        .eq('user_id', userId).gte('metric_date', thirtyAgo).order('metric_date'),
      supabase.from('garmin_daily_steps')
        .select('step_date, moderate_intensity_minutes, vigorous_intensity_minutes, active_minutes')
        .eq('user_id', userId).gte('step_date', twentyEightAgo).order('step_date'),
      supabase.from('garmin_sleep_data')
        .select('sleep_date, sleep_score, sleep_duration_seconds')
        .eq('user_id', userId).gte('sleep_date', thirtyAgo).order('sleep_date'),
      supabase.from('daily_journal')
        .select('journal_date, tags')
        .eq('user_id', userId).gte('journal_date', thirtyAgo).order('journal_date'),
      supabase.from('garmin_activities')
        .select('activity_type, duration_sec, distance_m, avg_hr, max_hr, calories, start_time')
        .eq('user_id', userId).gte('start_time', ninetyAgo).order('start_time', { ascending: false }).limit(100),
    ])

    const todayHealth = todayHealthRes.data
    const history14 = history14Res.data ?? []
    const todayLegacy = todayLegacyRes.data
    const history7Legacy = history7LegacyRes.data ?? []
    const sleep = sleepRes.data
    const steps = stepsRes.data
    const activities = (activitiesRes.data ?? []) as RawActivity[]
    const profile = profileRes.data as { date_of_birth?: string | null; display_name?: string | null; name?: string | null; weekly_plan?: WeeklyPlan | null; race_goal?: RaceGoal | null } | null

    const rhr = (todayLegacy as { resting_hr?: number | null; resting_heart_rate_bpm?: number | null } | null)
      ?.resting_hr ?? (todayLegacy as { resting_heart_rate_bpm?: number | null } | null)?.resting_heart_rate_bpm ?? null

    const rhrHistory = (history7Legacy as { resting_hr?: number | null; resting_heart_rate_bpm?: number | null }[])
      .map(r => r.resting_hr ?? r.resting_heart_rate_bpm ?? null)
      .filter((v): v is number => v != null)
    const rhrBaseline = rhrHistory.length > 0
      ? rhrHistory.reduce((a, b) => a + b, 0) / rhrHistory.length : null

    const respirationHistory = history14.map(r => (r as { respiration_avg_bpm?: number | null }).respiration_avg_bpm ?? null)

    const vo2max = activities.reduce<number | null>((best, a) => {
      const raw = a.raw_payload
      const v = raw?.vO2MaxValue ?? raw?.vo2MaxValue
      if (typeof v === 'number' && v > 0) return best == null ? v : Math.max(best, v)
      return best
    }, null)

    // Analytics data
    const hrv30 = (hrv30Res.data ?? []) as { metric_date: string; hrv_avg: number | null }[]
    const steps28 = (steps28Res.data ?? []) as { step_date: string; moderate_intensity_minutes: number | null; vigorous_intensity_minutes: number | null; active_minutes: number | null }[]
    const sleep30 = (sleep30Res.data ?? []) as { sleep_date: string; sleep_score: number | null; sleep_duration_seconds: number | null }[]
    const journal30 = (journalRes.data ?? []) as { journal_date: string; tags: string[] }[]
    const acts90 = (acts90Res.data ?? []) as ActivityDetail[]

    const stepsHistory28 = steps28.map(r => {
      const mod = r.moderate_intensity_minutes ?? 0
      const vig = r.vigorous_intensity_minutes ?? 0
      const active = r.active_minutes ?? 0
      const load = mod > 0 || vig > 0 ? mod + vig * 2 : active * 0.6
      return { date: r.step_date, load }
    })

    setCurrentUserId(userId)
    setWeeklyPlan((profile?.weekly_plan as WeeklyPlan | null) ?? null)
    setRaceGoal((profile?.race_goal as RaceGoal | null) ?? null)

    setData({
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
      rhr, rhrBaseline, respirationHistory, vo2max,
      dob: profile?.date_of_birth ?? null,
      displayName: profile?.display_name ?? profile?.name ?? null,
      trainingReadinessScore: (todayHealth as { training_readiness_score?: number | null } | null)?.training_readiness_score ?? null,
      trainingReadinessLabel: (todayHealth as { training_readiness_label?: string | null } | null)?.training_readiness_label ?? null,
      trainingStatusPhase: (todayHealth as { training_status_phase?: string | null } | null)?.training_status_phase ?? null,
      hrvHistory30: hrv30.map(r => ({ date: r.metric_date, hrv: r.hrv_avg })),
      stepsHistory28,
      sleepHistory30: sleep30.map(r => ({ date: r.sleep_date, score: r.sleep_score })),
      sleepHistory7durations: sleep30.slice(-7).map(r => r.sleep_duration_seconds ?? null),
      activities90: acts90,
      journalHistory: journal30.map(r => ({ date: r.journal_date, tags: r.tags })),
    })
    setLoading(false)
  }, [router])

  useEffect(() => { loadData() }, [loadData])

  const fetchBriefing = useCallback(async () => {
    if (!data || briefingLoading) return
    setBriefingLoading(true)
    try {
      const recovery = calcRecovery(data.hrv, data.sleepScore, data.rhr, data.hrvStatus)
      const strain = calcStrain(data.modIntMin, data.vigIntMin, data.activeMin)
      const warning = detectEarlyWarning(data.respiration ?? data.sleepRespiration, data.respirationHistory)
      const res = await fetch('/api/ai/snapshot', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          mode: 'health-engine',
          recovery, strain,
          hrv: data.hrv,
          sleepScore: data.sleepScore,
          respiration: data.respiration ?? data.sleepRespiration,
          respirationBaseline: warning.baseline || null,
          bodyBatteryEnd: data.bodyBatteryEnd ?? null,
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

  const generatePlan = async () => {
    if (!data || planLoading) return
    setPlanLoading(true)
    try {
      const acwrResult = calcACWR(data.stepsHistory28)
      const hrvTrendResult = calcHRVTrend(data.hrvHistory30)
      const recovery = calcRecovery(data.hrv, data.sleepScore, data.rhr, data.hrvStatus)
      const strain = calcStrain(data.modIntMin, data.vigIntMin, data.activeMin)
      const recentActivities = data.activities90.slice(0, 7).map(a => ({
        type: friendlyActivityType(a.activity_type),
        durationMin: a.duration_sec ? Math.round(a.duration_sec / 60) : null,
        date: a.start_time.split('T')[0],
      }))
      const res = await fetch('/api/ai/weekly-plan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          acwr: acwrResult?.acwr ?? null,
          hrvTrend: hrvTrendResult?.trend ?? null,
          recovery,
          strain,
          bodyBattery: data.bodyBatteryEnd ?? null,
          recentActivities,
        }),
      })
      if (!res.ok) return
      const json = await res.json() as WeeklyPlan
      setWeeklyPlan(json)
      setExpandedDay(null)
      if (currentUserId) {
        await supabase.from('profiles').upsert({ user_id: currentUserId, weekly_plan: json }, { onConflict: 'user_id' })
      }
    } finally {
      setPlanLoading(false)
    }
  }

  const saveRaceGoal = async () => {
    if (!currentUserId) return
    setSavingRace(true)
    try {
      const [hh, mm, ss] = raceForm.target_time.split(':').map(Number)
      const target_sec = (hh || 0) * 3600 + (mm || 0) * 60 + (ss || 0)
      const goal: RaceGoal = {
        name: raceForm.name,
        distance_km: parseFloat(raceForm.distance_km),
        target_sec,
        race_date: raceForm.race_date,
      }
      await supabase.from('profiles').upsert({ user_id: currentUserId, race_goal: goal }, { onConflict: 'user_id' })
      setRaceGoal(goal)
      setShowRaceModal(false)
    } finally {
      setSavingRace(false)
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ background: '#0a0a0a' }}>
        <div className="w-8 h-8 border-2 border-gray-600 border-t-white rounded-full animate-spin" />
      </div>
    )
  }

  const recovery = data ? calcRecovery(data.hrv, data.sleepScore, data.rhr, data.hrvStatus) : null
  const strain = data ? calcStrain(data.modIntMin, data.vigIntMin, data.activeMin) : 0
  const color = recoveryColor(recovery)
  const label = recoveryLabel(recovery)
  const warning = data ? detectEarlyWarning(data.respiration ?? data.sleepRespiration, data.respirationHistory) : { triggered: false, pct: 0, baseline: 0 }
  const overreaching = recovery != null && recovery < 30 && strain > 10
  const bioAge = data ? calcBioAge(data.dob, data.vo2max, data.rhr, data.rhrBaseline, data.deepSleepSeconds, data.sleepDurationSeconds) : null
  const chronoAge = data?.dob ? Math.floor((Date.now() - new Date(data.dob).getTime()) / (365.25 * 24 * 3600 * 1000)) : null
  const hour = new Date().getHours()
  const briefingLabel = hour < 12 ? '🌅 Morning Briefing' : hour < 18 ? '☀️ Afternoon Check-in' : '🌙 Evening Briefing'
  // Late-day override: recovery is a morning metric — if it's afternoon/evening, strain is high,
  // and body battery is depleted, the "push harder" advice is no longer valid.
  const bodyBattery = data?.bodyBatteryEnd ?? null
  const lateDayDone = hour >= 14 && strain > 12 && bodyBattery != null && bodyBattery < 45
  const fmt = (sec: number | null) => sec != null ? `${Math.floor(sec / 3600)}h ${Math.floor((sec % 3600) / 60)}m` : '—'

  // Analytics computations
  const acwr = data ? calcACWR(data.stepsHistory28) : null
  const hrvTrend = data ? calcHRVTrend(data.hrvHistory30) : null
  const sleepCorr = data ? calcSleepCorrelation(data.sleepHistory30, data.hrvHistory30) : null
  const sleepDebt = data ? calcSleepDebt(data.sleepHistory7durations) : null
  const tagCorrelations = data ? calcTagCorrelations(data.journalHistory, data.hrvHistory30) : []
  const estimatedMaxHR = chronoAge != null ? 220 - chronoAge : 185
  const zones = data ? calcTrainingZones(data.activities90, estimatedMaxHR) : []
  const maxZoneMin = zones.length > 0 ? Math.max(...zones.map(z => z.minutes), 1) : 1
  const prs = data ? calcPersonalRecords(data.activities90) : {}
  const weeklySummary = data ? calcWeeklySummary(data.stepsHistory28, data.sleepHistory30, data.hrvHistory30, data.activities90) : null

  // HRV Drop Alert: compare today's HRV to prior 7-day rolling average
  const hrv7Avg = (hrvTrend?.rolling7 ?? []).slice(-8, -1).filter((v): v is number => v != null)
  const hrv7Mean = hrv7Avg.length > 0 ? hrv7Avg.reduce((a, b) => a + b, 0) / hrv7Avg.length : null
  const hrvDropPct = data?.hrv != null && hrv7Mean != null && hrv7Mean > 0
    ? ((data.hrv - hrv7Mean) / hrv7Mean) * 100 : null
  const hrvAlert = hrvDropPct != null && hrvDropPct < -12

  // Pace trend for running activities over 90 days
  const paceTrend = data ? calcPaceTrend(data.activities90) : []
  const paceTrendValues = paceTrend.map(p => p.paceMinPerKm)
  const bestPaceMinPerKm = paceTrend.length > 0 ? Math.min(...paceTrendValues) : null
  const avgPaceMinPerKm = paceTrend.length > 0 ? paceTrendValues.reduce((a, b) => a + b, 0) / paceTrendValues.length : null
  const fmtPace = (minPerKm: number | null) => {
    if (minPerKm == null) return '—'
    const m = Math.floor(minPerKm)
    const s = Math.round((minPerKm - m) * 60)
    return `${m}:${String(s).padStart(2, '0')} /km`
  }
  // Invert for sparkline — faster (lower) pace should appear higher on chart
  const paceTrendInverted = paceTrend.length > 0
    ? (() => {
        const maxPace = Math.max(...paceTrendValues)
        return paceTrendValues.map(p => maxPace - p + (bestPaceMinPerKm ?? 0))
      })()
    : []

  // Race goal helpers
  const daysUntilRace = raceGoal?.race_date
    ? Math.ceil((new Date(raceGoal.race_date).getTime() - Date.now()) / 86400000) : null
  const fmtSec = (sec: number) => {
    const h = Math.floor(sec / 3600)
    const m = Math.floor((sec % 3600) / 60)
    const s = sec % 60
    return h > 0 ? `${h}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}` : `${m}:${String(s).padStart(2,'0')}`
  }
  const estFinishSec = raceGoal && avgPaceMinPerKm
    ? Math.round(avgPaceMinPerKm * 60 * raceGoal.distance_km) : null
  const targetDeltaSec = estFinishSec != null && raceGoal ? estFinishSec - raceGoal.target_sec : null

  const tabBtn = (key: typeof view, lbl: string) => (
    <button
      type="button"
      onClick={() => setView(key)}
      className={`flex-1 py-2 text-xs font-semibold rounded-xl transition-colors ${view === key ? 'bg-orange-600 text-white' : 'text-gray-400 hover:text-white'}`}
    >
      {lbl}
    </button>
  )

  const aTabBtn = (key: typeof analyticsTab, lbl: string) => (
    <button
      type="button"
      onClick={() => setAnalyticsTab(key)}
      className={`flex-1 py-1.5 text-xs rounded-lg transition-colors ${analyticsTab === key ? 'bg-gray-700 text-white' : 'text-gray-500 hover:text-gray-300'}`}
    >
      {lbl}
    </button>
  )

  return (
    <div className="min-h-screen pb-20 text-white" style={{ background: '#0a0a0a' }}>
      <div className="max-w-md mx-auto px-4 pt-6">

        {/* Header */}
        <div className="mb-4">
          <p className="text-xs text-gray-500 uppercase tracking-widest mb-1">
            {new Date().toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' })}
          </p>
          <h1 className="text-2xl font-bold">Health Engine</h1>
          {data?.displayName && <p className="text-sm text-gray-400 mt-0.5">{data.displayName}</p>}
        </div>

        {/* View toggle */}
        <div className="flex gap-1 bg-gray-900 rounded-2xl p-1 mb-5">
          {tabBtn('today', 'Today')}
          {tabBtn('analytics', 'Analytics')}
        </div>

        {/* ── TODAY VIEW ─────────────────────────────────────────────────── */}
        {view === 'today' && (
          <>
            {overreaching && (
              <div className="mb-4 rounded-2xl p-4 border border-red-500/50 bg-red-950/40">
                <p className="text-sm font-bold text-red-400 mb-1">⚠️ High Risk of Overreaching</p>
                <p className="text-xs text-red-300">Recovery is critically low ({Math.round(recovery!)}%) while strain is high ({strain.toFixed(1)}). Prioritise full rest today.</p>
              </div>
            )}
            {lateDayDone && !overreaching && (
              <div className="mb-4 rounded-2xl p-4 border border-amber-500/40 bg-amber-950/30">
                <p className="text-sm font-bold text-amber-400 mb-1">🏁 Training Done for Today</p>
                <p className="text-xs text-amber-300">Your body battery is at {bodyBattery} and strain is {strain.toFixed(1)} — you&apos;ve already put in a big day. Your morning recovery score ({recovery != null ? `${Math.round(recovery)}%` : '—'}) was from before you trained. Prioritise rest, food, and sleep tonight.</p>
              </div>
            )}
            {hrvAlert && !overreaching && (
              <div className="mb-4 rounded-2xl p-4 border border-yellow-500/40 bg-yellow-950/30">
                <p className="text-sm font-bold text-yellow-400 mb-1">⚡ HRV Drop Detected</p>
                <p className="text-xs text-yellow-300">
                  Your HRV is {data?.hrv}ms — {Math.abs(Math.round(hrvDropPct!))}% below your 7-day average ({Math.round(hrv7Mean!)}ms). This often signals accumulated fatigue. Consider an easy or rest day.
                </p>
              </div>
            )}

            <div className="rounded-3xl p-6 mb-4 flex flex-col items-center" style={{ background: '#111111' }}>
              <div className="flex items-center gap-1 mb-1">
                <p className="text-xs text-gray-500 uppercase tracking-widest">Recovery & Strain</p>
                <InfoTip text="Two rings showing your daily readiness and physical load. Outer ring = Recovery (how ready your body is). Inner arc = Strain (how hard you've worked today)." />
              </div>
              <p className="text-[10px] text-gray-600 mb-4">How ready is your body vs how hard you&apos;ve worked</p>
              <RecoveryStrainRing recovery={recovery} strain={strain} />
              <div className="w-full mt-4 rounded-2xl p-4" style={{ background: '#1a1a1a' }}>
                <div className="flex items-start justify-between mb-1">
                  <div>
                    <span className="text-2xl font-bold" style={{ color }}>{recovery != null ? `${Math.round(recovery)}%` : '—'}</span>
                    <span className="text-xs text-gray-500 ml-2 uppercase tracking-wider">{label}</span>
                  </div>
                  <div className="w-2 h-2 rounded-full mt-2" style={{ background: color }} />
                </div>
                <p className="text-[11px] text-gray-400 leading-relaxed">
                  {recovery == null ? 'Not enough data to calculate recovery.'
                    : lateDayDone
                    ? `This morning's recovery was ${Math.round(recovery)}% — but you've since trained hard (strain ${strain.toFixed(1)}) and your body battery is now ${bodyBattery}. This score reflects how you started the day, not where you are now. Rest and recover tonight.`
                    : recovery >= 67 ? 'Your body is well recovered. Green light for a hard training session today.'
                    : recovery >= 34 ? 'Partially recovered. Moderate training is fine — avoid pushing to your limit.'
                    : 'Low recovery. Your body needs rest more than it needs training today.'}
                </p>
              </div>
              <div className="w-full mt-2 rounded-2xl p-4" style={{ background: '#1a1a1a' }}>
                <div className="flex items-start justify-between mb-1">
                  <div>
                    <span className="text-2xl font-bold text-blue-400">{strain.toFixed(1)}</span>
                    <span className="text-xs text-gray-500 ml-2">out of 21</span>
                  </div>
                  <div className="w-2 h-2 rounded-full mt-2 bg-blue-500" />
                </div>
                <p className="text-[11px] text-gray-400 leading-relaxed">
                  Strain measures today&apos;s physical load on a 0–21 scale.{' '}
                  {strain < 7 ? 'Light day — minimal physical demand.' : strain < 14 ? 'Moderate load — a solid training day.' : 'High load — your body has been pushed hard today.'}
                  {' '}Calculated from intensity minutes.
                </p>
              </div>
              {data?.hrvStatus && <p className="mt-3 text-xs text-gray-500">HRV Status: <span className="text-gray-300">{data.hrvStatus}</span></p>}
            </div>

            <div className="grid grid-cols-3 gap-3 mb-4">
              <div className="rounded-2xl p-4" style={{ background: '#111111' }}>
                <div className="flex items-center gap-0.5 mb-2">
                <p className="text-[10px] text-gray-500 uppercase tracking-wider">Sleep</p>
                <InfoTip text="Total sleep duration and Garmin sleep score (0–100). Score combines duration, sleep stages, and disturbances. Deep sleep % shows restorative slow-wave sleep — aim for >20%." />
              </div>
                <p className="text-lg font-bold text-white">{fmt(data?.sleepDurationSeconds ?? null)}</p>
                <p className="text-[10px] text-gray-400 mt-1">Score <span className="text-white font-semibold">{data?.sleepScore ?? '—'}</span></p>
                {data?.deepSleepSeconds != null && data.sleepDurationSeconds != null && (
                  <p className="text-[10px] text-gray-500 mt-0.5">Deep {Math.round((data.deepSleepSeconds / data.sleepDurationSeconds) * 100)}%</p>
                )}
              </div>
              <div className="rounded-2xl p-4" style={{ background: '#111111' }}>
                <div className="flex items-center gap-0.5 mb-2">
                <p className="text-[10px] text-gray-500 uppercase tracking-wider">HRV</p>
                <InfoTip text="Heart Rate Variability — the variation in time between heartbeats (ms). Higher = more recovered. RHR is Resting Heart Rate; elevated RHR vs baseline is a fatigue signal." />
              </div>
                <p className="text-lg font-bold text-white">{data?.hrv != null ? `${data.hrv}ms` : '—'}</p>
                <p className="text-[10px] text-gray-400 mt-1">RHR <span className="text-white font-semibold">{data?.rhr != null ? `${data.rhr}bpm` : '—'}</span></p>
                {data?.rhrBaseline != null && data.rhr != null && (
                  <p className="text-[10px] mt-0.5" style={{ color: data.rhr > data.rhrBaseline + 5 ? '#FF0000' : '#9ca3af' }}>
                    Base {Math.round(data.rhrBaseline)}bpm
                  </p>
                )}
              </div>
              <div className="rounded-2xl p-4" style={{ background: '#111111' }}>
                <div className="flex items-center gap-0.5 mb-2">
                <p className="text-[10px] text-gray-500 uppercase tracking-wider">Respiration</p>
                <InfoTip text="Breaths per minute (brpm). Elevated respiration rate vs your 14-day baseline can be an early sign of illness or overtraining — often shows up before you feel symptoms." />
              </div>
                <p className="text-lg font-bold" style={{ color: warning.triggered ? '#FF0000' : 'white' }}>
                  {data?.respiration != null ? `${data.respiration.toFixed(1)}` : data?.sleepRespiration != null ? `${data.sleepRespiration.toFixed(1)}` : '—'}
                </p>
                <p className="text-[10px] text-gray-400 mt-1">brpm</p>
                <p className="text-[10px] mt-0.5" style={{ color: warning.triggered ? '#FF0000' : '#9ca3af' }}>
                  {warning.triggered ? `+${warning.pct.toFixed(0)}%` : 'Stable'}
                </p>
              </div>
            </div>

            {/* Garmin Training Readiness + Status */}
            {(data?.trainingReadinessScore != null || data?.trainingStatusPhase) && (
              <div className="rounded-3xl p-6 mb-4" style={{ background: '#111111' }}>
                <div className="flex items-center gap-1 mb-4">
                  <p className="text-xs text-gray-500 uppercase tracking-widest">Training Readiness</p>
                  <InfoTip text="Garmin's official readiness score (0–100) calculated from HRV, sleep quality, recent training load, and recovery time. Also shows your current training phase from Garmin's performance analytics." />
                </div>
                <div className="flex gap-4 items-start">
                  {data.trainingReadinessScore != null && (
                    <div className="shrink-0">
                      <p className="text-5xl font-bold leading-none" style={{ color: readinessColor(data.trainingReadinessScore) }}>
                        {data.trainingReadinessScore}
                      </p>
                      <p className="text-xs text-gray-500 mt-1">/ 100</p>
                      <p className="text-xs font-semibold mt-1" style={{ color: readinessColor(data.trainingReadinessScore) }}>
                        {readinessLabel(data.trainingReadinessScore, data.trainingReadinessLabel)}
                      </p>
                    </div>
                  )}
                  {data.trainingStatusPhase && (
                    <div className="flex-1 rounded-2xl p-3" style={{ background: '#1a1a1a' }}>
                      <p className="text-[10px] text-gray-500 uppercase tracking-wider mb-1">Training Phase</p>
                      <p className="text-sm font-bold" style={{ color: trainingStatusColor(data.trainingStatusPhase) }}>
                        {data.trainingStatusPhase.replace(/_/g, ' ')}
                      </p>
                      <p className="text-[10px] text-gray-500 mt-1 leading-relaxed">
                        {trainingStatusDesc(data.trainingStatusPhase)}
                      </p>
                    </div>
                  )}
                  {data.trainingReadinessScore != null && !data.trainingStatusPhase && (
                    <div className="flex-1 rounded-2xl p-3" style={{ background: '#1a1a1a' }}>
                      <p className="text-[10px] text-gray-500 mb-1">What this means</p>
                      <p className="text-xs text-gray-400 leading-relaxed">
                        {data.trainingReadinessScore >= 75
                          ? 'Your body is primed. This is an ideal day for a high-quality or hard training session.'
                          : data.trainingReadinessScore >= 50
                          ? 'Good to train. Moderate intensity sessions are well-supported today.'
                          : 'Lower readiness. A light or easy session is recommended — avoid pushing hard.'}
                      </p>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Sleep Debt */}
            {sleepDebt && <SleepDebtCard debt={sleepDebt} />}

            {warning.triggered && (
              <div className="mb-4 rounded-2xl p-4 border border-red-500/60" style={{ background: 'rgba(127,0,0,0.25)', boxShadow: '0 0 20px rgba(255,0,0,0.15)' }}>
                <p className="text-sm font-bold text-red-400 mb-2">🦠 Anomaly Detected</p>
                <p className="text-xs text-red-200">
                  Your respiration rate is {warning.pct.toFixed(0)}% above your 14-day baseline ({warning.baseline.toFixed(1)} brpm). This may indicate your body is fighting an infection. Consider a full rest day and monitor tomorrow.
                </p>
              </div>
            )}

            <div className="rounded-3xl p-6 mb-4" style={{ background: '#111111' }}>
              <div className="flex items-center gap-1 mb-4">
                <p className="text-xs text-gray-500 uppercase tracking-widest">Biological Age</p>
                <InfoTip text="An estimate of your body's functional age based on fitness markers. VO2 max in the top 20% for your age = −2yr. Elevated resting HR vs baseline = +1yr. Consistent deep sleep >20% = −1yr." />
              </div>
              {bioAge ? (
                <>
                  <div className="text-center mb-4">
                    <p className="text-5xl font-bold" style={{ color: bioAge.bioAge < (chronoAge ?? 99) ? '#21FF00' : bioAge.bioAge > (chronoAge ?? 0) ? '#FF0000' : '#FFFF00' }}>
                      {bioAge.bioAge}
                    </p>
                    <p className="text-sm text-gray-400 mt-2">
                      {bioAge.bioAge === chronoAge ? `Same as your chronological age of ${chronoAge}`
                        : bioAge.bioAge < (chronoAge ?? 99) ? `${(chronoAge ?? 0) - bioAge.bioAge} year${(chronoAge ?? 0) - bioAge.bioAge !== 1 ? 's' : ''} younger than your chronological age of ${chronoAge}`
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
                  <button onClick={() => router.push('/profile')} className="text-xs px-4 py-2 rounded-lg border border-gray-600 text-gray-300 hover:border-gray-400">
                    Add DOB in Profile
                  </button>
                </div>
              )}
            </div>

            <div className="rounded-3xl p-6 mb-4" style={{ background: '#111111' }}>
              <div className="flex items-center gap-1 mb-3">
                <p className="text-xs text-gray-500 uppercase tracking-widest">{briefingLabel}</p>
                <InfoTip text="AI coach summary generated from your recovery, strain, HRV, and sleep data. Two sentences: your current state and one specific recommendation." />
              </div>
              {briefingLoading ? (
                <div className="flex items-center gap-2">
                  <div className="w-4 h-4 border border-gray-600 border-t-white rounded-full animate-spin" />
                  <span className="text-xs text-gray-500">Analysing your data…</span>
                </div>
              ) : briefing ? (
                <p className="text-sm text-gray-200 leading-relaxed">{briefing}</p>
              ) : (
                <button onClick={fetchBriefing} className="text-xs px-4 py-2 rounded-lg border border-gray-600 text-gray-300 hover:border-gray-400">
                  Generate Briefing
                </button>
              )}
            </div>

            {/* Weekly Training Planner */}
            <div className="rounded-3xl p-6 mb-4" style={{ background: '#111111' }}>
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-1">
                  <p className="text-xs text-gray-500 uppercase tracking-widest">📅 This Week&apos;s Plan</p>
                  <InfoTip text="AI-generated 7-day training plan based on your ACWR, HRV trend, recovery score, and recent activity history. Regenerate each week." />
                </div>
                <button
                  onClick={generatePlan}
                  disabled={planLoading}
                  className="text-[10px] px-3 py-1.5 rounded-lg bg-orange-600 hover:bg-orange-500 disabled:opacity-40 text-white transition-colors"
                >
                  {planLoading ? 'Generating…' : weeklyPlan ? 'Regenerate' : 'Generate Plan'}
                </button>
              </div>
              {planLoading && (
                <div className="flex items-center gap-2 py-2">
                  <div className="w-4 h-4 border border-gray-600 border-t-orange-400 rounded-full animate-spin" />
                  <span className="text-xs text-gray-500">Building your personalised plan…</span>
                </div>
              )}
              {!planLoading && weeklyPlan && (
                <>
                  <p className="text-[10px] text-gray-600 mb-3">
                    Week of {new Date(weeklyPlan.week_start + 'T00:00:00').toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}
                  </p>
                  <div className="flex gap-2 overflow-x-auto pb-1 -mx-1 px-1">
                    {weeklyPlan.days.map(d => {
                      const intensityColor: Record<string, string> = {
                        rest: '#4b5563', low: '#22c55e', moderate: '#f97316', high: '#ef4444'
                      }
                      const bg = intensityColor[d.intensity] ?? '#4b5563'
                      return (
                        <button
                          key={d.day}
                          onClick={() => setExpandedDay(expandedDay === d.day ? null : d.day)}
                          className="shrink-0 flex flex-col items-center gap-1 rounded-2xl px-3 py-2 transition-all"
                          style={{ background: expandedDay === d.day ? bg + '33' : '#1a1a1a', border: `1px solid ${expandedDay === d.day ? bg : '#2a2a2a'}` }}
                        >
                          <span className="text-[10px] text-gray-400 font-semibold">{d.day}</span>
                          <div className="w-2 h-2 rounded-full" style={{ background: bg }} />
                          <span className="text-[9px] text-gray-500 text-center max-w-[52px] leading-tight">{d.session}</span>
                        </button>
                      )
                    })}
                  </div>
                  {expandedDay && (() => {
                    const day = weeklyPlan.days.find(d => d.day === expandedDay)
                    if (!day) return null
                    const intensityColor: Record<string, string> = { rest: '#6b7280', low: '#22c55e', moderate: '#f97316', high: '#ef4444' }
                    return (
                      <div className="mt-3 rounded-2xl p-3" style={{ background: '#1a1a1a' }}>
                        <div className="flex items-center gap-2 mb-1">
                          <div className="w-2 h-2 rounded-full" style={{ background: intensityColor[day.intensity] ?? '#6b7280' }} />
                          <span className="text-xs text-white font-semibold">{day.day} — {day.session}</span>
                        </div>
                        <p className="text-xs text-gray-400 leading-relaxed">{day.detail}</p>
                      </div>
                    )
                  })()}
                </>
              )}
              {!planLoading && !weeklyPlan && (
                <p className="text-xs text-gray-600">Generate a personalised Mon–Sun plan based on your current fitness signals.</p>
              )}
            </div>
          </>
        )}

        {/* ── ANALYTICS VIEW ──────────────────────────────────────────────── */}
        {view === 'analytics' && (
          <>
            <div className="flex gap-1 bg-gray-900 rounded-xl p-1 mb-4">
              {aTabBtn('trends', 'Trends')}
              {aTabBtn('training', 'Training')}
              {aTabBtn('records', 'Records')}
            </div>

            {/* ── TRENDS TAB ── */}
            {analyticsTab === 'trends' && (
              <>
                {/* HRV 30-day Trend */}
                <div className="rounded-3xl p-5 mb-4" style={{ background: '#111111' }}>
                  <div className="flex items-start justify-between mb-1">
                    <div className="flex items-center gap-1">
                    <p className="text-xs text-gray-500 uppercase tracking-widest">HRV 30-Day Trend</p>
                    <InfoTip text="Daily HRV readings over the past 30 days (orange line) with a 7-day rolling average (blue). A rising trend means your body is adapting and recovering well. A falling trend suggests accumulated fatigue." />
                  </div>
                    {hrvTrend?.trend != null && (
                      <span className="text-xs font-semibold" style={{ color: hrvTrend.trend >= 0 ? '#21FF00' : '#FF0000' }}>
                        {hrvTrend.trend >= 0 ? '↑' : '↓'}{Math.abs(hrvTrend.trend).toFixed(1)}% vs last week
                      </span>
                    )}
                  </div>
                  {hrvTrend?.avg != null && (
                    <p className="text-xs text-gray-600 mb-3">30-day avg: {Math.round(hrvTrend.avg)}ms</p>
                  )}
                  <div className="relative">
                    <SparkLine values={hrvTrend?.values ?? []} color="#f97316" height={56} />
                    <SparkLine values={hrvTrend?.rolling7 ?? []} color="#3b82f6" height={56} />
                  </div>
                  <div className="flex gap-4 mt-2">
                    <div className="flex items-center gap-1.5"><div className="w-3 h-0.5 rounded bg-orange-500" /><span className="text-[10px] text-gray-500">Daily HRV</span></div>
                    <div className="flex items-center gap-1.5"><div className="w-3 h-0.5 rounded bg-blue-500" /><span className="text-[10px] text-gray-500">7-day rolling avg</span></div>
                  </div>
                  <p className="text-[10px] text-gray-600 mt-2">
                    {hrvTrend?.trend == null ? 'Need more data for trend.' : hrvTrend.trend >= 5 ? 'HRV is trending upward — your fitness is adapting well.' : hrvTrend.trend <= -5 ? 'HRV is declining — monitor for accumulated fatigue.' : 'HRV is stable — maintaining current training load.'}
                  </p>
                </div>

                {/* Sleep → HRV Correlation */}
                <div className="rounded-3xl p-5 mb-4" style={{ background: '#111111' }}>
                  <div className="flex items-center gap-1 mb-1">
                    <p className="text-xs text-gray-500 uppercase tracking-widest">Sleep → Next Day HRV</p>
                    <InfoTip text="Pearson correlation (−1 to +1) between your sleep score and your HRV the following morning. +0.5 or higher = strong link. Closer to 0 = other factors (stress, alcohol) matter more than sleep alone." />
                  </div>
                  <p className="text-[10px] text-gray-600 mb-3">Does your sleep score predict next-day HRV?</p>
                  {sleepCorr ? (
                    <>
                      <div className="flex items-center gap-3 mb-3">
                        <span className="text-3xl font-bold" style={{ color: Math.abs(sleepCorr.r) > 0.5 ? '#21FF00' : Math.abs(sleepCorr.r) > 0.25 ? '#f97316' : '#9ca3af' }}>
                          {sleepCorr.r > 0 ? '+' : ''}{sleepCorr.r.toFixed(2)}
                        </span>
                        <div>
                          <p className="text-xs text-white">Correlation coefficient</p>
                          <p className="text-[10px] text-gray-500">Based on {sleepCorr.n} paired nights</p>
                        </div>
                      </div>
                      <p className="text-[11px] text-gray-400 leading-relaxed">
                        {Math.abs(sleepCorr.r) > 0.5 ? `Strong ${sleepCorr.r > 0 ? 'positive' : 'negative'} relationship — your sleep quality has a measurable impact on next-day HRV.`
                          : Math.abs(sleepCorr.r) > 0.25 ? `Moderate relationship — sleep quality has some influence on your next-day HRV.`
                          : `Weak relationship — other factors (stress, activity) may influence your HRV more than sleep alone.`}
                      </p>
                    </>
                  ) : (
                    <p className="text-xs text-gray-600">Need at least 5 paired nights of sleep + HRV data.</p>
                  )}
                </div>

                {/* Running Pace Trend */}
                <div className="rounded-3xl p-5 mb-4" style={{ background: '#111111' }}>
                  <div className="flex items-center gap-1 mb-1">
                    <p className="text-xs text-gray-500 uppercase tracking-widest">Running Pace Trend · 90 days</p>
                    <InfoTip text="Average pace (min/km) for each running session over the last 90 days. The chart is inverted so faster (lower) pace appears higher. A rising line means you're getting faster." />
                  </div>
                  {paceTrend.length >= 2 ? (
                    <>
                      <div className="flex gap-4 mb-3">
                        <div>
                          <p className="text-[10px] text-gray-500">Avg pace</p>
                          <p className="text-sm font-bold text-white">{fmtPace(avgPaceMinPerKm)}</p>
                        </div>
                        <div>
                          <p className="text-[10px] text-gray-500">Best pace</p>
                          <p className="text-sm font-bold" style={{ color: '#21FF00' }}>{fmtPace(bestPaceMinPerKm)}</p>
                        </div>
                        <div>
                          <p className="text-[10px] text-gray-500">Runs</p>
                          <p className="text-sm font-bold text-white">{paceTrend.length}</p>
                        </div>
                      </div>
                      <SparkLine values={paceTrendInverted} color="#f97316" height={52} />
                      <p className="text-[10px] text-gray-600 mt-2">
                        {paceTrend.length >= 5 && avgPaceMinPerKm != null && paceTrendValues.slice(-3).reduce((a,b)=>a+b,0)/3 < avgPaceMinPerKm
                          ? 'Recent runs are faster than your 90-day average — great progress.'
                          : paceTrend.length >= 5 && avgPaceMinPerKm != null && paceTrendValues.slice(-3).reduce((a,b)=>a+b,0)/3 > avgPaceMinPerKm * 1.05
                          ? 'Recent runs are slower than average — could be fatigue or easy training days.'
                          : 'Consistent pace across 90 days.'}
                      </p>
                    </>
                  ) : (
                    <p className="text-xs text-gray-600">Need at least 2 running sessions in the last 90 days.</p>
                  )}
                </div>

                {/* Lifestyle Impact */}
                <LifestyleImpactCard correlations={tagCorrelations} />

                {/* VO2 Max Context */}
                <div className="rounded-3xl p-5 mb-4" style={{ background: '#111111' }}>
                  <div className="flex items-center gap-1 mb-1">
                    <p className="text-xs text-gray-500 uppercase tracking-widest">VO2 Max</p>
                    <InfoTip text="Maximum oxygen uptake in ml/kg/min — the gold standard of cardiovascular fitness. Extracted from your Garmin activity data. Higher = better aerobic capacity. Top 20% for your age = elite fitness." />
                  </div>
                  <p className="text-[10px] text-gray-600 mb-3">Cardiovascular fitness from recent activities</p>
                  {data?.vo2max != null ? (
                    <>
                      <p className="text-3xl font-bold text-white mb-1">{data.vo2max.toFixed(1)}<span className="text-sm text-gray-500 ml-1">ml/kg/min</span></p>
                      {chronoAge != null && (() => {
                        const thresholds: Record<string, number[]> = { '20': [55, 44], '30': [52, 41], '40': [48, 37], '50': [44, 33], '60': [40, 29] }
                        const decade = String(Math.floor(Math.min(chronoAge, 69) / 10) * 10)
                        const [top, avg] = thresholds[decade] ?? [45, 33]
                        const percentile = data.vo2max >= top ? 'Top 20%' : data.vo2max >= avg ? 'Above average' : 'Average or below'
                        const pColor = data.vo2max >= top ? '#21FF00' : data.vo2max >= avg ? '#f97316' : '#9ca3af'
                        return (
                          <>
                            <p className="text-xs font-semibold mb-2" style={{ color: pColor }}>{percentile} for your age group</p>
                            <div className="w-full bg-gray-800 rounded-full h-2 mb-1">
                              <div className="h-2 rounded-full" style={{ width: `${Math.min(100, (data.vo2max / (top + 5)) * 100)}%`, background: pColor }} />
                            </div>
                            <div className="flex justify-between text-[10px] text-gray-600">
                              <span>Below avg (&lt;{avg})</span><span>Top 20% ({top}+)</span>
                            </div>
                          </>
                        )
                      })()}
                    </>
                  ) : (
                    <p className="text-xs text-gray-600">VO2 max not found in recent activity data. Sync after a cardio activity.</p>
                  )}
                </div>
              </>
            )}

            {/* ── TRAINING TAB ── */}
            {analyticsTab === 'training' && (
              <>
                {/* ACWR */}
                <div className="rounded-3xl p-5 mb-4" style={{ background: '#111111' }}>
                  <div className="flex items-center gap-1 mb-1">
                    <p className="text-xs text-gray-500 uppercase tracking-widest">Acute:Chronic Workload Ratio</p>
                    <InfoTip text="Compares your last 7 days of training load vs your 28-day average. 0.8–1.3 is the optimal 'sweet spot' — enough stimulus to improve without injury risk. Above 1.5 significantly raises injury probability." />
                  </div>
                  <p className="text-[10px] text-gray-600 mb-3">7-day load vs 28-day average. Sweet spot: 0.8–1.3</p>
                  {acwr ? (
                    <>
                      <div className="flex items-end gap-3 mb-3">
                        <span className="text-4xl font-bold" style={{ color: acwr.acwr > 1.5 || acwr.acwr < 0.5 ? '#FF0000' : acwr.acwr > 1.3 ? '#f97316' : '#21FF00' }}>
                          {acwr.acwr.toFixed(2)}
                        </span>
                        <span className="text-xs text-gray-400 mb-1">
                          {acwr.acwr > 1.5 ? 'Danger zone — high injury risk' : acwr.acwr > 1.3 ? 'Caution — approaching overload' : acwr.acwr >= 0.8 ? 'Optimal range' : 'Undertraining — safe but detraining risk'}
                        </span>
                      </div>
                      {/* Gauge */}
                      <div className="relative w-full bg-gray-800 rounded-full h-3 mb-1">
                        <div className="absolute h-3 rounded-full bg-green-500 opacity-30" style={{ left: '40%', width: '25%' }} />
                        <div className="absolute h-3 rounded-full bg-orange-500 opacity-30" style={{ left: '65%', width: '10%' }} />
                        <div className="absolute h-3 rounded-full bg-red-500 opacity-30" style={{ left: '75%', width: '25%' }} />
                        <div className="absolute top-0 w-1 h-3 rounded-full bg-white" style={{ left: `${Math.min(99, (acwr.acwr / 2) * 100)}%` }} />
                      </div>
                      <div className="flex justify-between text-[10px] text-gray-600 mb-3">
                        <span>0</span><span>0.8</span><span>1.3</span><span>1.5</span><span>2.0</span>
                      </div>
                      <div className="grid grid-cols-2 gap-2">
                        <div className="rounded-xl p-3" style={{ background: '#1a1a1a' }}>
                          <p className="text-[10px] text-gray-500 mb-1">Acute (7-day load)</p>
                          <p className="text-lg font-bold text-white">{acwr.acute}<span className="text-xs text-gray-500 ml-1">min</span></p>
                        </div>
                        <div className="rounded-xl p-3" style={{ background: '#1a1a1a' }}>
                          <p className="text-[10px] text-gray-500 mb-1">Chronic (avg week)</p>
                          <p className="text-lg font-bold text-white">{acwr.chronic}<span className="text-xs text-gray-500 ml-1">min</span></p>
                        </div>
                      </div>
                    </>
                  ) : (
                    <p className="text-xs text-gray-600">Need at least 7 days of intensity data.</p>
                  )}
                </div>

                {/* Weekly Summary */}
                {weeklySummary && (
                  <div className="rounded-3xl p-5 mb-4" style={{ background: '#111111' }}>
                    <div className="flex items-center gap-1 mb-3">
                      <p className="text-xs text-gray-500 uppercase tracking-widest">Weekly Summary</p>
                      <InfoTip text="This week vs last week comparison. Training load = intensity minutes (moderate + vigorous×2). Green = improvement, red = decline vs previous week." />
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      {[
                        { label: 'Training load', this: weeklySummary.load.this, last: weeklySummary.load.last, unit: 'min', fmt: (v: number) => String(v) },
                        { label: 'Avg sleep score', this: weeklySummary.sleep.this, last: weeklySummary.sleep.last, unit: '', fmt: (v: number) => String(v) },
                        { label: 'Avg HRV', this: weeklySummary.hrv.this, last: weeklySummary.hrv.last, unit: 'ms', fmt: (v: number) => String(v) },
                        { label: 'Activities', this: weeklySummary.activities.this, last: weeklySummary.activities.last, unit: '', fmt: (v: number) => String(v) },
                      ].map((row, i) => {
                        const delta = row.this != null && row.last != null ? row.this - row.last : null
                        const isGood = delta != null && delta >= 0
                        return (
                          <div key={i} className="rounded-xl p-3" style={{ background: '#1a1a1a' }}>
                            <p className="text-[10px] text-gray-500 mb-1">{row.label}</p>
                            <p className="text-lg font-bold text-white">{row.this != null ? `${row.fmt(row.this)}${row.unit}` : '—'}</p>
                            {delta != null && (
                              <p className="text-[10px] mt-0.5" style={{ color: isGood ? '#21FF00' : '#FF0000' }}>
                                {delta >= 0 ? '+' : ''}{delta}{row.unit} vs last week
                              </p>
                            )}
                          </div>
                        )
                      })}
                    </div>
                  </div>
                )}

                {/* Race Goal */}
                <div className="rounded-3xl p-5 mb-4" style={{ background: '#111111' }}>
                  <div className="flex items-center justify-between mb-3">
                    <div className="flex items-center gap-1">
                      <p className="text-xs text-gray-500 uppercase tracking-widest">🎯 Race Goal</p>
                      <InfoTip text="Set a target race and track your estimated finish time based on recent running pace. The estimate uses your 90-day average pace for the goal distance." />
                    </div>
                    {raceGoal && (
                      <button
                        onClick={() => {
                          const h = Math.floor(raceGoal.target_sec / 3600)
                          const m = Math.floor((raceGoal.target_sec % 3600) / 60)
                          const s = raceGoal.target_sec % 60
                          setRaceForm({
                            name: raceGoal.name,
                            distance_km: String(raceGoal.distance_km),
                            target_time: `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`,
                            race_date: raceGoal.race_date,
                          })
                          setShowRaceModal(true)
                        }}
                        className="text-[10px] px-2 py-1 rounded-lg border border-gray-600 text-gray-400 hover:text-white"
                      >
                        Edit
                      </button>
                    )}
                  </div>
                  {raceGoal ? (
                    <>
                      <p className="text-lg font-bold text-white mb-1">{raceGoal.name}</p>
                      <p className="text-xs text-gray-400 mb-3">
                        {raceGoal.distance_km}km ·{' '}
                        {daysUntilRace != null && daysUntilRace > 0 ? `${daysUntilRace} days away` : daysUntilRace === 0 ? 'Race day!' : 'Race passed'}
                      </p>
                      <div className="grid grid-cols-2 gap-2 mb-3">
                        <div className="rounded-xl p-3" style={{ background: '#1a1a1a' }}>
                          <p className="text-[10px] text-gray-500 mb-1">Target time</p>
                          <p className="text-base font-bold text-white">{fmtSec(raceGoal.target_sec)}</p>
                          <p className="text-[10px] text-gray-500">
                            {fmtPace(raceGoal.target_sec / 60 / raceGoal.distance_km)} target pace
                          </p>
                        </div>
                        <div className="rounded-xl p-3" style={{ background: '#1a1a1a' }}>
                          <p className="text-[10px] text-gray-500 mb-1">Est. finish (current pace)</p>
                          {estFinishSec != null ? (
                            <>
                              <p className="text-base font-bold" style={{ color: targetDeltaSec != null && targetDeltaSec <= 0 ? '#21FF00' : '#f97316' }}>
                                {fmtSec(estFinishSec)}
                              </p>
                              {targetDeltaSec != null && (
                                <p className="text-[10px]" style={{ color: targetDeltaSec <= 0 ? '#21FF00' : '#f97316' }}>
                                  {targetDeltaSec <= 0 ? `${fmtSec(Math.abs(targetDeltaSec))} under target` : `${fmtSec(targetDeltaSec)} off target`}
                                </p>
                              )}
                            </>
                          ) : (
                            <p className="text-xs text-gray-600">No run data</p>
                          )}
                        </div>
                      </div>
                      {estFinishSec != null && targetDeltaSec != null && (
                        <div className="w-full bg-gray-800 rounded-full h-2">
                          <div className="h-2 rounded-full transition-all" style={{
                            width: `${Math.min(100, Math.max(5, (raceGoal.target_sec / estFinishSec) * 100))}%`,
                            background: targetDeltaSec <= 0 ? '#21FF00' : '#f97316'
                          }} />
                        </div>
                      )}
                    </>
                  ) : (
                    <div>
                      <p className="text-xs text-gray-600 mb-3">Set a race goal to track your progress toward it.</p>
                      <button
                        onClick={() => setShowRaceModal(true)}
                        className="text-xs px-4 py-2 rounded-lg bg-orange-600 hover:bg-orange-500 text-white transition-colors"
                      >
                        + Set Race Goal
                      </button>
                    </div>
                  )}
                </div>

                {/* Training Zones */}
                <div className="rounded-3xl p-5 mb-4" style={{ background: '#111111' }}>
                  <div className="flex items-center gap-1 mb-1">
                    <p className="text-xs text-gray-500 uppercase tracking-widest">Training Zone Distribution</p>
                    <InfoTip text="Time spent in each HR zone over the last 90 days, estimated from avg HR vs your max HR (220−age). Z1 Recovery &lt;60%, Z2 Aerobic 60–70%, Z3 Tempo 70–80%, Z4 Threshold 80–90%, Z5 Max 90%+." />
                  </div>
                  <p className="text-[10px] text-gray-600 mb-3">Last 90 days · Est. max HR: {estimatedMaxHR}bpm</p>
                  {zones.some(z => z.minutes > 0) ? (
                    <div className="space-y-3">
                      {zones.map(z => (
                        <div key={z.zone}>
                          <div className="flex justify-between text-[11px] mb-1">
                            <span style={{ color: z.color }}>{z.label}</span>
                            <span className="text-gray-400">{z.minutes}min</span>
                          </div>
                          <HorizBar value={z.minutes} max={maxZoneMin} color={z.color} />
                        </div>
                      ))}
                      <p className="text-[10px] text-gray-600 pt-1">
                        {zones[0].minutes + zones[1].minutes > zones[3].minutes + zones[4].minutes
                          ? 'Good polarized distribution — most time in easy zones with quality hard efforts.'
                          : 'Consider adding more easy Z1–Z2 work. Polarized training improves aerobic base.'}
                      </p>
                    </div>
                  ) : (
                    <p className="text-xs text-gray-600">No activities with HR data found in the last 90 days.</p>
                  )}
                </div>
              </>
            )}

            {/* ── RECORDS TAB ── */}
            {analyticsTab === 'records' && (
              <>
                {Object.keys(prs).length > 0 ? (
                  Object.entries(prs).map(([type, records]) => (
                    <div key={type} className="rounded-3xl p-5 mb-4" style={{ background: '#111111' }}>
                      <div className="flex items-center gap-1 mb-3">
                        <p className="text-xs text-gray-500 uppercase tracking-widest">{type}</p>
                        <InfoTip text="Your personal bests for this activity type from the last 90 days of synced data." />
                      </div>
                      <div className="space-y-3">
                        {records.map((pr, i) => (
                          <div key={i} className="flex justify-between items-center">
                            <div>
                              <p className="text-xs text-gray-400">{pr.label}</p>
                              <p className="text-sm font-bold text-white">{pr.value}</p>
                            </div>
                            <p className="text-[10px] text-gray-600">{pr.date}</p>
                          </div>
                        ))}
                      </div>
                    </div>
                  ))
                ) : (
                  <div className="rounded-3xl p-5" style={{ background: '#111111' }}>
                    <p className="text-xs text-gray-600">No activity records found in the last 90 days. Sync your activities to see personal records.</p>
                  </div>
                )}
              </>
            )}
          </>
        )}

        {/* Legend (today view only) */}
        {view === 'today' && (
          <div className="rounded-2xl p-4 mb-4" style={{ background: '#111111' }}>
            <p className="text-[10px] text-gray-600 uppercase tracking-widest mb-3">How scores are calculated</p>
            <div className="space-y-1.5 text-[10px] text-gray-500">
              <p><span className="text-gray-300">Recovery</span> = HRV (45%) + Sleep Score (35%) + Resting HR (20%), normalised 0–100</p>
              <p><span className="text-gray-300">Strain</span> = Intensity minutes mapped logarithmically to 0–21 scale</p>
              <p><span className="text-gray-300">Early Warning</span> = Respiration &gt;12% above 14-day rolling baseline</p>
              <p><span className="text-gray-300">Bio Age</span> = Chronological age ± adjustments for VO2 max, RHR trend, deep sleep</p>
              <p><span className="text-gray-300">Sleep Debt</span> = Rolling 7-night actual vs 8h/night target</p>
            </div>
          </div>
        )}

      </div>
      <BottomNav />

      {/* Race Goal Modal */}
      {showRaceModal && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 px-4 pb-6">
          <div className="w-full max-w-md rounded-3xl p-6" style={{ background: '#1a1a1a' }}>
            <h2 className="text-base font-bold text-white mb-4">🎯 Race Goal</h2>
            <div className="space-y-3">
              <div>
                <label className="text-[10px] text-gray-500 uppercase tracking-wider">Race name</label>
                <input
                  type="text"
                  value={raceForm.name}
                  onChange={e => setRaceForm(f => ({ ...f, name: e.target.value }))}
                  placeholder="e.g. 5K Parkrun, London Marathon"
                  className="w-full mt-1 bg-gray-800 text-white text-sm rounded-xl px-3 py-2.5 outline-none focus:ring-1 focus:ring-orange-500 placeholder-gray-600"
                />
              </div>
              <div>
                <label className="text-[10px] text-gray-500 uppercase tracking-wider">Distance (km)</label>
                <select
                  value={raceForm.distance_km}
                  onChange={e => setRaceForm(f => ({ ...f, distance_km: e.target.value }))}
                  className="w-full mt-1 bg-gray-800 text-white text-sm rounded-xl px-3 py-2.5 outline-none focus:ring-1 focus:ring-orange-500"
                >
                  <option value="5">5 km</option>
                  <option value="10">10 km</option>
                  <option value="21.1">21.1 km (Half Marathon)</option>
                  <option value="42.2">42.2 km (Marathon)</option>
                  <option value="custom">Custom</option>
                </select>
                {raceForm.distance_km === 'custom' && (
                  <input
                    type="number"
                    step="0.1"
                    placeholder="Distance in km"
                    className="w-full mt-2 bg-gray-800 text-white text-sm rounded-xl px-3 py-2.5 outline-none focus:ring-1 focus:ring-orange-500 placeholder-gray-600"
                    onChange={e => setRaceForm(f => ({ ...f, distance_km: e.target.value }))}
                  />
                )}
              </div>
              <div>
                <label className="text-[10px] text-gray-500 uppercase tracking-wider">Target time (HH:MM:SS)</label>
                <input
                  type="text"
                  value={raceForm.target_time}
                  onChange={e => setRaceForm(f => ({ ...f, target_time: e.target.value }))}
                  placeholder="e.g. 00:25:00 or 1:45:00"
                  className="w-full mt-1 bg-gray-800 text-white text-sm rounded-xl px-3 py-2.5 outline-none focus:ring-1 focus:ring-orange-500 placeholder-gray-600"
                />
              </div>
              <div>
                <label className="text-[10px] text-gray-500 uppercase tracking-wider">Race date</label>
                <input
                  type="date"
                  value={raceForm.race_date}
                  onChange={e => setRaceForm(f => ({ ...f, race_date: e.target.value }))}
                  className="w-full mt-1 bg-gray-800 text-white text-sm rounded-xl px-3 py-2.5 outline-none focus:ring-1 focus:ring-orange-500"
                />
              </div>
            </div>
            <div className="flex gap-2 mt-5">
              <button
                onClick={() => setShowRaceModal(false)}
                className="flex-1 py-3 rounded-2xl border border-gray-600 text-gray-300 text-sm hover:border-gray-400"
              >
                Cancel
              </button>
              <button
                onClick={saveRaceGoal}
                disabled={savingRace || !raceForm.name || !raceForm.target_time || !raceForm.race_date}
                className="flex-1 py-3 rounded-2xl bg-orange-600 hover:bg-orange-500 disabled:opacity-40 text-white text-sm font-semibold transition-colors"
              >
                {savingRace ? 'Saving…' : 'Save Goal'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

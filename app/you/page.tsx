'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '../../lib/supabase'
import { BottomNav } from '../../components/BottomNav'

type GarminRacePrediction = {
  raceTime?: number
  distance?: string
  raceDistance?: string
  predictedTime?: number
  racePredictionTime?: number
  courseType?: string
  [key: string]: unknown
}

type GarminPersonalRecord = {
  typeKey?: string
  typeId?: number
  value?: number
  activityId?: number
  prStartTimeGMT?: string
  [key: string]: unknown
}

type Activity = {
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
}

type DailyMetric = {
  metric_date: string
  garmin_body_battery_high: number | null
  garmin_hrv_nightly_avg: number | null
  garmin_sleep_score: number | null
  steps: number | null
}

type WeightEntry = {
  weigh_date: string
  weight_grams: number
  bmi: number | null
  body_fat_pct: number | null
  body_water_pct: number | null
  muscle_mass_grams: number | null
  bone_mass_grams: number | null
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function getTypeKey(a: Activity): string {
  const raw = a.raw_payload ?? {}
  const tk = (raw.activityType as Record<string, unknown> | undefined)?.typeKey as string | undefined
  return tk ?? a.activity_type ?? 'other'
}

function getActivityName(a: Activity): string {
  const raw = a.raw_payload ?? {}
  return (raw.activityName as string | undefined) ?? getTypeKey(a).replace(/_/g, ' ')
}

function formatDuration(sec: number): string {
  const h = Math.floor(sec / 3600)
  const m = Math.floor((sec % 3600) / 60)
  if (h > 0) return `${h}h ${m}m`
  return `${m}m`
}

function formatDistance(m: number): string {
  return `${(m / 1000).toFixed(1)} km`
}

function formatPace(mps: number): string {
  const secPerKm = Math.round(1000 / mps)
  return `${Math.floor(secPerKm / 60)}:${String(secPerKm % 60).padStart(2, '0')} /km`
}

function getMondayOfWeek(d: Date): Date {
  const day = d.getDay()
  const diff = (day === 0 ? -6 : 1 - day)
  const mon = new Date(d)
  mon.setDate(d.getDate() + diff)
  mon.setHours(0, 0, 0, 0)
  return mon
}

// VO2max → estimated 5K time in seconds (simplified VDOT table)
function vo2maxTo5kSec(vo2max: number): number {
  // Approximation: T(5k mins) ≈ 10.8 / (VO2max^0.5) * 13.1
  // Better empirical approximation:
  return Math.round((-4.60 + 0.182258 * 1000 + 0.000104 * 1000000 - vo2max) / 0.182258 * 5 / 1000 * 60)
}

function estimateRaceTimes(vo2max: number) {
  // Using Riegel/Daniels approximations
  const factor = 50 / vo2max
  const base5k = 20 * 60 * factor  // 20min at VO2max=50 is rough baseline
  return {
    fiveK: Math.round(base5k),
    tenK: Math.round(base5k * 2 * 1.06),
    half: Math.round(base5k * 4.254 * 1.08),
    full: Math.round(base5k * 8.839 * 1.10),
  }
}

function secsToTime(s: number): string {
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const sec = s % 60
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`
  return `${m}:${String(sec).padStart(2, '0')}`
}

function localDateStr(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function kgToStoneLb(kg: number): { stones: number; lbs: number } {
  const totalLbs = kg * 2.20462
  const stones = Math.floor(totalLbs / 14)
  const lbs = Math.round(totalLbs % 14)
  // Handle rounding 14lb → carry
  return lbs === 14 ? { stones: stones + 1, lbs: 0 } : { stones, lbs }
}

function fmtStoneLb(kg: number): string {
  const { stones, lbs } = kgToStoneLb(kg)
  if (stones === 0) return `${lbs}lb`
  return lbs === 0 ? `${stones}st` : `${stones}st ${lbs}lb`
}

function fmtWeightDelta(kg: number): string {
  const totalLbs = Math.abs(kg) * 2.20462
  if (totalLbs < 14) return `${totalLbs.toFixed(1)}lb`
  const stones = Math.floor(totalLbs / 14)
  const remLbs = Math.round(totalLbs % 14)
  return remLbs > 0 ? `${stones}st ${remLbs}lb` : `${stones}st`
}

function formatGarminPrediction(p: GarminRacePrediction): { label: string; time: string } | null {
  const distance = p.raceDistance ?? p.distance ?? ''
  const timeSec = Number(p.racePredictionTime ?? p.predictedTime ?? p.raceTime ?? 0)
  if (!distance || !timeSec) return null
  const label = String(distance).replace(/_/g, ' ').replace(/km/i, 'K')
  return { label, time: secsToTime(Math.round(timeSec)) }
}

const PR_TYPE_LABELS: Record<string, string> = {
  best_mile: '1 Mile',
  best_5k: '5K',
  best_10k: '10K',
  best_half_marathon: 'Half Marathon',
  best_marathon: 'Marathon',
  longest_run: 'Longest Run',
  best_5k_run: '5K',
  best_10k_run: '10K',
}

function formatGarminPR(pr: GarminPersonalRecord): { label: string; value: string; date: string } | null {
  const typeKey = String(pr.typeKey ?? '').toLowerCase()
  const label = PR_TYPE_LABELS[typeKey] ?? typeKey.replace(/_/g, ' ')
  if (!label) return null
  // value is usually in seconds for time-based PRs
  const val = Number(pr.value ?? 0)
  if (!val) return null
  const date = pr.prStartTimeGMT ? new Date(pr.prStartTimeGMT).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : ''
  // Heuristic: if typeKey includes 'run' or is known distance, value is seconds
  const isTime = typeKey.includes('run') || typeKey.includes('mile') || typeKey.includes('marathon') || typeKey.includes('k_')
  const formattedVal = isTime ? secsToTime(Math.round(val)) : val > 1000 ? `${(val / 1000).toFixed(2)} km` : `${val.toFixed(0)} m`
  return { label, value: formattedVal, date }
}

const ZONE_COLORS = ['bg-blue-500', 'bg-green-500', 'bg-yellow-500', 'bg-orange-500', 'bg-red-500']
const ZONE_LABELS = ['Z1', 'Z2', 'Z3', 'Z4', 'Z5']

// ─── Components ───────────────────────────────────────────────────────────────

function StatBlock({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div>
      <p className="text-gray-400 text-xs">{label}</p>
      <p className="text-white font-bold text-xl leading-tight">{value}</p>
      {sub && <p className="text-gray-500 text-xs">{sub}</p>}
    </div>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="bg-gray-900 rounded-2xl p-4 space-y-3">
      <h2 className="text-white font-bold text-base flex items-center gap-2">{title}</h2>
      {children}
    </div>
  )
}

function WeightLineChart({ entries }: { entries: { label: string; kg: number | null; isCurrent?: boolean }[] }) {
  const withData = entries.filter(e => e.kg != null)
  if (withData.length === 0) {
    return <div className="text-center text-xs text-gray-600 py-6">No weight readings this period</div>
  }
  const kgVals = withData.map(e => e.kg!)
  const minKg = Math.min(...kgVals) - 0.3
  const maxKg = Math.max(...kgVals) + 0.3
  const range = maxKg - minKg || 1
  const W = 300, H = 72
  const n = entries.length
  const pts = entries.map((e, i) => ({
    x: (i / Math.max(n - 1, 1)) * W,
    y: e.kg != null ? H - ((e.kg - minKg) / range) * H : null,
    ...e,
  }))
  // Build line path — reconnect across nulls not done (gaps shown)
  let path = ''
  for (const pt of pts) {
    if (pt.y != null) path += path && !path.endsWith(' ') && pts.find(p => p.x < pt.x && p.y == null) ? ` M${pt.x.toFixed(1)},${pt.y.toFixed(1)}` : (path ? ` L${pt.x.toFixed(1)},${pt.y.toFixed(1)}` : `M${pt.x.toFixed(1)},${pt.y.toFixed(1)}`)
  }
  const topLabel = fmtStoneLb(maxKg)
  const botLabel = fmtStoneLb(minKg)
  return (
    <div className="bg-gray-800/40 rounded-xl overflow-hidden py-2 px-2">
      <div className="flex items-stretch gap-1">
        <div className="flex flex-col justify-between text-[9px] text-gray-600 w-14 shrink-0 text-right">
          <span>{topLabel}</span>
          <span>{botLabel}</span>
        </div>
        <div className="flex-1">
          <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="w-full" style={{ height: H }}>
            <line x1={0} y1={H / 2} x2={W} y2={H / 2} stroke="#374151" strokeWidth="0.5" strokeDasharray="4 4" />
            {path && <path d={path} fill="none" stroke="#f97316" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />}
            {pts.filter(p => p.y != null).map((p, i) => (
              <circle key={i} cx={p.x} cy={p.y!} r={p.isCurrent ? 4.5 : 3}
                fill="#f97316" stroke={p.isCurrent ? '#ffffff' : '#111827'} strokeWidth={p.isCurrent ? 2 : 1.5} />
            ))}
          </svg>
          <div className="flex justify-between text-[9px] text-gray-600 mt-0.5">
            <span>{entries[0].label}</span>
            {n > 6 && <span>{entries[Math.floor(n / 2)].label}</span>}
            <span>{entries[n - 1].label}</span>
          </div>
        </div>
      </div>
    </div>
  )
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function YouPage() {
  const router = useRouter()
  const [activities, setActivities] = useState<Activity[]>([])
  const [metrics, setMetrics] = useState<DailyMetric[]>([])
  const [displayName, setDisplayName] = useState('')
  const [loading, setLoading] = useState(true)
  const [activeTab, setActiveTab] = useState<'all' | 'run' | 'walk' | 'strength'>('all')
  const [weightEntries, setWeightEntries] = useState<WeightEntry[]>([])
  const [heightCm, setHeightCm] = useState<number | null>(null)
  const [heightInput, setHeightInput] = useState('')
  const [savingHeight, setSavingHeight] = useState(false)
  const [currentUserId, setCurrentUserId] = useState<string | null>(null)
  const [racePredictions, setRacePredictions] = useState<GarminRacePrediction[] | null>(null)
  const [garminPRs, setGarminPRs] = useState<GarminPersonalRecord[] | null>(null)
  const [weightTab, setWeightTab] = useState<'week' | 'month' | 'year'>('week')
  const [weightWeekOffset, setWeightWeekOffset] = useState(0)
  const [weightMonthOffset, setWeightMonthOffset] = useState(0)
  const [weightYearOffset, setWeightYearOffset] = useState(0)
  const [showWeightModal, setShowWeightModal] = useState(false)

  useEffect(() => {
    const load = async () => {
      const { data } = await supabase.auth.getSession()
      if (!data.session) { router.push('/login'); return }
      const user = data.session.user

      setCurrentUserId(user.id)

      // Base profile — always safe columns
      const { data: profile } = await supabase
        .from('profiles')
        .select('display_name, name, height_cm')
        .eq('user_id', user.id)
        .maybeSingle()
      setDisplayName(profile?.display_name ?? profile?.name ?? '')
      const hCm = (profile as { height_cm?: number | null } | null)?.height_cm ?? null
      setHeightCm(hCm)

      // Extended columns — may not exist if SQL migration hasn't run yet
      try {
        const { data: profileExt } = await supabase
          .from('profiles')
          .select('race_predictions, personal_records')
          .eq('user_id', user.id)
          .maybeSingle()
        const ext = profileExt as { race_predictions?: GarminRacePrediction[] | null; personal_records?: GarminPersonalRecord[] | null } | null
        if (ext?.race_predictions?.length) setRacePredictions(ext.race_predictions)
        if (ext?.personal_records?.length) setGarminPRs(ext.personal_records)
      } catch { /* columns don't exist yet — run SQL migration */ }

      // All activities (last 90 days for PRs + weekly stats)
      const ninetyDaysAgo = new Date()
      ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90)
      const { data: acts } = await supabase
        .from('garmin_activities')
        .select('id, activity_type, start_time, duration_sec, distance_m, calories, avg_hr, max_hr, training_effect, raw_payload')
        .eq('user_id', user.id)
        .gte('start_time', ninetyDaysAgo.toISOString())
        .order('start_time', { ascending: false })
      setActivities((acts ?? []) as Activity[])

      // Last 30 days of daily metrics for trend
      const thirtyDaysAgo = new Date()
      thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30)
      const { data: met } = await supabase
        .from('daily_health_metrics')
        .select('metric_date, garmin_body_battery_high, garmin_hrv_nightly_avg, garmin_sleep_score, steps')
        .eq('user_id', user.id)
        .gte('metric_date', thirtyDaysAgo.toISOString().split('T')[0])
        .order('metric_date', { ascending: true })
      setMetrics((met ?? []) as DailyMetric[])

      // Weight data — try garmin_weight_snapshots first (most accurate), then fall back to daily_health_metrics.body_composition
      const ninetyDaysAgoDate = ninetyDaysAgo.toISOString().split('T')[0]
      let parsed: WeightEntry[] = []

      // Primary: dedicated weigh-ins table
      // sync_once.py writes weight_grams (grams as integer) AND weight_kg.
      // Older rows may only have weight_kg. raw_payload always has weight_kg too.
      // We try the full column list; if the column doesn't exist Supabase errors —
      // in that case we retry with just weight_kg + raw_payload.
      let weightRaw: Record<string, unknown>[] | null = null
      let weightErr: { message: string } | null = null;
      {
        const res1 = await supabase
          .from('garmin_weight_snapshots')
          .select('weigh_date, weight_grams, weight_kg, body_fat_pct, muscle_mass_grams, muscle_mass_kg, bone_mass_grams, bone_mass_kg, raw_payload')
          .eq('user_id', user.id)
          .gte('weigh_date', ninetyDaysAgoDate)
          .order('weigh_date', { ascending: true })
        if (!res1.error) {
          weightRaw = (res1.data ?? []) as Record<string, unknown>[]
        } else {
          // weight_grams or other column may not exist — fall back to minimal select
          const res2 = await supabase
            .from('garmin_weight_snapshots')
            .select('weigh_date, weight_kg, body_fat_pct, muscle_mass_kg, bone_mass_kg, raw_payload')
            .eq('user_id', user.id)
            .gte('weigh_date', ninetyDaysAgoDate)
            .order('weigh_date', { ascending: true })
          weightRaw = (res2.data ?? []) as Record<string, unknown>[]
          weightErr = res2.error
        }
      }

      if (!weightErr && (weightRaw ?? []).length > 0) {
        parsed = (weightRaw ?? []).flatMap(row => {
          const r = row as {
            weigh_date: string
            weight_grams: number | null; weight_kg: number | null
            body_fat_pct: number | null
            muscle_mass_grams: number | null; muscle_mass_kg: number | null
            bone_mass_grams: number | null; bone_mass_kg: number | null
            raw_payload: Record<string, unknown> | null
          }
          const raw = r.raw_payload ?? {}
          // Priority: weight_grams col → weight_kg col → raw_payload.weight_kg
          const rawPayloadKg = Number(raw.weight_kg ?? raw.weightKg) || null
          const grams = r.weight_grams
            ?? (r.weight_kg != null && r.weight_kg > 0 ? r.weight_kg * 1000 : null)
            ?? (rawPayloadKg != null && rawPayloadKg > 0 ? (rawPayloadKg > 500 ? rawPayloadKg : rawPayloadKg * 1000) : null)
          if (!grams || grams <= 0) return []
          return [{
            weigh_date: r.weigh_date,
            weight_grams: grams,
            bmi: null,
            body_fat_pct: r.body_fat_pct ?? (Number(raw.percentFat) || null),
            body_water_pct: Number(raw.percentHydration) || null,
            muscle_mass_grams: r.muscle_mass_grams
              ?? (r.muscle_mass_kg ? r.muscle_mass_kg * 1000 : null)
              ?? (Number(raw.muscleMassGrams) > 0 ? Number(raw.muscleMassGrams) : null),
            bone_mass_grams: r.bone_mass_grams
              ?? (r.bone_mass_kg ? r.bone_mass_kg * 1000 : null)
              ?? (Number(raw.boneMassGrams) > 0 ? Number(raw.boneMassGrams) : null),
          }]
        })
      } else {
        // Fallback A: body_composition JSONB on daily_health_metrics (old sync table)
        const { data: bodyCompRaw } = await supabase
          .from('daily_health_metrics')
          .select('metric_date, body_composition')
          .eq('user_id', user.id)
          .gte('metric_date', ninetyDaysAgoDate)
          .not('body_composition', 'is', null)
          .order('metric_date', { ascending: true })
        for (const row of (bodyCompRaw ?? [])) {
          const bc = (row as { metric_date: string; body_composition: Record<string, unknown> | null }).body_composition
          if (!bc) continue
          const weightKg = Number(bc.weight_kg ?? bc.weightKg ?? bc.weight)
          if (!weightKg || weightKg <= 0) continue
          const weightKgNorm = weightKg > 500 ? weightKg / 1000 : weightKg
          parsed.push({
            weigh_date: (row as { metric_date: string }).metric_date,
            weight_grams: weightKgNorm * 1000,
            bmi: Number(bc.bmi) || null,
            body_fat_pct: Number(bc.body_fat_pct ?? bc.bodyFatPct ?? bc.percentFat ?? bc.bodyFat) || null,
            body_water_pct: Number(bc.body_water_pct ?? bc.bodyWaterPct ?? bc.percentHydration) || null,
            muscle_mass_grams: Number(bc.muscle_mass_kg ?? bc.muscleMassKg) > 0
              ? Number(bc.muscle_mass_kg ?? bc.muscleMassKg) * 1000 : null,
            bone_mass_grams: Number(bc.bone_mass_kg ?? bc.boneMassKg) > 0
              ? Number(bc.bone_mass_kg ?? bc.boneMassKg) * 1000 : null,
          })
        }

        // Fallback B: garmin_daily_health_metrics.raw_payload.summary — the newer sync
        // table. The daily Garmin summary sometimes includes bodyWeight (in grams) or
        // bodyCompositionSummary. This covers dates synced after the schema update.
        const { data: gdhmRows } = await supabase
          .from('garmin_daily_health_metrics')
          .select('metric_date, raw_payload')
          .eq('user_id', user.id)
          .gte('metric_date', ninetyDaysAgoDate)
          .order('metric_date', { ascending: true })

        const existingDates = new Set(parsed.map(p => p.weigh_date))
        for (const row of (gdhmRows ?? [])) {
          const rp = row as { metric_date: string; raw_payload: Record<string, unknown> | null }
          if (existingDates.has(rp.metric_date)) continue  // already have weight for this date
          const summary = (rp.raw_payload?.summary ?? {}) as Record<string, unknown>
          // Garmin embeds weight in grams in bodyWeight or under bodyCompositionSummary
          const bodyComp = (summary.bodyCompositionSummary ?? summary.bodyComposition ?? {}) as Record<string, unknown>
          const rawGrams = Number(summary.bodyWeight ?? summary.weighInGrams ?? bodyComp.weight ?? 0)
          const rawKg = Number(summary.bodyWeightKg ?? bodyComp.weight_kg ?? bodyComp.weightKg ?? 0)
          let weightKg = 0
          if (rawGrams > 500) weightKg = rawGrams / 1000
          else if (rawKg > 0) weightKg = rawKg
          if (weightKg < 30 || weightKg > 300) continue  // sanity check
          existingDates.add(rp.metric_date)
          parsed.push({
            weigh_date: rp.metric_date,
            weight_grams: weightKg * 1000,
            bmi: Number(bodyComp.bmi) || null,
            body_fat_pct: Number(bodyComp.percentFat ?? bodyComp.bodyFatPct) || null,
            body_water_pct: Number(bodyComp.percentHydration ?? bodyComp.bodyWaterPct) || null,
            muscle_mass_grams: Number(bodyComp.muscleMassKg ?? bodyComp.muscle_mass_kg) > 0
              ? Number(bodyComp.muscleMassKg ?? bodyComp.muscle_mass_kg) * 1000 : null,
            bone_mass_grams: Number(bodyComp.boneMassKg ?? bodyComp.bone_mass_kg) > 0
              ? Number(bodyComp.boneMassKg ?? bodyComp.bone_mass_kg) * 1000 : null,
          })
        }
        // Sort chronologically after merging both fallback sources
        parsed.sort((a, b) => a.weigh_date.localeCompare(b.weigh_date))
      }
      setWeightEntries(parsed)

      setLoading(false)
    }
    load()
  }, [router])

  const saveHeight = async () => {
    const h = parseFloat(heightInput)
    if (!h || h < 100 || h > 250 || !currentUserId) return
    setSavingHeight(true)
    await supabase.from('profiles').upsert({ user_id: currentUserId, height_cm: h }, { onConflict: 'user_id' })
    setHeightCm(h)
    setHeightInput('')
    setSavingHeight(false)
  }

  if (loading) {
    return (
      <main className="min-h-screen bg-gray-950 flex items-center justify-center">
        <p className="text-gray-400">Loading your stats...</p>
        <BottomNav />
      </main>
    )
  }

  // ── Weekly stats ────────────────────────────────────────────────────────────
  const weekStart = getMondayOfWeek(new Date())
  const thisWeek = activities.filter(a => new Date(a.start_time) >= weekStart)

  const filterByTab = (acts: Activity[]) => {
    if (activeTab === 'all') return acts
    if (activeTab === 'run') return acts.filter(a => {
      const t = getTypeKey(a).toLowerCase()
      return t.includes('run') || t.includes('jog') || t.includes('treadmill')
    })
    if (activeTab === 'walk') return acts.filter(a => getTypeKey(a).toLowerCase().includes('walk'))
    if (activeTab === 'strength') return acts.filter(a => {
      const t = getTypeKey(a).toLowerCase()
      return t.includes('strength') || t.includes('gym') || t.includes('weight')
    })
    return acts
  }

  const weekFiltered = filterByTab(thisWeek)
  const weekDistance = weekFiltered.reduce((s, a) => s + (a.distance_m ?? 0), 0)
  const weekTime = weekFiltered.reduce((s, a) => s + (a.duration_sec ?? 0), 0)
  const weekCount = weekFiltered.length

  // Elevation from raw_payload
  const weekElevation = weekFiltered.reduce((s, a) => {
    const elev = (a.raw_payload?.elevationGain ?? a.raw_payload?.totalElevationGain) as number | undefined
    return s + (elev ?? 0)
  }, 0)

  // ── Streak ──────────────────────────────────────────────────────────────────
  const activityDates = new Set(activities.map(a => a.start_time.split('T')[0]))
  let streak = 0
  const today = new Date()
  for (let i = 0; i < 365; i++) {
    const d = new Date(today)
    d.setDate(today.getDate() - i)
    if (activityDates.has(d.toISOString().split('T')[0])) streak++
    else if (i > 0) break
  }

  // ── Training zones (aggregate last 30 days) ─────────────────────────────────
  const zoneMins = [0, 0, 0, 0, 0]
  activities.forEach(a => {
    const raw = a.raw_payload ?? {}
    for (let i = 1; i <= 5; i++) {
      const val = raw[`hrTimeInZone_${i}`]
      if (val != null) zoneMins[i - 1] += Math.round(Number(val) / 60)
    }
  })
  const totalZoneMins = zoneMins.reduce((s, v) => s + v, 0)
  const topZone = zoneMins.indexOf(Math.max(...zoneMins))

  // ── Performance predictions ─────────────────────────────────────────────────
  const vo2maxValues = activities
    .map(a => {
      const v = a.raw_payload?.vO2MaxValue ?? a.raw_payload?.vo2MaxValue
      return v != null ? Number(v) : null
    })
    .filter((v): v is number => v != null)
  const latestVo2max = vo2maxValues[0] ?? null
  const raceTimes = latestVo2max ? estimateRaceTimes(latestVo2max) : null

  // ── Best efforts (running PRs) ──────────────────────────────────────────────
  const runActivities = activities.filter(a => {
    const t = getTypeKey(a).toLowerCase()
    return (t.includes('run') || t.includes('jog') || t.includes('treadmill')) && a.distance_m && a.distance_m > 100
  })

  // Find fastest pace activities
  const bestPaceRun = runActivities
    .filter(a => a.distance_m && a.duration_sec && a.distance_m > 4000)
    .sort((a, b) => {
      const paceA = (a.duration_sec ?? 999999) / (a.distance_m ?? 1)
      const paceB = (b.duration_sec ?? 999999) / (b.distance_m ?? 1)
      return paceA - paceB
    })[0] ?? null

  const longestRun = runActivities
    .sort((a, b) => (b.distance_m ?? 0) - (a.distance_m ?? 0))[0] ?? null

  // ── Monthly trend (fitness metric) ─────────────────────────────────────────
  // Use body battery or HRV as proxy for fitness trend
  const trendData = metrics
    .filter(m => m.garmin_body_battery_high != null || m.garmin_hrv_nightly_avg != null)
    .slice(-14) // last 14 days
  const maxTrend = Math.max(...trendData.map(m => m.garmin_body_battery_high ?? m.garmin_hrv_nightly_avg ?? 0), 1)

  // ── Weight computations ─────────────────────────────────────────────────────
  const latestWeight = weightEntries.length > 0 ? weightEntries[weightEntries.length - 1] : null
  const latestWeightKg = latestWeight ? latestWeight.weight_grams / 1000 : null

  const weightByDate = new Map(weightEntries.map(e => [e.weigh_date, e.weight_grams / 1000]))

  const weightDelta = (daysAgo: number): number | null => {
    if (!latestWeight) return null
    const targetDate = new Date(latestWeight.weigh_date)
    targetDate.setDate(targetDate.getDate() - daysAgo)
    // Find closest entry within ±3 days of target
    let closest: number | null = null
    let closestDiff = 999
    for (const [date, kg] of weightByDate) {
      const diff = Math.abs((new Date(date).getTime() - targetDate.getTime()) / 86400000)
      if (diff < closestDiff && diff <= 3) { closestDiff = diff; closest = kg }
    }
    return closest != null ? (latestWeightKg! - closest) : null
  }

  const delta7 = weightDelta(7)
  const delta30 = weightDelta(30)

  // Weekly rate of change over last 30 days
  const weightRateKgPerWeek = (() => {
    const recent = weightEntries.slice(-30)
    if (recent.length < 2) return null
    const first = recent[0], last = recent[recent.length - 1]
    const days = (new Date(last.weigh_date).getTime() - new Date(first.weigh_date).getTime()) / 86400000
    if (days < 3) return null
    return ((last.weight_grams - first.weight_grams) / 1000) / (days / 7)
  })()

  // BMI
  const bmi = latestWeightKg != null && heightCm != null
    ? latestWeightKg / Math.pow(heightCm / 100, 2) : null
  const bmiLabel = bmi == null ? null
    : bmi < 18.5 ? 'Underweight'
    : bmi < 25 ? 'Healthy weight'
    : bmi < 30 ? 'Overweight'
    : 'Obese'
  const bmiColor = bmi == null ? '#9ca3af'
    : bmi < 18.5 ? '#3b82f6'
    : bmi < 25 ? '#21c55d'
    : bmi < 30 ? '#f97316'
    : '#ef4444'

  // Ideal weight range (BMI 18.5–24.9) if height known
  const idealWeightRange = heightCm != null ? {
    min: 18.5 * Math.pow(heightCm / 100, 2),
    max: 24.9 * Math.pow(heightCm / 100, 2),
  } : null

  // Latest body fat / muscle mass from the most recent entry that has it
  const latestBodyFat = [...weightEntries].reverse().find(e => e.body_fat_pct != null)?.body_fat_pct ?? null
  const latestMuscleMassKg = [...weightEntries].reverse().find(e => e.muscle_mass_grams != null)
    ?.muscle_mass_grams ? (([...weightEntries].reverse().find(e => e.muscle_mass_grams != null)!.muscle_mass_grams!) / 1000) : null

  return (
    <main className="min-h-screen bg-gray-950 pb-24 px-4 py-4">
      <div className="mx-auto max-w-2xl space-y-4">

        {/* Header */}
        <div className="flex items-center justify-between pt-2">
          <div>
            <h1 className="text-2xl font-bold text-white">You</h1>
            {streak > 1 && <p className="text-orange-400 text-sm">🔥 {streak} day streak</p>}
          </div>
          {displayName && <p className="text-gray-500 text-sm">{displayName}</p>}
        </div>

        {/* This week */}
        <Section title="This Week">
          {/* Tab filter */}
          <div className="flex gap-2 overflow-x-auto pb-1">
            {(['all', 'run', 'walk', 'strength'] as const).map(t => (
              <button
                key={t}
                onClick={() => setActiveTab(t)}
                className={`px-3 py-1.5 rounded-full text-xs font-semibold whitespace-nowrap transition-colors ${
                  activeTab === t
                    ? 'bg-orange-500 text-white'
                    : 'bg-gray-800 text-gray-400 hover:bg-gray-700'
                }`}
              >
                {t === 'all' ? 'All' : t === 'run' ? '🏃 Run' : t === 'walk' ? '🚶 Walk' : '🏋️ Strength'}
              </button>
            ))}
          </div>

          <div className="grid grid-cols-3 gap-4 pt-1">
            <StatBlock
              label="Distance"
              value={weekDistance >= 1000 ? formatDistance(weekDistance) : `${Math.round(weekDistance)}m`}
            />
            <StatBlock label="Time" value={formatDuration(weekTime)} />
            <StatBlock label="Activities" value={String(weekCount)} />
          </div>
          {weekElevation > 0 && (
            <p className="text-gray-500 text-xs">↑ {Math.round(weekElevation)}m elevation gain</p>
          )}

          {/* Recent activity list */}
          {weekFiltered.length > 0 && (
            <div className="space-y-2 pt-1">
              {weekFiltered.slice(0, 5).map(a => {
                const raw = a.raw_payload ?? {}
                const speed = raw.averageSpeed as number | undefined
                return (
                  <a key={a.id} href={`/activities/${a.id}`} className="flex items-center gap-3 py-2 border-t border-gray-800 hover:bg-gray-800/40 -mx-1 px-1 rounded-lg transition-colors">
                    <div className="flex-1 min-w-0">
                      <p className="text-white text-sm font-medium truncate">{getActivityName(a)}</p>
                      <p className="text-gray-500 text-xs">
                        {new Date(a.start_time).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })}
                        {a.duration_sec ? ` · ${formatDuration(a.duration_sec)}` : ''}
                        {a.distance_m && a.distance_m > 100 ? ` · ${formatDistance(a.distance_m)}` : ''}
                      </p>
                    </div>
                    {speed && a.distance_m && a.distance_m > 100 && (
                      <p className="text-gray-400 text-xs shrink-0">{formatPace(speed)}</p>
                    )}
                  </a>
                )
              })}
            </div>
          )}
        </Section>

        {/* Garmin Race Predictions (official) */}
        {racePredictions && racePredictions.length > 0 && (() => {
          const formatted = racePredictions.map(formatGarminPrediction).filter(Boolean) as { label: string; time: string }[]
          if (formatted.length === 0) return null
          return (
            <Section title="🏅 Race Predictions">
              <p className="text-gray-500 text-xs">From Garmin Performance Analytics</p>
              <div className="grid grid-cols-2 gap-3">
                {formatted.map(r => (
                  <div key={r.label} className="bg-gray-800/60 rounded-xl p-3">
                    <p className="text-gray-500 text-xs mb-1">{r.label}</p>
                    <p className="text-white font-bold text-lg">{r.time}</p>
                  </div>
                ))}
              </div>
            </Section>
          )
        })()}

        {/* VO2-based estimates (fallback when no Garmin predictions) */}
        {!racePredictions && raceTimes && (
          <Section title="🏅 Performance Predictions">
            <p className="text-gray-500 text-xs">Estimated from VO2 Max {latestVo2max?.toFixed(1)} · Sync for Garmin predictions</p>
            <div className="grid grid-cols-2 gap-3">
              {[
                { label: '5K', time: raceTimes.fiveK },
                { label: '10K', time: raceTimes.tenK },
                { label: 'Half Marathon', time: raceTimes.half },
                { label: 'Marathon', time: raceTimes.full },
              ].map(r => (
                <div key={r.label} className="bg-gray-800/60 rounded-xl p-3">
                  <p className="text-gray-500 text-xs mb-1">{r.label}</p>
                  <p className="text-white font-bold text-lg">{secsToTime(r.time)}</p>
                </div>
              ))}
            </div>
          </Section>
        )}

        {/* Garmin Personal Records */}
        {garminPRs && garminPRs.length > 0 && (() => {
          const formatted = garminPRs.map(formatGarminPR).filter(Boolean) as { label: string; value: string; date: string }[]
          if (formatted.length === 0) return null
          return (
            <Section title="🏆 Personal Records (Garmin)">
              <div className="space-y-2">
                {formatted.map((pr, i) => (
                  <div key={i} className="flex items-center justify-between py-2 border-b border-gray-800 last:border-0">
                    <div>
                      <p className="text-white text-sm font-medium">{pr.label}</p>
                      {pr.date && <p className="text-gray-500 text-xs">{pr.date}</p>}
                    </div>
                    <p className="text-orange-400 font-bold">{pr.value}</p>
                  </div>
                ))}
              </div>
            </Section>
          )
        })()}

        {/* Training zones */}
        {totalZoneMins > 0 && (
          <Section title="Training Zones">
            <p className="text-gray-500 text-xs">
              Most time in <span className="text-white">{ZONE_LABELS[topZone]}</span> — {Math.round((zoneMins[topZone] / totalZoneMins) * 100)}% of training
            </p>
            <div className="space-y-2">
              {zoneMins.map((min, i) => {
                const pct = totalZoneMins > 0 ? Math.round((min / totalZoneMins) * 100) : 0
                const h = Math.floor(min / 60)
                const m = min % 60
                return (
                  <div key={i} className="flex items-center gap-3">
                    <span className="text-gray-400 text-xs w-6 shrink-0">{ZONE_LABELS[i]}</span>
                    <div className="flex-1 bg-gray-800 rounded-full h-2.5">
                      <div className={`${ZONE_COLORS[i]} h-2.5 rounded-full transition-all`} style={{ width: `${pct}%` }} />
                    </div>
                    <span className="text-gray-400 text-xs w-16 text-right shrink-0">
                      {h > 0 ? `${h}h ${m}m` : `${m}m`}
                    </span>
                  </div>
                )
              })}
            </div>
          </Section>
        )}

        {/* Best efforts */}
        {(bestPaceRun || longestRun) && (
          <Section title="🏆 Best Efforts">
            <div className="space-y-3">
              {bestPaceRun && bestPaceRun.duration_sec && bestPaceRun.distance_m && (
                <a href={`/activities/${bestPaceRun.id}`} className="flex items-center justify-between py-2 border-b border-gray-800 hover:bg-gray-800/40 -mx-1 px-1 rounded-lg transition-colors">
                  <div>
                    <p className="text-white text-sm font-medium">Fastest Pace</p>
                    <p className="text-gray-500 text-xs">
                      {getActivityName(bestPaceRun)} · {new Date(bestPaceRun.start_time).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="text-orange-400 font-bold">{formatPace(bestPaceRun.distance_m / bestPaceRun.duration_sec)}</p>
                    <p className="text-gray-500 text-xs">{formatDistance(bestPaceRun.distance_m)}</p>
                  </div>
                </a>
              )}
              {longestRun && longestRun.distance_m && (
                <a href={`/activities/${longestRun.id}`} className="flex items-center justify-between py-2 hover:bg-gray-800/40 -mx-1 px-1 rounded-lg transition-colors">
                  <div>
                    <p className="text-white text-sm font-medium">Longest Run</p>
                    <p className="text-gray-500 text-xs">
                      {getActivityName(longestRun)} · {new Date(longestRun.start_time).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="text-orange-400 font-bold">{formatDistance(longestRun.distance_m)}</p>
                    {longestRun.duration_sec && <p className="text-gray-500 text-xs">{formatDuration(longestRun.duration_sec)}</p>}
                  </div>
                </a>
              )}
            </div>
          </Section>
        )}

        {/* Weight — compact tile, click for modal */}
        {latestWeightKg != null && (
          <Section title="⚖️ Weight">
            <button
              onClick={() => setShowWeightModal(true)}
              className="w-full text-left"
            >
              <div className="bg-gray-800/60 rounded-2xl p-4 flex items-start justify-between active:bg-gray-700/60 transition-colors">
                <div className="flex-1">
                  <p className="text-white font-bold text-3xl leading-none">{fmtStoneLb(latestWeightKg)}</p>
                  <p className="text-gray-500 text-xs mt-1">{latestWeightKg.toFixed(1)} kg</p>
                  {/* Change row */}
                  {delta7 != null && (
                    <p className={`text-sm font-medium mt-2 ${delta7 < -0.05 ? 'text-green-400' : delta7 > 0.05 ? 'text-red-400' : 'text-gray-400'}`}>
                      {delta7 >= 0 ? '+' : '−'}{fmtWeightDelta(delta7)} <span className="text-gray-500 text-xs font-normal">since last week</span>
                    </p>
                  )}
                  <div className="flex gap-4 mt-3">
                    {bmi != null && (
                      <div>
                        <p className="text-gray-500 text-[10px]">BMI</p>
                        <p className="font-bold text-sm" style={{ color: bmiColor }}>{bmi.toFixed(1)}</p>
                      </div>
                    )}
                    {latestBodyFat != null && (
                      <div>
                        <p className="text-gray-500 text-[10px]">Body Fat</p>
                        <p className="text-white font-bold text-sm">{latestBodyFat.toFixed(1)}%</p>
                      </div>
                    )}
                    {latestMuscleMassKg != null && (
                      <div>
                        <p className="text-gray-500 text-[10px]">Muscle</p>
                        <p className="text-white font-bold text-sm">{latestMuscleMassKg.toFixed(1)} kg</p>
                      </div>
                    )}
                  </div>
                </div>
                <div className="flex flex-col items-end gap-2 ml-3">
                  {latestWeight?.weigh_date && (
                    <p className="text-gray-600 text-[10px]">
                      Updated {new Date(latestWeight.weigh_date).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}
                    </p>
                  )}
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-5 h-5 text-gray-600 mt-1">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                  </svg>
                </div>
              </div>
            </button>
          </Section>
        )}

        {/* Weight modal */}
        {showWeightModal && latestWeightKg != null && (
          <div
            className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm"
            onClick={() => setShowWeightModal(false)}
          >
            <div
              className="relative w-full max-w-lg max-h-[85vh] overflow-y-auto bg-gradient-to-br from-orange-950/90 via-gray-900 to-gray-950 rounded-3xl p-6 border border-orange-500/30 shadow-2xl"
              onClick={e => e.stopPropagation()}
            >
              {/* X button */}
              <button
                onClick={() => setShowWeightModal(false)}
                className="absolute top-3 right-3 w-8 h-8 rounded-full bg-gray-800/80 hover:bg-gray-700 text-gray-300 hover:text-white flex items-center justify-center transition-colors"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>

              {/* Header */}
              <div className="flex items-center gap-3 mb-4">
                <span className="text-2xl">⚖️</span>
                <div>
                  <p className="text-lg font-bold text-white">Weight & Body Composition</p>
                  <p className="text-sm text-gray-300">Week · Month · Year</p>
                </div>
              </div>

              {/* Stats grid */}
              <div className="grid grid-cols-3 gap-2 mb-4">
                <div className="bg-gray-800/80 rounded-xl p-3 text-center">
                  <p className="text-[10px] text-gray-300 uppercase font-semibold">Current</p>
                  <p className="text-xl font-bold text-orange-300 mt-0.5 leading-tight">{fmtStoneLb(latestWeightKg)}</p>
                  <p className="text-[10px] text-gray-500 mt-0.5">{latestWeightKg.toFixed(1)} kg</p>
                  {latestWeight?.weigh_date && (
                    <p className="text-[10px] text-gray-600">
                      {new Date(latestWeight.weigh_date).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}
                    </p>
                  )}
                </div>
                <div className="bg-gray-800/80 rounded-xl p-3 text-center">
                  <p className="text-[10px] text-gray-300 uppercase font-semibold">7-day</p>
                  {delta7 != null ? (
                    <>
                      <p className={`text-xl font-bold mt-0.5 leading-tight ${delta7 < -0.05 ? 'text-green-400' : delta7 > 0.05 ? 'text-red-400' : 'text-gray-300'}`}>
                        {delta7 >= 0 ? '+' : '−'}{fmtWeightDelta(delta7)}
                      </p>
                      <p className="text-[10px] text-gray-500 mt-0.5">{delta7 >= 0 ? '+' : ''}{delta7.toFixed(2)} kg</p>
                      <p className="text-[10px] text-gray-600">{delta7 < -0.05 ? '↓ down' : delta7 > 0.05 ? '↑ up' : '→ stable'}</p>
                    </>
                  ) : <p className="text-xl font-bold text-gray-600 mt-0.5">—</p>}
                </div>
                <div className="bg-gray-800/80 rounded-xl p-3 text-center">
                  <p className="text-[10px] text-gray-300 uppercase font-semibold">30-day</p>
                  {delta30 != null ? (
                    <>
                      <p className={`text-xl font-bold mt-0.5 leading-tight ${delta30 < -0.05 ? 'text-green-400' : delta30 > 0.05 ? 'text-red-400' : 'text-gray-300'}`}>
                        {delta30 >= 0 ? '+' : '−'}{fmtWeightDelta(delta30)}
                      </p>
                      <p className="text-[10px] text-gray-500 mt-0.5">{delta30 >= 0 ? '+' : ''}{delta30.toFixed(2)} kg</p>
                      {weightRateKgPerWeek != null && (
                        <p className="text-[10px] text-gray-600">{weightRateKgPerWeek >= 0 ? '+' : ''}{weightRateKgPerWeek.toFixed(2)} kg/wk</p>
                      )}
                    </>
                  ) : <p className="text-xl font-bold text-gray-600 mt-0.5">—</p>}
                </div>
              </div>

              {/* Tab + chart */}
              {weightEntries.length > 0 && (() => {
                const today = new Date()

                const buildWeekEntries = (offset: number) => {
                  const monday = new Date(today)
                  monday.setDate(today.getDate() - ((today.getDay() + 6) % 7) - offset * 7)
                  monday.setHours(0, 0, 0, 0)
                  const days: { label: string; kg: number | null; isCurrent?: boolean }[] = []
                  for (let i = 0; i < 7; i++) {
                    const d = new Date(monday); d.setDate(monday.getDate() + i)
                    const ds = localDateStr(d)
                    days.push({ label: d.toLocaleDateString('en-GB', { weekday: 'short' }), kg: weightByDate.get(ds) ?? null, isCurrent: ds === localDateStr(today) })
                  }
                  const sunday = new Date(monday); sunday.setDate(monday.getDate() + 6)
                  return { entries: days, rangeLabel: `${monday.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })} – ${sunday.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}` }
                }

                const buildMonthEntries = (offset: number) => {
                  const target = new Date(today.getFullYear(), today.getMonth() - offset, 1)
                  const daysInMonth = new Date(target.getFullYear(), target.getMonth() + 1, 0).getDate()
                  const days: { label: string; kg: number | null; isCurrent?: boolean }[] = []
                  for (let i = 1; i <= daysInMonth; i++) {
                    const d = new Date(target.getFullYear(), target.getMonth(), i)
                    const ds = localDateStr(d)
                    days.push({ label: String(i), kg: weightByDate.get(ds) ?? null, isCurrent: ds === localDateStr(today) })
                  }
                  return { entries: days, rangeLabel: target.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' }) }
                }

                const buildYearEntries = (offset: number) => {
                  const targetYear = today.getFullYear() - offset
                  const months: { label: string; kg: number | null; isCurrent?: boolean }[] = []
                  for (let m = 0; m < 12; m++) {
                    let bestKg: number | null = null
                    for (const [ds, kg] of weightByDate) {
                      const d = new Date(ds)
                      if (d.getFullYear() === targetYear && d.getMonth() === m) bestKg = kg
                    }
                    months.push({ label: new Date(targetYear, m, 1).toLocaleDateString('en-GB', { month: 'short' }), kg: bestKg, isCurrent: today.getMonth() === m && today.getFullYear() === targetYear })
                  }
                  return { entries: months, rangeLabel: String(targetYear) }
                }

                const { entries: chartEntries, rangeLabel } =
                  weightTab === 'week' ? buildWeekEntries(weightWeekOffset) :
                  weightTab === 'month' ? buildMonthEntries(weightMonthOffset) :
                  buildYearEntries(weightYearOffset)

                const offset = weightTab === 'week' ? weightWeekOffset : weightTab === 'month' ? weightMonthOffset : weightYearOffset
                const setOffset = weightTab === 'week' ? setWeightWeekOffset : weightTab === 'month' ? setWeightMonthOffset : setWeightYearOffset

                return (
                  <div className="space-y-3 mb-4">
                    {/* Tab pills — same style as steps modal */}
                    <div className="flex gap-2">
                      {(['week', 'month', 'year'] as const).map(t => (
                        <button
                          key={t}
                          onClick={() => setWeightTab(t)}
                          className={`flex-1 py-1.5 rounded-xl text-xs font-semibold transition-colors ${weightTab === t ? 'bg-orange-600 text-white' : 'bg-gray-800/80 text-gray-400 hover:text-white'}`}
                        >
                          {t.charAt(0).toUpperCase() + t.slice(1)}
                        </button>
                      ))}
                    </div>
                    {/* Navigation */}
                    <div className="flex items-center justify-between">
                      <button onClick={() => setOffset(o => o + 1)} className="w-8 h-8 flex items-center justify-center rounded-lg bg-gray-800 text-gray-400 hover:text-white hover:bg-gray-700 transition-colors text-lg">‹</button>
                      <span className="text-xs text-gray-400 font-medium">{rangeLabel}</span>
                      <button onClick={() => setOffset(o => Math.max(0, o - 1))} disabled={offset === 0} className="w-8 h-8 flex items-center justify-center rounded-lg bg-gray-800 text-gray-400 hover:text-white hover:bg-gray-700 transition-colors text-lg disabled:opacity-30">›</button>
                    </div>
                    {/* Chart */}
                    <WeightLineChart entries={chartEntries} />
                  </div>
                )
              })()}

              {/* BMI + Ideal range */}
              {bmi != null ? (
                <div className="grid grid-cols-2 gap-3 mb-4">
                  <div className="bg-gray-800/80 rounded-xl p-3">
                    <p className="text-[10px] text-gray-300 uppercase font-semibold mb-1">BMI</p>
                    <p className="font-bold text-xl" style={{ color: bmiColor }}>{bmi.toFixed(1)}</p>
                    <p className="text-xs mt-0.5" style={{ color: bmiColor }}>{bmiLabel}</p>
                  </div>
                  {idealWeightRange && (
                    <div className="bg-gray-800/80 rounded-xl p-3">
                      <p className="text-[10px] text-gray-300 uppercase font-semibold mb-1">Healthy range</p>
                      <p className="text-white font-bold text-sm">{fmtStoneLb(idealWeightRange.min)}–{fmtStoneLb(idealWeightRange.max)}</p>
                      <p className="text-[10px] text-gray-500 mt-0.5">{idealWeightRange.min.toFixed(1)}–{idealWeightRange.max.toFixed(1)} kg</p>
                      <p className="text-xs text-gray-400 mt-0.5">
                        {latestWeightKg < idealWeightRange.min ? `${fmtWeightDelta(idealWeightRange.min - latestWeightKg)} to gain`
                          : latestWeightKg > idealWeightRange.max ? `${fmtWeightDelta(latestWeightKg - idealWeightRange.max)} to lose`
                          : '✓ In range'}
                      </p>
                    </div>
                  )}
                </div>
              ) : (
                <div className="flex items-center gap-2 bg-gray-800/40 rounded-xl p-3 mb-4">
                  <p className="text-xs text-gray-400 shrink-0">Set height for BMI:</p>
                  <input
                    type="number"
                    placeholder="cm"
                    value={heightInput}
                    onChange={e => setHeightInput(e.target.value)}
                    className="flex-1 bg-gray-800 text-white text-sm rounded-lg px-2 py-1.5 outline-none focus:ring-1 focus:ring-orange-500 w-0 min-w-0 placeholder-gray-600"
                  />
                  <button
                    onClick={saveHeight}
                    disabled={savingHeight || !heightInput}
                    className="shrink-0 text-xs px-3 py-1.5 rounded-lg bg-orange-600 hover:bg-orange-500 disabled:opacity-40 text-white transition-colors"
                  >
                    {savingHeight ? '…' : 'Save'}
                  </button>
                </div>
              )}

              {/* Body composition */}
              {(latestBodyFat != null || latestMuscleMassKg != null) && (
                <div className="grid grid-cols-2 gap-3 mb-4">
                  {latestBodyFat != null && (
                    <div className="bg-gray-800/80 rounded-xl p-3">
                      <p className="text-[10px] text-gray-300 uppercase font-semibold mb-1">Body Fat</p>
                      <p className="text-white font-bold text-xl">{latestBodyFat.toFixed(1)}%</p>
                      <p className="text-xs text-gray-500 mt-0.5">
                        {latestBodyFat < 10 ? 'Essential fat' : latestBodyFat < 20 ? 'Athlete' : latestBodyFat < 25 ? 'Fitness' : latestBodyFat < 32 ? 'Average' : 'Above average'}
                      </p>
                    </div>
                  )}
                  {latestMuscleMassKg != null && (
                    <div className="bg-gray-800/80 rounded-xl p-3">
                      <p className="text-[10px] text-gray-300 uppercase font-semibold mb-1">Muscle Mass</p>
                      <p className="text-white font-bold text-xl">{latestMuscleMassKg.toFixed(1)} kg</p>
                      <p className="text-xs text-gray-500 mt-0.5">From Garmin scale</p>
                    </div>
                  )}
                </div>
              )}

              {/* Back button */}
              <button
                onClick={() => setShowWeightModal(false)}
                className="mt-2 w-full bg-gray-800/80 hover:bg-gray-700 text-gray-200 text-sm py-2 rounded-xl transition-colors"
              >
                Back to dashboard
              </button>
            </div>
          </div>
        )}

        {/* Monthly fitness trend */}
        {trendData.length > 3 && (
          <Section title="Monthly Fitness Trend">
            <p className="text-gray-500 text-xs">Body Battery (last {trendData.length} days)</p>
            <div className="flex items-end gap-1 h-16">
              {trendData.map((d, i) => {
                const val = d.garmin_body_battery_high ?? d.garmin_hrv_nightly_avg ?? 0
                const heightPct = maxTrend > 0 ? Math.max((val / maxTrend) * 100, 4) : 4
                const isToday = i === trendData.length - 1
                return (
                  <div
                    key={d.metric_date}
                    className="flex-1 rounded-sm transition-all"
                    style={{
                      height: `${heightPct}%`,
                      backgroundColor: isToday ? '#f97316' : '#374151',
                    }}
                    title={`${d.metric_date}: ${val}`}
                  />
                )
              })}
            </div>
            <div className="flex justify-between text-gray-600 text-xs">
              <span>{new Date(trendData[0].metric_date).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}</span>
              <span>Today</span>
            </div>
          </Section>
        )}

      </div>
      <BottomNav />
    </main>
  )
}

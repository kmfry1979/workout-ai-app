'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '../../lib/supabase'
import { BottomNav } from '../../components/BottomNav'

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

  useEffect(() => {
    const load = async () => {
      const { data } = await supabase.auth.getSession()
      if (!data.session) { router.push('/login'); return }
      const user = data.session.user

      setCurrentUserId(user.id)

      const { data: profile } = await supabase
        .from('profiles')
        .select('display_name, name, height_cm')
        .eq('user_id', user.id)
        .maybeSingle()
      setDisplayName(profile?.display_name ?? profile?.name ?? '')
      const hCm = (profile as { height_cm?: number | null } | null)?.height_cm ?? null
      setHeightCm(hCm)

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

      // Weight data — from dedicated table (falls back gracefully if not yet created)
      const ninetyDaysAgoDate = ninetyDaysAgo.toISOString().split('T')[0]
      const { data: weightRaw } = await supabase
        .from('garmin_weight_snapshots')
        .select('weigh_date, weight_grams, bmi, body_fat_pct, body_water_pct, muscle_mass_grams, bone_mass_grams')
        .eq('user_id', user.id)
        .gte('weigh_date', ninetyDaysAgoDate)
        .order('weigh_date', { ascending: true })

      if (weightRaw && weightRaw.length > 0) {
        setWeightEntries(weightRaw as WeightEntry[])
      } else {
        // Fallback: parse body_composition JSONB from daily_health_metrics
        const { data: legacyMet } = await supabase
          .from('daily_health_metrics')
          .select('metric_date, body_composition')
          .eq('user_id', user.id)
          .gte('metric_date', ninetyDaysAgoDate)
          .order('metric_date', { ascending: true })

        const parsed: WeightEntry[] = []
        for (const row of (legacyMet ?? [])) {
          const bc = (row as { body_composition?: Record<string, unknown> | null }).body_composition
          if (!bc) continue
          // Try multiple known Garmin JSONB shapes
          const weightEntry = (bc.weightEntry as Record<string, unknown> | undefined) ?? bc
          const wg = Number(weightEntry.weight ?? weightEntry.weightInGrams ?? weightEntry.weightKg)
          if (!wg || wg <= 0) continue
          // Garmin returns weight in grams if > 1000, else kg
          const weightGrams = wg > 1000 ? wg : wg * 1000
          parsed.push({
            weigh_date: (row as { metric_date: string }).metric_date,
            weight_grams: weightGrams,
            bmi: Number(weightEntry.bmi) || null,
            body_fat_pct: Number(weightEntry.percentFat ?? weightEntry.bodyFat) || null,
            body_water_pct: Number(weightEntry.percentHydration ?? weightEntry.bodyWater) || null,
            muscle_mass_grams: Number(weightEntry.muscleWeightGrams ?? weightEntry.muscleMass) || null,
            bone_mass_grams: Number(weightEntry.boneMassGrams ?? weightEntry.boneMass) || null,
          })
        }
        setWeightEntries(parsed)
      }

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

        {/* Performance Predictions */}
        {raceTimes && (
          <Section title="🏅 Performance Predictions">
            <p className="text-gray-500 text-xs">Based on VO2 Max {latestVo2max?.toFixed(1)}</p>
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

        {/* Weight & Body Composition */}
        {latestWeightKg != null && (
          <Section title="⚖️ Weight & Body Composition">
            {/* Current + deltas */}
            <div className="grid grid-cols-3 gap-4">
              <StatBlock
                label="Current"
                value={`${latestWeightKg.toFixed(1)} kg`}
                sub={latestWeight?.weigh_date
                  ? new Date(latestWeight.weigh_date).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
                  : undefined}
              />
              <StatBlock
                label="7-day"
                value={delta7 != null ? `${delta7 >= 0 ? '+' : ''}${delta7.toFixed(1)} kg` : '—'}
                sub={delta7 != null ? (delta7 < -0.1 ? '↓ down' : delta7 > 0.1 ? '↑ up' : '→ stable') : undefined}
              />
              <StatBlock
                label="30-day"
                value={delta30 != null ? `${delta30 >= 0 ? '+' : ''}${delta30.toFixed(1)} kg` : '—'}
                sub={weightRateKgPerWeek != null ? `${weightRateKgPerWeek >= 0 ? '+' : ''}${weightRateKgPerWeek.toFixed(2)} kg/wk` : undefined}
              />
            </div>

            {/* Weight sparkline */}
            {weightEntries.length >= 3 && (
              <div>
                <p className="text-gray-500 text-xs mb-1">90-day trend</p>
                <div className="relative bg-gray-800 rounded-xl overflow-hidden" style={{ height: 52 }}>
                  {(() => {
                    const vals = weightEntries.map(e => e.weight_grams / 1000)
                    const min = Math.min(...vals) - 0.5
                    const max = Math.max(...vals) + 0.5
                    const range = max - min || 1
                    const w = 300, h = 52
                    const pts = vals.map((v, i) => ({
                      x: (i / (vals.length - 1)) * w,
                      y: h - ((v - min) / range) * (h - 6) - 3,
                    }))
                    const d = pts.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ')
                    return (
                      <svg viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" className="w-full h-full">
                        <path d={d} fill="none" stroke="#f97316" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                        {/* Latest dot */}
                        <circle cx={pts[pts.length-1].x} cy={pts[pts.length-1].y} r="3" fill="#f97316" />
                      </svg>
                    )
                  })()}
                </div>
                <div className="flex justify-between text-gray-600 text-xs mt-1">
                  <span>{new Date(weightEntries[0].weigh_date).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}</span>
                  <span>Today</span>
                </div>
              </div>
            )}

            {/* BMI + Ideal range */}
            {bmi != null ? (
              <div className="grid grid-cols-2 gap-3">
                <div className="bg-gray-800/60 rounded-xl p-3">
                  <p className="text-gray-500 text-xs mb-1">BMI</p>
                  <p className="font-bold text-xl" style={{ color: bmiColor }}>{bmi.toFixed(1)}</p>
                  <p className="text-xs mt-0.5" style={{ color: bmiColor }}>{bmiLabel}</p>
                </div>
                {idealWeightRange && (
                  <div className="bg-gray-800/60 rounded-xl p-3">
                    <p className="text-gray-500 text-xs mb-1">Healthy range</p>
                    <p className="text-white font-bold text-sm">{idealWeightRange.min.toFixed(1)}–{idealWeightRange.max.toFixed(1)} kg</p>
                    <p className="text-xs text-gray-500 mt-0.5">
                      {latestWeightKg < idealWeightRange.min
                        ? `${(idealWeightRange.min - latestWeightKg).toFixed(1)} kg to gain`
                        : latestWeightKg > idealWeightRange.max
                        ? `${(latestWeightKg - idealWeightRange.max).toFixed(1)} kg to lose`
                        : '✓ In range'}
                    </p>
                  </div>
                )}
              </div>
            ) : (
              /* Height not set — inline prompt */
              <div className="flex items-center gap-2 bg-gray-800/40 rounded-xl p-3">
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

            {/* Body composition from Garmin scale (if available) */}
            {(latestBodyFat != null || latestMuscleMassKg != null) && (
              <div className="grid grid-cols-2 gap-3">
                {latestBodyFat != null && (
                  <div className="bg-gray-800/60 rounded-xl p-3">
                    <p className="text-gray-500 text-xs mb-1">Body Fat</p>
                    <p className="text-white font-bold text-xl">{latestBodyFat.toFixed(1)}%</p>
                    <p className="text-xs text-gray-500 mt-0.5">
                      {latestBodyFat < 10 ? 'Essential fat' : latestBodyFat < 20 ? 'Athlete' : latestBodyFat < 25 ? 'Fitness' : latestBodyFat < 32 ? 'Average' : 'Above average'}
                    </p>
                  </div>
                )}
                {latestMuscleMassKg != null && (
                  <div className="bg-gray-800/60 rounded-xl p-3">
                    <p className="text-gray-500 text-xs mb-1">Muscle Mass</p>
                    <p className="text-white font-bold text-xl">{latestMuscleMassKg.toFixed(1)} kg</p>
                    <p className="text-xs text-gray-500 mt-0.5">From Garmin scale</p>
                  </div>
                )}
              </div>
            )}
          </Section>
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

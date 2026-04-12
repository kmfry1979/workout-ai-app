'use client'

import { useEffect, useState } from 'react'
import { useRouter, useParams } from 'next/navigation'
import { supabase } from '../../../lib/supabase'

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

// ─── Stat block ───────────────────────────────────────────────────────────────

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-gray-800/60 rounded-xl p-3">
      <p className="text-gray-500 text-xs mb-1">{label}</p>
      <p className="text-white font-bold text-lg leading-none">{value}</p>
    </div>
  )
}

// ─── HR Zones ─────────────────────────────────────────────────────────────────

const ZONE_COLORS = ['bg-blue-500', 'bg-green-500', 'bg-yellow-500', 'bg-orange-500', 'bg-red-500']
const ZONE_LABELS = ['Z1 Recovery', 'Z2 Aerobic', 'Z3 Tempo', 'Z4 Threshold', 'Z5 Max']

function HrZones({ raw }: { raw: Record<string, unknown> }) {
  const zones = [1, 2, 3, 4, 5].map(i => {
    const val = raw[`hrTimeInZone_${i}`] ?? raw[`timeInHRZone${i}`]
    return val != null ? Math.round(Number(val) / 60) : null
  })

  const total = zones.reduce((s, v) => (s ?? 0) + (v ?? 0), 0) as number
  if (total === 0) return null

  return (
    <div className="bg-gray-900 rounded-2xl p-4">
      <h3 className="text-white font-semibold text-sm mb-3">Heart Rate Zones</h3>
      <div className="space-y-2">
        {zones.map((min, i) => {
          if (min == null) return null
          const pct = total > 0 ? Math.round((min / total) * 100) : 0
          return (
            <div key={i} className="flex items-center gap-3">
              <span className="text-gray-400 text-xs w-24 shrink-0">{ZONE_LABELS[i]}</span>
              <div className="flex-1 bg-gray-800 rounded-full h-2">
                <div
                  className={`${ZONE_COLORS[i]} h-2 rounded-full transition-all`}
                  style={{ width: `${pct}%` }}
                />
              </div>
              <span className="text-gray-400 text-xs w-10 text-right shrink-0">{min}m</span>
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
  const [analysis, setAnalysis] = useState<string | null>(null)
  const [analysisLoading, setAnalysisLoading] = useState(false)
  const [analysisError, setAnalysisError] = useState<string | null>(null)

  useEffect(() => {
    const load = async () => {
      const { data: session } = await supabase.auth.getSession()
      if (!session.session) { router.push('/login'); return }

      const { data } = await supabase
        .from('garmin_activities')
        .select('id, activity_type, start_time, duration_sec, distance_m, calories, avg_hr, max_hr, training_effect, raw_payload')
        .eq('id', id)
        .eq('user_id', session.session.user.id)
        .single()

      if (!data) { router.push('/activities'); return }
      setActivity(data as GarminActivity)
      setLoading(false)
    }
    load()
  }, [id, router])

  // Auto-fetch AI analysis once activity is loaded
  useEffect(() => {
    if (!activity) return
    setAnalysisLoading(true)
    fetch('/api/coach/activity', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ activity }),
    })
      .then(r => r.json())
      .then(d => {
        if (d.error) setAnalysisError(d.error)
        else setAnalysis(d.analysis)
      })
      .catch(e => setAnalysisError(e.message))
      .finally(() => setAnalysisLoading(false))
  }, [activity])

  if (loading || !activity) {
    return (
      <main className="min-h-screen bg-gray-950 flex items-center justify-center">
        <p className="text-gray-400">Loading activity...</p>
      </main>
    )
  }

  const raw = activity.raw_payload ?? {}
  const rawName = raw.activityName as string | undefined
  const rawTypeKey = (raw.activityType as Record<string, unknown> | undefined)?.typeKey as string | undefined
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
  const vo2max = (raw.vO2MaxValue ?? raw.vo2MaxValue) as number | undefined
  const steps = raw.steps as number | undefined
  const avgCadence = raw.averageRunningCadenceInStepsPerMinute as number | undefined

  const stats: { label: string; value: string }[] = [
    activity.duration_sec ? { label: 'Duration', value: formatDuration(activity.duration_sec) } : null,
    activity.distance_m && activity.distance_m > 100 ? { label: 'Distance', value: formatDistance(activity.distance_m) } : null,
    avgSpeed && activity.distance_m && activity.distance_m > 100 ? { label: 'Avg Pace', value: formatPace(avgSpeed) } : null,
    activity.avg_hr ? { label: 'Avg HR', value: `${activity.avg_hr} bpm` } : null,
    activity.max_hr ? { label: 'Max HR', value: `${activity.max_hr} bpm` } : null,
    activity.calories ? { label: 'Calories', value: `${Math.round(activity.calories)} kcal` } : null,
    aerobicTE ? { label: 'Aerobic TE', value: `${Number(aerobicTE).toFixed(1)} / 5.0` } : null,
    anaerobicTE ? { label: 'Anaerobic TE', value: `${Number(anaerobicTE).toFixed(1)} / 5.0` } : null,
    vo2max ? { label: 'VO2 Max', value: String(vo2max) } : null,
    steps ? { label: 'Steps', value: steps.toLocaleString() } : null,
    avgCadence ? { label: 'Cadence', value: `${Math.round(avgCadence)} spm` } : null,
  ].filter(Boolean) as { label: string; value: string }[]

  return (
    <main className="min-h-screen bg-gray-950 p-4 md:p-8">
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
            {activity.training_effect != null && (
              <div className="bg-orange-500/20 text-orange-400 text-sm font-bold px-3 py-1.5 rounded-xl shrink-0">
                TE {activity.training_effect.toFixed(1)}
              </div>
            )}
          </div>
        </div>

        {/* Stats grid */}
        {stats.length > 0 && (
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
            {stats.map(s => <Stat key={s.label} label={s.label} value={s.value} />)}
          </div>
        )}

        {/* HR Zones */}
        <HrZones raw={raw} />

        {/* AI Coach */}
        <div className="bg-gray-900 rounded-2xl overflow-hidden">
          <div className="flex items-center gap-2 px-4 pt-4 pb-3 border-b border-gray-800">
            <div className="w-6 h-6 bg-orange-500 rounded-full flex items-center justify-center text-xs font-bold text-white shrink-0">A</div>
            <p className="text-orange-400 text-sm font-bold uppercase tracking-wider">Athlete Intelligence</p>
          </div>
          <div className="px-4 py-4">
            {analysisLoading && (
              <div className="flex items-center gap-2 text-gray-400 text-sm">
                <span className="w-4 h-4 border border-orange-400 border-t-transparent rounded-full animate-spin" />
                Analysing your session...
              </div>
            )}
            {analysisError && (
              <p className="text-red-400 text-sm">{analysisError}</p>
            )}
            {analysis && (
              <p className="text-gray-200 text-sm leading-relaxed">{analysis}</p>
            )}
          </div>
        </div>

      </div>
    </main>
  )
}

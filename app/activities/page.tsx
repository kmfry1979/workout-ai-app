'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { BottomNav } from '../../components/BottomNav'
// Note: useState still used in ActivitiesPage for activities/loading/displayName
import { supabase } from '../../lib/supabase'

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

/** Extract clean name from Garmin's raw activityType dict string or plain string */
function cleanType(raw: string | null): string {
  if (!raw) return 'Activity'
  // Python dict repr: "{'TypeId': 13, 'TypeKey': 'Strength Training', ...}"
  const pyMatch = raw.match(/'TypeKey':\s*'([^']+)'/)
  if (pyMatch) return pyMatch[1]
  // JSON-style: '{"typeKey":"strength_training"}'
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

function generateTitle(activity: GarminActivity): string {
  const type = cleanType(activity.activity_type)
  const tod = timeOfDay(new Date(activity.start_time))
  return `${tod} ${type}`
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
  if (h > 0) return `${h}h ${m}m`
  return `${m}m`
}

function formatDistance(m: number): string {
  if (m >= 1000) return `${(m / 1000).toFixed(2)} km`
  return `${Math.round(m)} m`
}

function getLocation(raw: Record<string, unknown> | null): string | null {
  if (!raw) return null
  return (raw.locationName as string) ?? (raw.location_name as string) ?? null
}

/** Short auto-generated description from stats, no LLM needed */
function briefDescription(activity: GarminActivity): string {
  const type = cleanType(activity.activity_type).toLowerCase()
  const dur = activity.duration_sec ? `${Math.round(activity.duration_sec / 60)} min` : null
  const dist = activity.distance_m && activity.distance_m > 100
    ? formatDistance(activity.distance_m) : null
  const hr = activity.avg_hr ? `${activity.avg_hr} bpm` : null
  const cals = activity.calories ? `${Math.round(activity.calories)} cal` : null
  const te = activity.training_effect

  if ((type.includes('run') || type.includes('jog')) && dist && dur) {
    return `${dur} covering ${dist}${hr ? ` at ${hr} avg HR` : ''}${cals ? ` · ${cals}` : ''}.`
  }
  if (type.includes('treadmill') && dist && dur) {
    return `${dur} treadmill session covering ${dist}${hr ? ` · ${hr} avg HR` : ''}.`
  }
  if ((type.includes('strength') || type.includes('gym') || type.includes('weight')) && dur) {
    return `${dur} strength session${hr ? ` with ${hr} avg HR` : ''}${cals ? ` · ${cals}` : ''}.`
  }
  if (type.includes('walk') && dist) {
    return `${dist} walk${dur ? ` in ${dur}` : ''}${cals ? ` · ${cals} cal` : ''}.`
  }

  const parts = [dur, dist, hr ? `${hr} avg HR` : null, cals].filter(Boolean)
  const base = parts.join(' · ')
  return te && te >= 3.5
    ? `${base} — solid training effort (TE ${te.toFixed(1)}).`
    : base || 'Activity recorded.'
}

// ─── Streak helpers ───────────────────────────────────────────────────────────

function localDs(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`
}

function calcActivityStreak(datestrs: string[]): number {
  const set = new Set(datestrs)
  const d = new Date(); d.setHours(0,0,0,0)
  if (!set.has(localDs(d))) d.setDate(d.getDate() - 1)
  let streak = 0
  for (let i = 0; i < 366; i++) {
    if (set.has(localDs(d))) { streak++; d.setDate(d.getDate() - 1) } else break
  }
  return streak
}

function ActivityStreakBanner({ streak, activityDateStrs }: { streak: number; activityDateStrs: string[] }) {
  const dateSet = new Set(activityDateStrs)
  const today = new Date(); today.setHours(0,0,0,0)
  const todayStr = localDs(today)
  const dow = (today.getDay() + 6) % 7
  const DAY_LABELS = ['M','T','W','T','F','S','S']
  const weekDays = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(today); d.setDate(today.getDate() - dow + i)
    const ds = localDs(d)
    return { label: DAY_LABELS[i], ds, isToday: ds === todayStr, isFuture: d > today, hasActivity: dateSet.has(ds) }
  })
  return (
    <div className="bg-gray-900 rounded-2xl px-4 py-3 flex items-center gap-4">
      <div className="flex flex-col items-center shrink-0 w-12">
        <span className="text-3xl leading-none">🔥</span>
        <span className="text-orange-400 font-bold text-xl leading-tight">{streak}</span>
        <span className="text-gray-500 text-[10px] leading-none">{streak === 1 ? 'day' : 'days'}</span>
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-gray-400 text-[11px] font-semibold uppercase tracking-wider mb-2">Activity Streak</p>
        <div className="flex justify-between">
          {weekDays.map((wd, i) => (
            <div key={i} className="flex flex-col items-center gap-1">
              <span className="text-gray-600 text-[9px]">{wd.label}</span>
              <div className="w-7 h-7 rounded-full flex items-center justify-center text-[10px] font-bold"
                style={wd.hasActivity
                  ? { background: '#f97316', color: 'white' }
                  : wd.isToday
                  ? { background: 'transparent', border: '2px solid #f97316', color: '#f97316' }
                  : wd.isFuture
                  ? { background: 'transparent', border: '1px solid #1f2937' }
                  : { background: '#1f2937', color: '#374151' }
                }>
                {wd.hasActivity ? '✓' : wd.isToday ? '·' : ''}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

// ─── Card ─────────────────────────────────────────────────────────────────────

function ActivityCard({ activity }: { activity: GarminActivity }) {
  const rawName = activity.raw_payload?.activityName as string | undefined
  const title = rawName ?? generateTitle(activity)
  const rawTypeKey = (activity.raw_payload?.activityType as Record<string, unknown> | undefined)?.typeKey as string | undefined
  const type = rawTypeKey ? rawTypeKey.replace(/_/g, ' ') : cleanType(activity.activity_type)
  const emoji = activityEmoji(type)
  const brief = briefDescription(activity)
  const location = getLocation(activity.raw_payload)

  const date = new Date(activity.start_time)
  const dateStr = date.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
  const timeStr = date.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })

  const stats = [
    activity.duration_sec ? { label: 'Duration', value: formatDuration(activity.duration_sec) } : null,
    activity.distance_m && activity.distance_m > 100 ? { label: 'Distance', value: formatDistance(activity.distance_m) } : null,
    activity.avg_hr ? { label: 'Avg HR', value: `${activity.avg_hr} bpm` } : null,
    activity.calories ? { label: 'Calories', value: `${Math.round(activity.calories)}` } : null,
  ].filter(Boolean) as { label: string; value: string }[]

  return (
    <a href={`/activities/${activity.id}`} className="block bg-gray-900 rounded-2xl p-4 hover:bg-gray-800/80 transition-colors group">
      {/* Title row */}
      <div className="flex items-start gap-3">
        <span className="text-2xl mt-0.5 shrink-0">{emoji}</span>
        <div className="flex-1 min-w-0">
          <h3 className="text-white font-bold text-base leading-snug group-hover:text-orange-300 transition-colors">{title}</h3>
          <p className="text-gray-500 text-xs mt-0.5">
            {dateStr} · {timeStr}
            {location && <span> · 📍 {location}</span>}
          </p>
        </div>
        {activity.training_effect != null && (
          <div className="bg-orange-500/20 text-orange-400 text-xs font-bold px-2 py-1 rounded-lg shrink-0">
            TE {activity.training_effect.toFixed(1)}
          </div>
        )}
      </div>

      {/* Stats */}
      <div className={`mt-3 grid gap-x-4 gap-y-1 ${stats.length >= 4 ? 'grid-cols-4' : `grid-cols-${stats.length}`}`}>
        {stats.map(s => (
          <div key={s.label}>
            <p className="text-gray-500 text-xs">{s.label}</p>
            <p className="text-white font-semibold text-sm mt-0.5">{s.value}</p>
          </div>
        ))}
      </div>

      {/* Brief description */}
      <p className="mt-3 text-gray-400 text-sm leading-relaxed">{brief}</p>

      <p className="mt-2 text-orange-400/60 text-xs group-hover:text-orange-400 transition-colors">View full analysis →</p>
    </a>
  )
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function ActivitiesPage() {
  const router = useRouter()
  const [loading, setLoading] = useState(true)
  const [activities, setActivities] = useState<GarminActivity[]>([])
  const [displayName, setDisplayName] = useState('')
  const [streak, setStreak] = useState(0)
  const [activityDateStrs, setActivityDateStrs] = useState<string[]>([])

  useEffect(() => {
    const load = async () => {
      const { data } = await supabase.auth.getSession()
      if (!data.session) { router.push('/login'); return }
      const user = data.session.user

      const { data: profile } = await supabase
        .from('profiles')
        .select('display_name, name')
        .eq('user_id', user.id)
        .maybeSingle()
      setDisplayName(profile?.display_name ?? profile?.name ?? '')

      const ninetyAgo = new Date(Date.now() - 90 * 86400000).toISOString()

      const [actsRes, streakRes] = await Promise.all([
        supabase
          .from('garmin_activities')
          .select('id, activity_type, start_time, duration_sec, distance_m, calories, avg_hr, max_hr, training_effect, raw_payload')
          .eq('user_id', user.id)
          .order('start_time', { ascending: false })
          .limit(50),
        supabase
          .from('garmin_activities')
          .select('start_time')
          .eq('user_id', user.id)
          .gte('start_time', ninetyAgo)
          .order('start_time', { ascending: false }),
      ])

      setActivities((actsRes.data ?? []) as GarminActivity[])

      const datestrs = [...new Set((streakRes.data ?? []).map((r: { start_time: string }) => localDs(new Date(r.start_time))))]
      setActivityDateStrs(datestrs)
      setStreak(calcActivityStreak(datestrs))

      setLoading(false)
    }
    load()
  }, [router])

  if (loading) {
    return (
      <main className="min-h-screen bg-gray-950 flex items-center justify-center">
        <p className="text-gray-400">Loading activities...</p>
      </main>
    )
  }

  return (
    <main className="min-h-screen bg-gray-950 p-4 md:p-8 pb-24">
      <div className="mx-auto max-w-2xl space-y-4">

        <div className="flex items-center justify-between">
          <div>
            <a href="/dashboard" className="text-gray-500 text-sm hover:text-gray-300">← Dashboard</a>
            <h1 className="text-2xl font-bold text-white mt-1">Activities</h1>
          </div>
          {displayName && <p className="text-gray-500 text-sm">{displayName}</p>}
        </div>

        {streak > 0 && <ActivityStreakBanner streak={streak} activityDateStrs={activityDateStrs} />}

        {activities.length === 0 ? (
          <div className="bg-gray-900 rounded-2xl p-8 text-center">
            <p className="text-4xl mb-3">🏃</p>
            <p className="text-gray-400 font-medium">No activities yet</p>
            <p className="text-gray-600 text-sm mt-1">Garmin sync will populate activities here automatically.</p>
          </div>
        ) : (
          <div className="space-y-3">
            {activities.map(a => (
              <ActivityCard key={a.id} activity={a} />
            ))}
          </div>
        )}
      </div>
      <BottomNav />
    </main>
  )
}

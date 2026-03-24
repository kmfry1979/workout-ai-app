'use client'

import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '../../lib/supabase'

type WorkoutRow = {
  id: string
  exercise: string | null
  workout_name: string | null
  sets: number | null
  reps: number | null
  weight: number | null
  performed_at: string
  source: string | null
}

function startOfTodayLocal() {
  const d = new Date()
  d.setHours(0, 0, 0, 0)
  return d
}

function startOfWeekLocal() {
  const d = new Date()
  const day = d.getDay()
  const diff = day === 0 ? 6 : day - 1
  d.setHours(0, 0, 0, 0)
  d.setDate(d.getDate() - diff)
  return d
}

export default function DashboardPage() {
  const router = useRouter()
  const [loading, setLoading] = useState(true)
  const [displayName, setDisplayName] = useState('')
  const [email, setEmail] = useState('')
  const [provider, setProvider] = useState('')
  const [providerStatus, setProviderStatus] = useState('')
  const [todayWorkouts, setTodayWorkouts] = useState<WorkoutRow[]>([])
  const [weekWorkouts, setWeekWorkouts] = useState<WorkoutRow[]>([])
  const [recentWorkout, setRecentWorkout] = useState<WorkoutRow | null>(null)

  useEffect(() => {
    const loadDashboard = async () => {
      const { data } = await supabase.auth.getSession()

      if (!data.session) {
        router.push('/login')
        return
      }

      const user = data.session.user
      setEmail(user.email ?? '')

      const { data: profile } = await supabase
        .from('profiles')
        .select('display_name, name, workout_provider')
        .eq('user_id', user.id)
        .maybeSingle()

      setDisplayName(profile?.display_name ?? profile?.name ?? user.email ?? '')
      const selectedProvider = profile?.workout_provider ?? ''
setProvider(selectedProvider)

// Now check connection status
if (selectedProvider) {
  const { data: connection } = await supabase
    .from('provider_connections')
    .select('status')
    .eq('user_id', user.id)
    .eq('provider_type', selectedProvider.toLowerCase())
    .maybeSingle()

  setProviderStatus(connection?.status ?? 'not_connected')
}

      const todayStart = startOfTodayLocal().toISOString()
      const weekStart = startOfWeekLocal().toISOString()

      const { data: todayData, error: todayError } = await supabase
        .from('workouts')
        .select('id, exercise, workout_name, sets, reps, weight, performed_at, source')
        .eq('user_id', user.id)
        .gte('performed_at', todayStart)
        .order('performed_at', { ascending: false })

      if (todayError) {
        alert(todayError.message)
        setLoading(false)
        return
      }

      const { data: weekData, error: weekError } = await supabase
        .from('workouts')
        .select('id, exercise, workout_name, sets, reps, weight, performed_at, source')
        .eq('user_id', user.id)
        .gte('performed_at', weekStart)
        .order('performed_at', { ascending: false })

      if (weekError) {
        alert(weekError.message)
        setLoading(false)
        return
      }

      const { data: latestData, error: latestError } = await supabase
        .from('workouts')
        .select('id, exercise, workout_name, sets, reps, weight, performed_at, source')
        .eq('user_id', user.id)
        .order('performed_at', { ascending: false })
        .limit(1)
        .maybeSingle()

      if (latestError) {
        alert(latestError.message)
        setLoading(false)
        return
      }

      setTodayWorkouts((todayData ?? []) as WorkoutRow[])
      setWeekWorkouts((weekData ?? []) as WorkoutRow[])
      setRecentWorkout((latestData ?? null) as WorkoutRow | null)
      setLoading(false)
    }

    loadDashboard()
  }, [router])

  const totalReps = useMemo(
    () => weekWorkouts.reduce((sum, workout) => sum + (workout.reps ?? 0), 0),
    [weekWorkouts]
  )

  const totalVolume = useMemo(
    () =>
      weekWorkouts.reduce(
        (sum, workout) => sum + (Number(workout.reps ?? 0) * Number(workout.weight ?? 0)),
        0
      ),
    [weekWorkouts]
  )

  const handleLogout = async () => {
    await supabase.auth.signOut()
    router.push('/login')
  }

  if (loading) {
    return (
      <main className="min-h-screen flex items-center justify-center bg-gray-50 p-6">
        <p>Loading dashboard...</p>
      </main>
    )
  }

  return (
    <main className="min-h-screen bg-gray-50 p-6">
      <div className="mx-auto max-w-5xl rounded-2xl bg-white p-6 shadow">
        <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
          <div>
            <h1 className="text-3xl font-bold mb-2">Dashboard</h1>
            <p className="text-gray-600">
              Welcome back, {displayName || email}.
            </p>
          </div>

          <div className="flex flex-wrap gap-2">
            <a
              href="/profile"
              className="inline-block rounded-lg bg-gray-200 px-4 py-2"
            >
              Edit Profile
            </a>
            <a
              href="/workouts"
              className="inline-block rounded-lg bg-gray-200 px-4 py-2"
            >
              Go to Workouts
            </a>
            <button
              className="rounded-lg bg-black px-4 py-2 text-white"
              onClick={handleLogout}
            >
              Logout
            </button>
          </div>
        </div>

        <div className="mt-8 grid gap-4 md:grid-cols-4">
          <div className="rounded-xl border p-4">
            <p className="text-sm text-gray-500">Today&apos;s workouts</p>
            <p className="mt-2 text-3xl font-bold">{todayWorkouts.length}</p>
          </div>

          <div className="rounded-xl border p-4">
            <p className="text-sm text-gray-500">Weekly workout count</p>
            <p className="mt-2 text-3xl font-bold">{weekWorkouts.length}</p>
          </div>

          <div className="rounded-xl border p-4">
            <p className="text-sm text-gray-500">Total reps this week</p>
            <p className="mt-2 text-3xl font-bold">{totalReps}</p>
          </div>

          <div className="rounded-xl border p-4">
            <p className="text-sm text-gray-500">Total volume this week</p>
            <p className="mt-2 text-3xl font-bold">{totalVolume.toFixed(0)}</p>
          </div>
        </div>

        <div className="mt-8 rounded-xl border p-4">
          <div className="flex items-center justify-between gap-4">
            <div>
              <h2 className="text-xl font-semibold">Today Workout Summary</h2>
              <p className="text-sm text-gray-500">
                Quick snapshot of today&apos;s training and provider sync
              </p>
            </div>

            <div className="rounded-full bg-gray-100 px-3 py-1 text-sm text-gray-700">
  {provider
    ? `${provider} (${providerStatus === 'connected' ? 'Connected' : 'Not connected'})`
    : 'Manual only'}
</div>
          </div>

          <div className="mt-4 grid gap-4 md:grid-cols-3">
            <div className="rounded-lg bg-gray-50 p-4">
              <p className="text-sm text-gray-500">Workouts Today</p>
              <p className="mt-1 text-2xl font-bold">{todayWorkouts.length}</p>
            </div>

            <div className="rounded-lg bg-gray-50 p-4">
              <p className="text-sm text-gray-500">Latest Session</p>
              <p className="mt-1 font-medium">
                {recentWorkout?.workout_name || recentWorkout?.exercise || 'No session yet'}
              </p>
            </div>

            <div className="rounded-lg bg-gray-50 p-4">
              <p className="text-sm text-gray-500">Provider</p>
              <p className="mt-1 font-medium">
  {provider
    ? `${provider} (${providerStatus === 'connected' ? 'Connected' : 'Not connected'})`
    : 'No provider selected'}
</p>
              <p className="text-sm text-gray-500 mt-1">
                Sync data will appear here once Garmin is connected
              </p>
            </div>
          </div>
        </div>

        <div className="mt-8 grid gap-6 md:grid-cols-2">
          <div className="rounded-xl border p-4">
            <h2 className="text-xl font-semibold mb-4">Most Recent Session</h2>

            {recentWorkout ? (
              <div>
                <p className="font-medium">
                  {recentWorkout.workout_name || recentWorkout.exercise || 'Workout'}
                </p>
                <p className="text-sm text-gray-600 mt-1">
                  {recentWorkout.reps ?? '-'} reps • {recentWorkout.weight ?? '-'} kg •{' '}
                  {recentWorkout.sets ?? '-'} sets
                </p>
                <p className="text-sm text-gray-400 mt-2">
                  {new Date(recentWorkout.performed_at).toLocaleString()}
                </p>
              </div>
            ) : (
              <p className="text-gray-500">No workouts yet.</p>
            )}
          </div>

          <div className="rounded-xl border p-4">
            <h2 className="text-xl font-semibold mb-4">Today</h2>

            {todayWorkouts.length === 0 ? (
              <p className="text-gray-500">No workouts logged today.</p>
            ) : (
              <div className="space-y-3">
                {todayWorkouts.slice(0, 5).map((w) => (
                  <div key={w.id} className="border-b pb-3 last:border-b-0 last:pb-0">
                    <p className="font-medium">{w.exercise || w.workout_name || 'Workout'}</p>
                    <p className="text-sm text-gray-600">
                      {w.reps ?? '-'} reps • {w.weight ?? '-'} kg
                    </p>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </main>
  )
}
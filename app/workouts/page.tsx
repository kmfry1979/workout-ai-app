'use client'

import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { useRouter } from 'next/navigation'

export default function WorkoutsPage() {
  const router = useRouter()

  const [exercise, setExercise] = useState('')
  const [reps, setReps] = useState('')
  const [weight, setWeight] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [workouts, setWorkouts] = useState<any[]>([])

  // Load workouts
  useEffect(() => {
    const loadWorkouts = async () => {
      const { data: sessionData } = await supabase.auth.getSession()
      const user = sessionData.session?.user

      if (!user) {
        router.push('/login')
        return
      }

      const { data } = await supabase
        .from('workouts')
        .select('*')
        .eq('user_id', user.id)
        .order('performed_at', { ascending: false })
        .limit(10)

      setWorkouts(data || [])
      setLoading(false)
    }

    loadWorkouts()
  }, [router])

  const saveWorkout = async () => {
    if (!exercise) return

    setSaving(true)

    const { data: sessionData } = await supabase.auth.getSession()
    const user = sessionData.session?.user

    if (!user) return

    const { error } = await supabase.from('workouts').insert({
      user_id: user.id,
      exercise,
      reps: reps ? parseInt(reps) : null,
      weight: weight ? parseFloat(weight) : null,
      source: 'manual',
    })

    setSaving(false)

    if (error) {
      alert(error.message)
      return
    }

    // Reset form
    setExercise('')
    setReps('')
    setWeight('')

    // Reload workouts
    const { data } = await supabase
      .from('workouts')
      .select('*')
      .eq('user_id', user.id)
      .order('performed_at', { ascending: false })
      .limit(10)

    setWorkouts(data || [])
  }

  if (loading) return <p className="p-6">Loading...</p>

  return (
    <main className="min-h-screen bg-gray-50 p-6">
      <div className="mx-auto max-w-3xl">

        <h1 className="text-3xl font-bold mb-6">Workouts</h1>

        {/* Form */}
        <div className="bg-white p-6 rounded-2xl shadow mb-6">
          <h2 className="text-xl font-semibold mb-4">Log Workout</h2>

          <input
            className="w-full border p-3 mb-3 rounded-lg"
            placeholder="Exercise (e.g. Bench Press)"
            value={exercise}
            onChange={(e) => setExercise(e.target.value)}
          />

          <input
            className="w-full border p-3 mb-3 rounded-lg"
            placeholder="Reps"
            value={reps}
            onChange={(e) => setReps(e.target.value)}
          />

          <input
            className="w-full border p-3 mb-4 rounded-lg"
            placeholder="Weight (kg)"
            value={weight}
            onChange={(e) => setWeight(e.target.value)}
          />

          <button
            className="w-full bg-black text-white py-3 rounded-lg disabled:bg-gray-400"
            onClick={saveWorkout}
            disabled={!exercise || saving}
          >
            {saving ? 'Saving...' : 'Save Workout'}
          </button>
        </div>

        {/* Recent Workouts */}
        <div className="bg-white p-6 rounded-2xl shadow">
          <h2 className="text-xl font-semibold mb-4">Recent Workouts</h2>

          {workouts.length === 0 && (
            <p className="text-gray-500">No workouts yet</p>
          )}

          {workouts.map((w) => (
            <div
              key={w.id}
              className="border-b py-3 flex justify-between"
            >
              <div>
                <p className="font-medium">{w.exercise}</p>
                <p className="text-sm text-gray-500">
                  {w.reps || '-'} reps • {w.weight || '-'} kg
                </p>
              </div>

              <p className="text-sm text-gray-400">
                {new Date(w.performed_at).toLocaleDateString()}
              </p>
            </div>
          ))}
        </div>

      </div>
    </main>
  )
}
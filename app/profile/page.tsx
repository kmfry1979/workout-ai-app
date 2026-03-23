'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '../../lib/supabase'

export default function ProfilePage() {
  const router = useRouter()
  const [loading, setLoading] = useState(true)
  const [displayName, setDisplayName] = useState('')
  const [workoutProvider, setWorkoutProvider] = useState('')
  const [providerDetail, setProviderDetail] = useState('')

  useEffect(() => {
    const loadProfile = async () => {
      const { data: sessionData } = await supabase.auth.getSession()
      const user = sessionData.session?.user

      if (!user) {
        router.push('/login')
        return
      }

      const { data, error } = await supabase
        .from('profiles')
        .select('display_name, workout_provider, provider_detail')
        .eq('user_id', user.id)
        .maybeSingle()

      if (error) {
        alert(error.message)
        setLoading(false)
        return
      }

      if (data) {
        setDisplayName(data.display_name ?? '')
        setWorkoutProvider(data.workout_provider ?? '')
        setProviderDetail(data.provider_detail ?? '')
      }

      setLoading(false)
    }

    loadProfile()
  }, [router])

  const saveProfile = async () => {
    const { data: sessionData } = await supabase.auth.getSession()
    const user = sessionData.session?.user

    if (!user) return

    const { data: existingProfile } = await supabase
      .from('profiles')
      .select('id')
      .eq('user_id', user.id)
      .maybeSingle()

    if (existingProfile) {
      const { error } = await supabase
        .from('profiles')
        .update({
          display_name: displayName,
          workout_provider: workoutProvider,
          provider_detail: providerDetail,
        })
        .eq('user_id', user.id)

      if (error) {
        alert(error.message)
        return
      }
    } else {
      const { error } = await supabase.from('profiles').insert({
        user_id: user.id,
        display_name: displayName,
        workout_provider: workoutProvider,
        provider_detail: providerDetail,
      })

      if (error) {
        alert(error.message)
        return
      }
    }

    router.push('/dashboard')
  }

  if (loading) return <p className="p-6">Loading...</p>

  return (
    <main className="min-h-screen flex items-center justify-center bg-gray-50 p-6">
      <div className="w-full max-w-lg rounded-2xl bg-white p-6 shadow">
        <h1 className="text-2xl font-bold mb-6">Your Profile</h1>

        <label className="block text-sm font-medium mb-2">Display Name</label>
        <input
          className="w-full rounded-lg border p-3 mb-6"
          value={displayName}
          onChange={(e) => setDisplayName(e.target.value)}
          placeholder="Your name"
        />

        <h2 className="text-lg font-semibold mb-3">Workout Provider</h2>

        <label className="block text-sm font-medium mb-2">Provider</label>
        <select
          className="w-full rounded-lg border p-3 mb-4 bg-white"
          value={workoutProvider}
          onChange={(e) => setWorkoutProvider(e.target.value)}
        >
          <option value="">Select a provider</option>
          <option value="Garmin">Garmin</option>
          <option value="Hevy">Hevy</option>
          <option value="Strava">Strava</option>
          <option value="MyFitnessPal">MyFitnessPal</option>
          <option value="Other">Other</option>
        </select>

        <label className="block text-sm font-medium mb-2">
          Provider Details
        </label>
        <input
          className="w-full rounded-lg border p-3 mb-6"
          value={providerDetail}
          onChange={(e) => setProviderDetail(e.target.value)}
          placeholder="Account email, username, or note"
        />

        <button
          className="w-full bg-black text-white py-3 rounded-lg"
          onClick={saveProfile}
        >
          Save and return to Dashboard
        </button>
      </div>
    </main>
  )
}
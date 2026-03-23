'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '../../lib/supabase'

type Tab = 'profile' | 'provider'

export default function ProfilePage() {
  const router = useRouter()
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [connecting, setConnecting] = useState(false)
  const [tab, setTab] = useState<Tab>('profile')
  const [displayName, setDisplayName] = useState('')
  const [selectedProvider, setSelectedProvider] = useState('')

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
        .select('display_name, name')
        .eq('user_id', user.id)
        .maybeSingle()

      if (error) {
        alert(error.message)
        setLoading(false)
        return
      }

      if (data) {
        setDisplayName(data.display_name ?? data.name ?? '')
      }

      setLoading(false)
    }

    loadProfile()
  }, [router])

  const saveProfile = async () => {
    const trimmedName = displayName.trim()
    if (!trimmedName) return

    setSaving(true)

    const { data: sessionData } = await supabase.auth.getSession()
    const user = sessionData.session?.user

    if (!user) {
      setSaving(false)
      router.push('/login')
      return
    }

    const { data: existingProfile, error: findError } = await supabase
      .from('profiles')
      .select('id')
      .eq('user_id', user.id)
      .maybeSingle()

    if (findError) {
      alert(findError.message)
      setSaving(false)
      return
    }

    const payload = {
      display_name: trimmedName,
      name: trimmedName,
    }

    if (existingProfile) {
      const { error } = await supabase
        .from('profiles')
        .update(payload)
        .eq('user_id', user.id)

      if (error) {
        alert(error.message)
        setSaving(false)
        return
      }
    } else {
      const { error } = await supabase.from('profiles').insert({
        user_id: user.id,
        ...payload,
      })

      if (error) {
        alert(error.message)
        setSaving(false)
        return
      }
    }

    setSaving(false)
    router.push('/dashboard')
  }

  const connectProvider = async () => {
    if (!selectedProvider) return

    setConnecting(true)

    // Placeholder for future provider connection flow.
    // For now, this simply acknowledges the selection.
    await new Promise((resolve) => setTimeout(resolve, 500))

    setConnecting(false)
    alert(`${selectedProvider} selected. Provider connection can be added next.`)
  }

  if (loading) return <p className="p-6">Loading...</p>

  return (
    <main className="min-h-screen bg-gray-50 p-6">
      <div className="mx-auto w-full max-w-lg rounded-2xl bg-white p-6 shadow">
        <h1 className="text-2xl font-bold mb-4">Your Profile</h1>

        <div className="mb-6 flex gap-2">
          <button
            className={`rounded-lg px-4 py-2 ${
              tab === 'profile' ? 'bg-black text-white' : 'bg-gray-200'
            }`}
            onClick={() => setTab('profile')}
          >
            Profile
          </button>
          <button
            className={`rounded-lg px-4 py-2 ${
              tab === 'provider' ? 'bg-black text-white' : 'bg-gray-200'
            }`}
            onClick={() => setTab('provider')}
          >
            Workout Provider
          </button>
        </div>

        {tab === 'profile' && (
          <div>
            <label className="block text-sm font-medium mb-2">Display Name</label>
            <input
              className="w-full rounded-lg border p-3 mb-4"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              placeholder="Your name"
            />

            <button
              className="w-full rounded-lg bg-black py-3 text-white disabled:cursor-not-allowed disabled:bg-gray-400"
              onClick={saveProfile}
              disabled={!displayName.trim() || saving}
            >
              {saving ? 'Saving...' : 'Save and return to Dashboard'}
            </button>
          </div>
        )}

        {tab === 'provider' && (
          <div>
            <label className="block text-sm font-medium mb-2">Provider</label>
            <select
              className="w-full rounded-lg border p-3 mb-4 bg-white"
              value={selectedProvider}
              onChange={(e) => setSelectedProvider(e.target.value)}
            >
              <option value="">Select a provider</option>
              <option value="Garmin">Garmin</option>
              <option value="Hevy">Hevy</option>
              <option value="Strava">Strava</option>
              <option value="MyFitnessPal">MyFitnessPal</option>
              <option value="Other">Other</option>
            </select>

            <button
              className="w-full rounded-lg bg-black py-3 text-white disabled:cursor-not-allowed disabled:bg-gray-400"
              onClick={connectProvider}
              disabled={!selectedProvider || connecting}
            >
              {connecting ? 'Connecting...' : 'Connect to Provider'}
            </button>

            <p className="mt-4 text-sm text-gray-600">
              Provider setup will be added here next. This tab stays separate so it never blocks saving your profile.
            </p>
          </div>
        )}
      </div>
    </main>
  )
}
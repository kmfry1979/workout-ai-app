'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '../../lib/supabase'

type Tab = 'profile' | 'provider'

export default function ProfilePage() {
  const router = useRouter()
  const [loading, setLoading] = useState(true)
  const [savingProfile, setSavingProfile] = useState(false)
  const [savingProvider, setSavingProvider] = useState(false)
  const [tab, setTab] = useState<Tab>('profile')
  const [displayName, setDisplayName] = useState('')
  const [dateOfBirth, setDateOfBirth] = useState('')
  const [heightCm, setHeightCm] = useState('')
  const [fiveKTime, setFiveKTime] = useState('')   // "MM:SS" display format
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
        .select('display_name, name, workout_provider, date_of_birth, height_cm, threshold_5k_sec')
        .eq('user_id', user.id)
        .maybeSingle()

      if (error) {
        alert(error.message)
        setLoading(false)
        return
      }

      if (data) {
        setDisplayName(data.display_name ?? data.name ?? '')
        setSelectedProvider(data.workout_provider ?? '')
        setDateOfBirth((data as { date_of_birth?: string | null }).date_of_birth ?? '')
        setHeightCm(String((data as { height_cm?: number | null }).height_cm ?? ''))
        const sec5k = (data as { threshold_5k_sec?: number | null }).threshold_5k_sec
        if (sec5k && sec5k > 0) {
          setFiveKTime(`${Math.floor(sec5k / 60)}:${String(sec5k % 60).padStart(2, '0')}`)
        }
      }

      setLoading(false)
    }

    loadProfile()
  }, [router])

  const ensureUser = async () => {
    const { data: sessionData } = await supabase.auth.getSession()
    const user = sessionData.session?.user

    if (!user) {
      router.push('/login')
      return null
    }

    return user
  }

  const saveProfile = async () => {
    const trimmedName = displayName.trim()
    if (!trimmedName) return

    setSavingProfile(true)

    const user = await ensureUser()
    if (!user) {
      setSavingProfile(false)
      return
    }

    const { data: existingProfile, error: findError } = await supabase
      .from('profiles')
      .select('id')
      .eq('user_id', user.id)
      .maybeSingle()

    if (findError) {
      alert(findError.message)
      setSavingProfile(false)
      return
    }

    // Parse "MM:SS" or "M:SS" into total seconds
    const parse5kSec = (t: string): number | null => {
      const m = t.trim().match(/^(\d{1,2}):(\d{2})$/)
      if (!m) return null
      const s = parseInt(m[1]) * 60 + parseInt(m[2])
      return s > 60 && s < 7200 ? s : null
    }

    const payload: Record<string, string | number> = {
      display_name: trimmedName,
      name: trimmedName,
    }
    if (dateOfBirth) payload.date_of_birth = dateOfBirth
    if (heightCm && !isNaN(parseFloat(heightCm))) payload.height_cm = parseFloat(heightCm)
    const fiveKSec = parse5kSec(fiveKTime)
    if (fiveKSec) payload.threshold_5k_sec = fiveKSec

    if (existingProfile) {
      const { error } = await supabase
        .from('profiles')
        .update(payload)
        .eq('user_id', user.id)

      if (error) {
        alert(error.message)
        setSavingProfile(false)
        return
      }
    } else {
      const { error } = await supabase.from('profiles').insert({
        user_id: user.id,
        ...payload,
      })

      if (error) {
        alert(error.message)
        setSavingProfile(false)
        return
      }
    }

    setSavingProfile(false)
    router.push('/dashboard')
  }

  const saveProvider = async () => {
    if (!selectedProvider) return

    setSavingProvider(true)

    const user = await ensureUser()
    if (!user) {
      setSavingProvider(false)
      return
    }

    const { data: existingProfile, error: findError } = await supabase
      .from('profiles')
      .select('id')
      .eq('user_id', user.id)
      .maybeSingle()

    if (findError) {
      alert(findError.message)
      setSavingProvider(false)
      return
    }

    if (existingProfile) {
      const { error } = await supabase
        .from('profiles')
        .update({
          workout_provider: selectedProvider,
        })
        .eq('user_id', user.id)

      if (error) {
        alert(error.message)
        setSavingProvider(false)
        return
      }
    } else {
      const { error } = await supabase.from('profiles').insert({
        user_id: user.id,
        display_name: displayName.trim() || '',
        name: displayName.trim() || '',
        workout_provider: selectedProvider,
      })

      if (error) {
        alert(error.message)
        setSavingProvider(false)
        return
      }
    }

    setSavingProvider(false)
    router.push('/dashboard')
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
            <label className="block text-sm font-medium mb-2">Date of Birth <span className="text-gray-400 font-normal">(used for Bio Age calculation)</span></label>
            <input
              type="date"
              className="w-full rounded-lg border p-3 mb-4"
              value={dateOfBirth}
              onChange={(e) => setDateOfBirth(e.target.value)}
            />
            <label className="block text-sm font-medium mb-2">Height <span className="text-gray-400 font-normal">(cm — used for BMI calculation)</span></label>
            <input
              type="number"
              step="0.1"
              min="100"
              max="250"
              className="w-full rounded-lg border p-3 mb-4"
              value={heightCm}
              onChange={(e) => setHeightCm(e.target.value)}
              placeholder="e.g. 178"
            />

            <label className="block text-sm font-medium mb-1">
              5K Reference Time <span className="text-gray-400 font-normal">(sets pace zone boundaries on activity pages)</span>
            </label>
            <p className="text-xs text-gray-400 mb-2">Enter your current 5K time or target. Used to compute threshold-based pace zones (Z1–Z6). Format: MM:SS e.g. 39:04</p>
            <input
              type="text"
              className="w-full rounded-lg border p-3 mb-4 font-mono"
              value={fiveKTime}
              onChange={(e) => setFiveKTime(e.target.value)}
              placeholder="e.g. 39:04"
              pattern="\d{1,2}:\d{2}"
            />

            <button
              className="w-full rounded-lg bg-black py-3 text-white disabled:cursor-not-allowed disabled:bg-gray-400"
              onClick={saveProfile}
              disabled={!displayName.trim() || savingProfile}
            >
              {savingProfile ? 'Saving...' : 'Save and return to Dashboard'}
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
              onClick={saveProvider}
              disabled={!selectedProvider || savingProvider}
            >
              {savingProvider ? 'Saving...' : 'Save Provider'}
            </button>

            <p className="mt-4 text-sm text-gray-600">
              This stores your provider choice for now. We will wire the actual Garmin
              connection flow into this tab next.
            </p>
          </div>
        )}
      </div>
    </main>
  )
}
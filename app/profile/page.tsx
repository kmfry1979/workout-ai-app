'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '../../lib/supabase'

type Tab = 'profile' | 'provider'

/** Parse MM:SS or H:MM:SS → total seconds. Returns null if invalid. */
function parseTimeSec(t: string): number | null {
  const s = t.trim()
  // H:MM:SS
  const hms = s.match(/^(\d{1,2}):(\d{2}):(\d{2})$/)
  if (hms) {
    const total = parseInt(hms[1]) * 3600 + parseInt(hms[2]) * 60 + parseInt(hms[3])
    return total > 60 && total < 36000 ? total : null
  }
  // MM:SS (minutes can be > 59, e.g. 85:30 for a slow 10K)
  const ms = s.match(/^(\d{1,3}):(\d{2})$/)
  if (ms) {
    const total = parseInt(ms[1]) * 60 + parseInt(ms[2])
    return total > 60 && total < 36000 ? total : null
  }
  return null
}

/** Format total seconds → MM:SS or H:MM:SS */
function fmtTimeSec(sec: number): string {
  if (sec >= 3600) {
    const h = Math.floor(sec / 3600)
    const m = Math.floor((sec % 3600) / 60)
    const s = sec % 60
    return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
  }
  return `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`
}

export default function ProfilePage() {
  const router = useRouter()
  const [loading, setLoading] = useState(true)
  const [savingProfile, setSavingProfile] = useState(false)
  const [savingProvider, setSavingProvider] = useState(false)
  const [tab, setTab] = useState<Tab>('profile')
  const [displayName, setDisplayName] = useState('')
  const [dateOfBirth, setDateOfBirth] = useState('')
  const [heightCm, setHeightCm] = useState('')
  const [fiveKTime, setFiveKTime] = useState('')    // MM:SS display
  const [tenKTime, setTenKTime] = useState('')      // MM:SS or H:MM:SS display
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
        .select('display_name, name, workout_provider, date_of_birth, height_cm, threshold_5k_sec, threshold_10k_sec')
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
        if (sec5k && sec5k > 0) setFiveKTime(fmtTimeSec(sec5k))
        const sec10k = (data as { threshold_10k_sec?: number | null }).threshold_10k_sec
        if (sec10k && sec10k > 0) setTenKTime(fmtTimeSec(sec10k))
      }

      setLoading(false)
    }

    loadProfile()
  }, [router])

  const ensureUser = async () => {
    const { data: sessionData } = await supabase.auth.getSession()
    const user = sessionData.session?.user
    if (!user) { router.push('/login'); return null }
    return user
  }

  const saveProfile = async () => {
    const trimmedName = displayName.trim()
    if (!trimmedName) return

    setSavingProfile(true)
    const user = await ensureUser()
    if (!user) { setSavingProfile(false); return }

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

    const payload: Record<string, string | number> = {
      display_name: trimmedName,
      name: trimmedName,
    }
    if (dateOfBirth) payload.date_of_birth = dateOfBirth
    if (heightCm && !isNaN(parseFloat(heightCm))) payload.height_cm = parseFloat(heightCm)
    const fiveKSec = parseTimeSec(fiveKTime)
    if (fiveKSec) payload.threshold_5k_sec = fiveKSec
    const tenKSec = parseTimeSec(tenKTime)
    if (tenKSec) payload.threshold_10k_sec = tenKSec

    if (existingProfile) {
      const { error } = await supabase.from('profiles').update(payload).eq('user_id', user.id)
      if (error) { alert(error.message); setSavingProfile(false); return }
    } else {
      const { error } = await supabase.from('profiles').insert({ user_id: user.id, ...payload })
      if (error) { alert(error.message); setSavingProfile(false); return }
    }

    setSavingProfile(false)
    router.push('/dashboard')
  }

  const saveProvider = async () => {
    if (!selectedProvider) return
    setSavingProvider(true)
    const user = await ensureUser()
    if (!user) { setSavingProvider(false); return }

    const { data: existingProfile, error: findError } = await supabase
      .from('profiles')
      .select('id')
      .eq('user_id', user.id)
      .maybeSingle()

    if (findError) { alert(findError.message); setSavingProvider(false); return }

    if (existingProfile) {
      const { error } = await supabase
        .from('profiles')
        .update({ workout_provider: selectedProvider })
        .eq('user_id', user.id)
      if (error) { alert(error.message); setSavingProvider(false); return }
    } else {
      const { error } = await supabase.from('profiles').insert({
        user_id: user.id,
        display_name: displayName.trim() || '',
        name: displayName.trim() || '',
        workout_provider: selectedProvider,
      })
      if (error) { alert(error.message); setSavingProvider(false); return }
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
            className={`rounded-lg px-4 py-2 ${tab === 'profile' ? 'bg-black text-white' : 'bg-gray-200'}`}
            onClick={() => setTab('profile')}
          >
            Profile
          </button>
          <button
            className={`rounded-lg px-4 py-2 ${tab === 'provider' ? 'bg-black text-white' : 'bg-gray-200'}`}
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

            <label className="block text-sm font-medium mb-2">
              Date of Birth <span className="text-gray-400 font-normal">(used for Bio Age calculation)</span>
            </label>
            <input
              type="date"
              className="w-full rounded-lg border p-3 mb-4"
              value={dateOfBirth}
              onChange={(e) => setDateOfBirth(e.target.value)}
            />

            <label className="block text-sm font-medium mb-2">
              Height <span className="text-gray-400 font-normal">(cm — used for BMI calculation)</span>
            </label>
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

            {/* ── Race time overrides ───────────────────────────────────────── */}
            <div className="mb-5 rounded-xl border border-gray-200 p-4 bg-gray-50">
              <p className="text-sm font-semibold mb-1">Race Time Overrides</p>
              <p className="text-xs text-gray-500 mb-4">
                Override Garmin&apos;s predicted times. Used to set pace zone boundaries on activity pages.
                Leave blank to use Garmin&apos;s predictions automatically. Format: MM:SS or H:MM:SS
              </p>

              <label className="block text-sm font-medium mb-1">
                5K Time <span className="text-gray-400 font-normal">(e.g. 39:04)</span>
              </label>
              <input
                type="text"
                className="w-full rounded-lg border p-3 mb-4 font-mono"
                value={fiveKTime}
                onChange={(e) => setFiveKTime(e.target.value)}
                placeholder="e.g. 39:04"
              />

              <label className="block text-sm font-medium mb-1">
                10K Time <span className="text-gray-400 font-normal">(e.g. 85:30 or 1:25:30)</span>
              </label>
              <input
                type="text"
                className="w-full rounded-lg border p-3 font-mono"
                value={tenKTime}
                onChange={(e) => setTenKTime(e.target.value)}
                placeholder="e.g. 85:30"
              />
            </div>

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

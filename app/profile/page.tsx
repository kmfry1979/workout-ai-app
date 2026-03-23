'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '../../lib/supabase'

export default function ProfilePage() {
  const router = useRouter()
  const [loading, setLoading] = useState(true)
  const [name, setName] = useState('')

  useEffect(() => {
    const loadProfile = async () => {
      const { data: sessionData } = await supabase.auth.getSession()

      const user = sessionData.session?.user

      if (!user) {
        router.push('/login')
        return
      }

      // Try get existing profile
      const { data } = await supabase
        .from('profiles')
        .select('*')
        .eq('user_id', user.id)
        .single()

      if (data) {
        setName(data.name || '')
      } else {
        // Create profile if not exists
        await supabase.from('profiles').insert({
          user_id: user.id,
          name: '',
        })
      }

      setLoading(false)
    }

    loadProfile()
  }, [router])

  const saveProfile = async () => {
    const { data: sessionData } = await supabase.auth.getSession()
    const user = sessionData.session?.user

    if (!user) return

    await supabase
      .from('profiles')
      .update({ name })
      .eq('user_id', user.id)

    alert('Profile saved!')
  }

  if (loading) return <p className="p-6">Loading...</p>

  return (
    <main className="min-h-screen flex items-center justify-center bg-gray-50 p-6">
      <div className="w-full max-w-sm rounded-2xl bg-white p-6 shadow">
        <h1 className="text-2xl font-bold mb-6">Your Profile</h1>

        <label className="block text-sm font-medium mb-2">Name</label>
        <input
          className="w-full rounded-lg border p-3 mb-6"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Your name"
        />

        <button
          className="w-full bg-black text-white py-3 rounded-lg"
          onClick={saveProfile}
        >
          Save
        </button>
      </div>
    </main>
  )
}
'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '../../lib/supabase'

export default function LoginPage() {
  const router = useRouter()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)

  const handleLogin = async () => {
    setLoading(true)

    const { data, error } = await supabase.auth.signInWithPassword({
      email,
      password,
    })

    setLoading(false)

    if (error) {
      const message = error.message.toLowerCase()

      if (message.includes('email not confirmed')) {
        alert('Please verify your email before logging in.')
      } else if (message.includes('invalid login credentials')) {
        alert('No account found or password is incorrect. Please sign up first.')
      } else {
        alert(error.message)
      }

      return
    }

    if (!data.user?.email_confirmed_at) {
      alert('Please verify your email before logging in.')
      return
    }

    router.push('/dashboard')
  }

  const handleSignup = async () => {
    setLoading(true)

    const { error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        emailRedirectTo: 'https://workout-ai-app-gilt.vercel.app/confirmed',
      },
    })

    setLoading(false)

    if (error) {
      alert(error.message)
      return
    }

    alert('Check your email to confirm your account!')
  }

  return (
    <main className="min-h-screen flex items-center justify-center bg-gray-50 p-6">
      <div className="w-full max-w-sm rounded-2xl bg-white p-6 shadow">
        <h1 className="text-2xl font-bold mb-6">Workout AI Login</h1>

        <label className="block text-sm font-medium mb-2">Email</label>
        <input
          className="w-full rounded-lg border p-3 mb-4"
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="you@example.com"
        />

        <label className="block text-sm font-medium mb-2">Password</label>
        <input
          className="w-full rounded-lg border p-3 mb-6"
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="password"
        />

        <div className="flex gap-3">
          <button
            className="flex-1 rounded-lg bg-black px-4 py-3 text-white disabled:opacity-50"
            onClick={handleLogin}
            disabled={loading}
          >
            Login
          </button>

          <button
            className="flex-1 rounded-lg border px-4 py-3 disabled:opacity-50"
            onClick={handleSignup}
            disabled={loading}
          >
            Sign Up
          </button>
        </div>
      </div>
    </main>
  )
}
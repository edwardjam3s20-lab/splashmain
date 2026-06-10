'use client'
import { useState, useEffect } from 'react'
import { createClient } from '@supabase/supabase-js'
import { useRouter } from 'next/navigation'

export const dynamic = 'force-dynamic'

export default function AdminResetPassword() {
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [done, setDone] = useState(false)
  const [ready, setReady] = useState(false)
  const [supabase, setSupabase] = useState(null)
  const router = useRouter()

  useEffect(() => {
    const client = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
    )
    setSupabase(client)

    const { data: { subscription } } = client.auth.onAuthStateChange((event, session) => {
      if (event === 'PASSWORD_RECOVERY') {
        setReady(true)
      }
    })
    return () => subscription.unsubscribe()
  }, [])

  async function handleReset() {
    setError('')
    if (!password) { setError('Enter a new password'); return }
    if (password !== confirm) { setError('Passwords do not match'); return }
    if (password.length < 8) { setError('Minimum 8 characters'); return }

    setLoading(true)
    const { error } = await supabase.auth.updateUser({ password })
    setLoading(false)

    if (error) { setError(error.message); return }
    setDone(true)
    setTimeout(() => router.push('/admin'), 2000)
  }

  return (
    <div style={{
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      minHeight: '100vh', background: '#0d1b2a', padding: '24px',
      fontFamily: "'DM Sans', sans-serif"
    }}>
      <link href="https://fonts.googleapis.com/css2?family=Syne:wght@700;800&family=DM+Sans:wght@400;500&display=swap" rel="stylesheet" />
      <div style={{
        background: '#152236', borderRadius: '16px', padding: '40px',
        width: '100%', maxWidth: '400px', border: '1px solid #1e3050'
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '8px' }}>
          <div style={{
            width: '40px', height: '40px', background: '#f5a623', borderRadius: '10px',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontFamily: 'Syne, sans-serif', fontWeight: 800, fontSize: '18px', color: '#0d1b2a'
          }}>S</div>
          <span style={{ fontFamily: 'Syne, sans-serif', fontWeight: 800, fontSize: '18px', color: '#f0f4f8' }}>SplashPass</span>
        </div>
        <div style={{ fontSize: '12px', color: '#f5a623', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '1px', marginBottom: '24px' }}>
          Admin Panel
        </div>

        <h2 style={{ fontFamily: 'Syne, sans-serif', color: '#f0f4f8', fontSize: '20px', marginBottom: '6px' }}>
          Reset Password
        </h2>
        <p style={{ color: '#8a9bb0', fontSize: '13px', marginBottom: '24px', lineHeight: 1.5 }}>
          Enter your new admin password below.
        </p>

        {done ? (
          <p style={{ color: '#2ecc71', textAlign: 'center', fontWeight: 500 }}>
            ✓ Password updated. Redirecting...
          </p>
        ) : !ready ? (
          <p style={{ color: '#8a9bb0', textAlign: 'center', fontSize: '13px' }}>
            Validating reset link...
          </p>
        ) : (
          <>
            <div style={{ marginBottom: '16px' }}>
              <label style={{ display: 'block', fontSize: '12px', color: '#8a9bb0', marginBottom: '6px', textTransform: 'uppercase', letterSpacing: '.5px', fontWeight: 500 }}>
                New Password
              </label>
              <input
                type="password"
                value={password}
                onChange={e => setPassword(e.target.value)}
                placeholder="Min 8 characters"
                onKeyDown={e => e.key === 'Enter' && handleReset()}
                style={{ width: '100%', padding: '12px 16px', background: '#0d1b2a', border: '1.5px solid #1e3050', borderRadius: '10px', color: '#f0f4f8', fontSize: '15px', outline: 'none', boxSizing: 'border-box' }}
              />
            </div>
            <div style={{ marginBottom: '16px' }}>
              <label style={{ display: 'block', fontSize: '12px', color: '#8a9bb0', marginBottom: '6px', textTransform: 'uppercase', letterSpacing: '.5px', fontWeight: 500 }}>
                Confirm Password
              </label>
              <input
                type="password"
                value={confirm}
                onChange={e => setConfirm(e.target.value)}
                placeholder="Repeat password"
                onKeyDown={e => e.key === 'Enter' && handleReset()}
                style={{ width: '100%', padding: '12px 16px', background: '#0d1b2a', border: '1.5px solid #1e3050', borderRadius: '10px', color: '#f0f4f8', fontSize: '15px', outline: 'none', boxSizing: 'border-box' }}
              />
            </div>

            {error && <p style={{ color: '#e74c3c', fontSize: '13px', marginBottom: '12px' }}>{error}</p>}

            <button
              onClick={handleReset}
              disabled={loading}
              style={{
                width: '100%', padding: '12px', background: loading ? '#c4851a' : '#f5a623',
                color: '#0d1b2a', border: 'none', borderRadius: '10px',
                fontFamily: 'Syne, sans-serif', fontWeight: 700, fontSize: '14px',
                cursor: loading ? 'not-allowed' : 'pointer'
              }}
            >
              {loading ? 'Updating...' : 'Set New Password'}
            </button>
          </>
        )}
      </div>
    </div>
  )
}

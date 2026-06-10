// app/api/auth/login/route.js
// POST — verify customer password, set session cookie, return user

import { NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabase'
import { createSession, setSessionCookie } from '@/lib/session'

export async function POST(request) {
  const { email, password } = await request.json()

  if (!email || !password) {
    return NextResponse.json({ error: 'Email and password required' }, { status: 400 })
  }

  const supabase = getSupabaseAdmin()

  // Verify password via existing RPC — password checked server-side with pgcrypto
  const { data, error } = await supabase.rpc('verify_password', {
    p_email:    email.toLowerCase().trim(),
    p_password: password,
  })

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  if (!data || data.length === 0) {
    return NextResponse.json({ error: 'Invalid email or password' }, { status: 401 })
  }

  const user = data[0]

  if (user.role === 'operator') {
    return NextResponse.json({ error: 'Use the operator app' }, { status: 403 })
  }

  // Create JWT session — same mechanism as operator auth
  const token = await createSession({
    email:    user.email,
    name:     user.name,
    role:     user.role,
  })

  // Strip password before sending to client
  delete user.password

  const res = NextResponse.json({ ok: true, user, pendingToken: token })
  setSessionCookie(res, token)
  return res
}

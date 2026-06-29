// app/api/auth/login/route.js
// POST — verify customer password, set session cookie, return user

import { NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabase'
import { createSession, setSessionCookie } from '@/lib/session'

// Credentialed cross-origin requests (cookies included) cannot use a
// wildcard Access-Control-Allow-Origin — the browser rejects that
// combination outright. The exact customer-app origin must be echoed
// back instead. Set CUSTOMER_APP_ORIGIN to the real deployed URL, e.g.
// https://splashpass-react-poc.vercel.app (no trailing slash).
const ALLOWED_ORIGIN = process.env.CUSTOMER_APP_ORIGIN || 'https://splashpass-react-poc.vercel.app'

function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': ALLOWED_ORIGIN,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Credentials': 'true',
  }
}

export async function OPTIONS() {
  return new NextResponse(null, { status: 200, headers: corsHeaders() })
}

export async function POST(request) {
  const { email, password } = await request.json()

  if (!email || !password) {
    return NextResponse.json({ error: 'Email and password required' }, { status: 400, headers: corsHeaders() })
  }

  const supabase = getSupabaseAdmin()

  // Verify password via existing RPC — password checked server-side with pgcrypto
  const { data, error } = await supabase.rpc('verify_password', {
    p_email:    email.toLowerCase().trim(),
    p_password: password,
  })

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500, headers: corsHeaders() })
  }

  if (!data || data.length === 0) {
    return NextResponse.json({ error: 'Invalid email or password' }, { status: 401, headers: corsHeaders() })
  }

  const user = data[0]

  if (user.role === 'operator') {
    return NextResponse.json({ error: 'Use the operator app' }, { status: 403, headers: corsHeaders() })
  }

  // Create JWT session — same mechanism as operator auth
  const token = await createSession({
    email:    user.email,
    name:     user.name,
    role:     user.role,
  })

  // Strip password before sending to client
  delete user.password

  const res = NextResponse.json({ ok: true, user, pendingToken: token }, { headers: corsHeaders() })
  setSessionCookie(res, token)
  return res
}

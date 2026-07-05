// app/api/verify/email-verify/route.js
// POST — confirm 6-digit email OTP, mark email_verified, issue full session
// Phone verification is deferred — users can verify phone later from Profile.
// Body: { email, pendingToken, code }

import { NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabase'
import { createSession, setSessionCookie } from '@/lib/session'
import { jwtVerify } from 'jose'

const SECRET = new TextEncoder().encode(
  process.env.SESSION_SECRET || 'fallback_secret_32_chars_minimum!!'
)

const ALLOWED_ORIGIN = process.env.CUSTOMER_APP_ORIGIN || 'https://splashpass-react.vercel.app'

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
  const { email, pendingToken, code } = await request.json()

  if (!email || !pendingToken || !code) {
    return NextResponse.json(
      { error: 'Missing required fields.' },
      { status: 400, headers: corsHeaders() }
    )
  }

  const cleanEmail = email.toLowerCase().trim()

  // Validate pending token
  try {
    const { payload } = await jwtVerify(pendingToken, SECRET)
    if (payload.email !== cleanEmail) {
      return NextResponse.json(
        { error: 'Invalid session. Please log in again.' },
        { status: 401, headers: corsHeaders() }
      )
    }
  } catch {
    return NextResponse.json(
      { error: 'Invalid session. Please log in again.' },
      { status: 401, headers: corsHeaders() }
    )
  }

  const supabase = getSupabaseAdmin()

  // Fetch stored code
  const { data: row } = await supabase
    .from('customer_verification')
    .select('email_code, email_code_expires_at')
    .eq('email', cleanEmail)
    .single()

  if (!row?.email_code) {
    return NextResponse.json(
      { error: 'No code found. Please request a new one.' },
      { status: 400, headers: corsHeaders() }
    )
  }

  if (new Date() > new Date(row.email_code_expires_at)) {
    return NextResponse.json(
      { error: 'Code expired. Please request a new one.' },
      { status: 400, headers: corsHeaders() }
    )
  }

  if (code.trim() !== row.email_code) {
    return NextResponse.json(
      { error: 'Incorrect code. Please try again.' },
      { status: 400, headers: corsHeaders() }
    )
  }

  // Clear used code and mark email verified
  await Promise.all([
    supabase
      .from('customer_verification')
      .update({ email_code: null, email_code_expires_at: null })
      .eq('email', cleanEmail),
    supabase
      .from('profiles')
      .update({ email_verified: true })
      .eq('email', cleanEmail),
  ])

  // Fetch full profile to return to client
  const { data: profile } = await supabase
    .from('profiles')
    .select('*')
    .eq('email', cleanEmail)
    .single()

  delete profile.password

  // Issue full session — phone verification deferred
  const token = await createSession({
    email: profile.email,
    name:  profile.name,
    role:  profile.role,
  })

  const res = NextResponse.json(
    { ok: true, user: profile },
    { headers: corsHeaders() }
  )
  setSessionCookie(res, token)
  return res
}

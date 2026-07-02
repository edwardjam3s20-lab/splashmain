// api/verify/phone-verify/route.js
// POST — confirm phone OTP, mark phone_verified, issue full session cookie
// Body: { email, pendingToken, code }
// This is the final step — on success the user is fully authenticated.

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
    .select('phone_code, phone_code_expires_at')
    .eq('email', cleanEmail)
    .single()

  if (!row?.phone_code) {
    return NextResponse.json(
      { error: 'No code found. Please request a new one.' },
      { status: 400, headers: corsHeaders() }
    )
  }

  if (new Date() > new Date(row.phone_code_expires_at)) {
    return NextResponse.json(
      { error: 'Code expired. Please request a new one.' },
      { status: 400, headers: corsHeaders() }
    )
  }

  if (code.trim() !== row.phone_code) {
    return NextResponse.json(
      { error: 'Incorrect code. Please try again.' },
      { status: 400, headers: corsHeaders() }
    )
  }

  // Clear used code and mark phone verified
  await Promise.all([
    supabase
      .from('customer_verification')
      .update({ phone_code: null, phone_code_expires_at: null })
      .eq('email', cleanEmail),
    supabase
      .from('profiles')
      .update({ phone_verified: true })
      .eq('email', cleanEmail),
  ])

  // Fetch full profile to return to client
  const { data: profile } = await supabase
    .from('profiles')
    .select('*')
    .eq('email', cleanEmail)
    .single()

  delete profile.password

  // Issue real session — both verified, user is now fully authenticated
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

// app/api/verify/phone-verify/route.js
// POST — verify phone OTP via WapiSMS, mark phone_verified, issue full session
// Body: { email, pendingToken, code }

import { NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabase'
import { createSession, setSessionCookie } from '@/lib/session'
import { jwtVerify } from 'jose'

const SECRET = new TextEncoder().encode(
  process.env.SESSION_SECRET || 'fallback_secret_32_chars_minimum!!'
)

// SECURITY/BUGFIX: this used to be a single hardcoded string
// (CUSTOMER_APP_ORIGIN || the old splashpass-react.vercel.app URL), so it
// always echoed back one fixed value regardless of which origin actually
// made the request. Once the customer app moved to app.splashpass.site,
// every request from there got a mismatched Access-Control-Allow-Origin
// and the browser blocked it. Mirrors the OPERATOR_REACT_ORIGINS allowlist
// pattern in middleware.js and the fix already applied in
// api/auth/login/route.js: check the request's Origin against a known
// set, and only echo it back if it's on the list.
const CUSTOMER_APP_ORIGINS = new Set([
  'http://localhost:5173',
  'https://splashpass-react.vercel.app',
  'https://splashpass.site',
  'https://www.splashpass.site',
  'https://app.splashpass.site',
])

function corsHeaders(origin) {
  const allowOrigin = CUSTOMER_APP_ORIGINS.has(origin) ? origin : ''
  return {
    'Access-Control-Allow-Origin': allowOrigin,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Credentials': 'true',
    // Multiple origins share this route, so the response MUST vary by
    // Origin -- otherwise a CDN/edge cache can serve one origin's
    // response back to a different origin.
    'Vary': 'Origin',
    'Cache-Control': 'no-store',
  }
}

export async function OPTIONS(request) {
  const origin = request.headers.get('origin') || ''

  return new NextResponse(null, { status: 200, headers: corsHeaders(origin) })
}

export async function POST(request) {
  const origin = request.headers.get('origin') || ''

  const { email, pendingToken, code } = await request.json()

  if (!email || !pendingToken || !code) {
    return NextResponse.json(
      { error: 'Missing required fields.' },
      { status: 400, headers: corsHeaders(origin) }
    )
  }

  const cleanEmail = email.toLowerCase().trim()

  // Validate pending token
  try {
    const { payload } = await jwtVerify(pendingToken, SECRET)
    if (payload.email !== cleanEmail) {
      return NextResponse.json(
        { error: 'Invalid session. Please log in again.' },
        { status: 401, headers: corsHeaders(origin) }
      )
    }
  } catch {
    return NextResponse.json(
      { error: 'Invalid session. Please log in again.' },
      { status: 401, headers: corsHeaders(origin) }
    )
  }

  // Verify OTP with WapiSMS — they stored the code when we called send/otp
  try {
    const url = new URL('https://wapisms.com/api/get/otp')
    url.searchParams.set('secret', process.env.WAPISMS_API_SECRET)
    url.searchParams.set('otp', code.trim())

    const res = await fetch(url.toString(), {
      method: 'GET',
      headers: { 'Content-Type': 'application/json' },
    })

    const data = await res.json()

    // WapiSMS returns data: true when OTP matches, data: false when it doesn't
    if (!res.ok || data.status !== 200 || data.data !== true) {
      return NextResponse.json(
        { error: 'Incorrect code. Please try again.' },
        { status: 400, headers: corsHeaders(origin) }
      )
    }
  } catch (err) {
    console.error('WapiSMS verify error:', err)
    return NextResponse.json(
      { error: 'Verification failed. Please try again.' },
      { status: 500, headers: corsHeaders(origin) }
    )
  }

  // OTP verified — mark phone_verified on profile
  const supabase = getSupabaseAdmin()

  await supabase
    .from('profiles')
    .update({ phone_verified: true })
    .eq('email', cleanEmail)

  // Fetch full profile to return to client
  const { data: profile } = await supabase
    .from('profiles')
    .select('*')
    .eq('email', cleanEmail)
    .single()

  delete profile.password

  // Issue real session — both verified, user is fully authenticated
  const token = await createSession({
    email: profile.email,
    name:  profile.name,
    role:  profile.role,
  })

  const res = NextResponse.json(
    { ok: true, user: profile },
    { headers: corsHeaders(origin) }
  )
  setSessionCookie(res, token)
  return res
}

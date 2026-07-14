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
      { status: 400, headers: corsHeaders(origin) }
    )
  }

  if (new Date() > new Date(row.email_code_expires_at)) {
    return NextResponse.json(
      { error: 'Code expired. Please request a new one.' },
      { status: 400, headers: corsHeaders(origin) }
    )
  }

  if (code.trim() !== row.email_code) {
    return NextResponse.json(
      { error: 'Incorrect code. Please try again.' },
      { status: 400, headers: corsHeaders(origin) }
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
    { headers: corsHeaders(origin) }
  )
  setSessionCookie(res, token)
  return res
}

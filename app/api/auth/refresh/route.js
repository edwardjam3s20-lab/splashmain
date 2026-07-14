// app/api/auth/refresh/route.js
// POST — exchange a valid refresh token for a new access token + a rotated
// refresh token. This is the endpoint the client calls silently in the
// background before the 15-minute access token expires, and as a one-shot
// retry if it ever sees a 401. See lib/session.js for the rotation and
// reuse-detection logic itself.

import { NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabase'
import {
  createSession,
  setSessionCookie,
  setRefreshCookie,
  clearSessionCookie,
  clearRefreshCookie,
  getRefreshCookieValue,
  rotateRefreshToken,
} from '@/lib/session'

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
  // CSRF: this endpoint mints new credentials from an existing one — exactly
  // the kind of state-changing request that needs an Origin check, the same
  // gap flagged on the operator side. SameSite=None cookies are sent
  // cross-site regardless of who triggered the request, so the cookie alone
  // isn't proof this came from our own app.
  const origin = request.headers.get('origin') || ''
  if (origin && !CUSTOMER_APP_ORIGINS.has(origin)) {
    return NextResponse.json({ error: 'Invalid origin' }, { status: 403, headers: corsHeaders(origin) })
  }

  const refreshToken = getRefreshCookieValue()

  if (!refreshToken) {
    return NextResponse.json({ error: 'No refresh token' }, { status: 401, headers: corsHeaders(origin) })
  }

  const result = await rotateRefreshToken(refreshToken)

  if (result.status !== 'ok') {
    // Every failure mode ends the session identically from the client's
    // point of view — both cookies die, client redirects to login. Reuse
    // detection additionally revokes the whole family server-side inside
    // rotateRefreshToken(), so a stolen token doesn't just fail once, it
    // kills the legitimate session too and forces a clean re-login for
    // everyone holding a copy of that chain.
    const res = NextResponse.json(
      { error: result.status === 'reuse_detected' ? 'Session revoked' : 'Session expired' },
      { status: 401, headers: corsHeaders(origin) }
    )
    clearSessionCookie(res)
    clearRefreshCookie(res)
    return res
  }

  // Pull fresh claims from the DB rather than trusting anything client-side —
  // name/role could have changed since the last token was issued.
  const supabase = getSupabaseAdmin()
  const { data: profile } = await supabase
    .from('profiles')
    .select('name, role')
    .eq('email', result.email)
    .maybeSingle()

  const accessToken = await createSession({
    email: result.email,
    name: profile?.name,
    role: profile?.role || 'customer',
  })

  const res = NextResponse.json({ ok: true }, { headers: corsHeaders(origin) })
  setSessionCookie(res, accessToken)
  setRefreshCookie(res, result.newToken)
  return res
}

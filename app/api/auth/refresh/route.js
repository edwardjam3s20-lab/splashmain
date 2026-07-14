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
  // CSRF: this endpoint mints new credentials from an existing one — exactly
  // the kind of state-changing request that needs an Origin check, the same
  // gap flagged on the operator side. SameSite=None cookies are sent
  // cross-site regardless of who triggered the request, so the cookie alone
  // isn't proof this came from our own app.
  const origin = request.headers.get('origin')
  if (origin && origin !== ALLOWED_ORIGIN) {
    return NextResponse.json({ error: 'Invalid origin' }, { status: 403, headers: corsHeaders() })
  }

  const refreshToken = getRefreshCookieValue()

  if (!refreshToken) {
    return NextResponse.json({ error: 'No refresh token' }, { status: 401, headers: corsHeaders() })
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
      { status: 401, headers: corsHeaders() }
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

  const res = NextResponse.json({ ok: true }, { headers: corsHeaders() })
  setSessionCookie(res, accessToken)
  setRefreshCookie(res, result.newToken)
  return res
}

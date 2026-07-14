// app/api/auth/logout/route.js
// POST — end the session for real: clear both cookies AND revoke the
// refresh-token chain server-side. Clearing cookies alone would leave the
// refresh token itself still valid in the DB — anyone with a copy of that
// cookie (a shared/lost device, a captured request) could still mint new
// access tokens from it after the user thought they'd logged out.

import { NextResponse } from 'next/server'
import { getSession, clearSessionCookie, clearRefreshCookie, revokeAllRefreshTokensForEmail } from '@/lib/session'

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

  // Best-effort: if the access token already expired we can't read the
  // email off it, but the cookies still get cleared either way. In that
  // case the (already short-lived) refresh token just expires naturally.
  const session = await getSession()
  if (session?.email) {
    await revokeAllRefreshTokensForEmail(session.email)
  }

  const res = NextResponse.json({ ok: true }, { headers: corsHeaders(origin) })
  clearSessionCookie(res)
  clearRefreshCookie(res)
  return res
}

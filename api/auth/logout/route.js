// app/api/auth/logout/route.js
// POST — end the session for real: clear both cookies AND revoke the
// refresh-token chain server-side. Clearing cookies alone would leave the
// refresh token itself still valid in the DB — anyone with a copy of that
// cookie (a shared/lost device, a captured request) could still mint new
// access tokens from it after the user thought they'd logged out.

import { NextResponse } from 'next/server'
import { getSession, clearSessionCookie, clearRefreshCookie, revokeAllRefreshTokensForEmail } from '@/lib/session'

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

export async function POST() {
  // Best-effort: if the access token already expired we can't read the
  // email off it, but the cookies still get cleared either way. In that
  // case the (already short-lived) refresh token just expires naturally.
  const session = await getSession()
  if (session?.email) {
    await revokeAllRefreshTokensForEmail(session.email)
  }

  const res = NextResponse.json({ ok: true }, { headers: corsHeaders() })
  clearSessionCookie(res)
  clearRefreshCookie(res)
  return res
}

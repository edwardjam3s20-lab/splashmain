// app/api/org/verify/phone-verify/route.js
// POST — verify phone OTP via WapiSMS for organization_users, mark
// phone_verified_at. Does not issue a new session — email verification
// already upgraded the caller to a full (non-pending) session.
// Body: { email, pendingToken, code }

import { NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabase'
import { verifyOrgToken } from '@/lib/orgSession'
import { orgCorsHeaders } from '@/lib/orgCors'

export async function OPTIONS(request) {
  const origin = request.headers.get('origin') || ''
  return new NextResponse(null, { status: 200, headers: orgCorsHeaders(origin) })
}

export async function POST(request) {
  const origin = request.headers.get('origin') || ''

  const { email, pendingToken, code } = await request.json()
  if (!email || !pendingToken || !code) {
    return NextResponse.json(
      { error: 'Missing required fields.' },
      { status: 400, headers: orgCorsHeaders(origin) }
    )
  }

  const cleanEmail = String(email).toLowerCase().trim()
  const payload = await verifyOrgToken(pendingToken)
  if (!payload || payload.email !== cleanEmail) {
    return NextResponse.json(
      { error: 'Invalid session. Please log in again.' },
      { status: 401, headers: orgCorsHeaders(origin) }
    )
  }

  // Verify OTP with WapiSMS — they stored the code when phone-send called
  // send/otp, same as the existing customer phone-verify route.
  try {
    const url = new URL('https://wapisms.com/api/get/otp')
    url.searchParams.set('secret', process.env.WAPISMS_API_SECRET)
    url.searchParams.set('otp', String(code).trim())

    const res = await fetch(url.toString(), {
      method: 'GET',
      headers: { 'Content-Type': 'application/json' },
    })
    const data = await res.json()

    if (!res.ok || data.status !== 200 || data.data !== true) {
      return NextResponse.json(
        { error: 'Incorrect code. Please try again.' },
        { status: 400, headers: orgCorsHeaders(origin) }
      )
    }
  } catch (err) {
    console.error('[org phone-verify] WapiSMS error:', err.message)
    return NextResponse.json(
      { error: 'Verification failed. Please try again.' },
      { status: 500, headers: orgCorsHeaders(origin) }
    )
  }

  const supabase = getSupabaseAdmin()
  await supabase
    .from('organization_users')
    .update({ phone_verified_at: new Date().toISOString() })
    .eq('email', cleanEmail)

  return NextResponse.json({ ok: true }, { headers: orgCorsHeaders(origin) })
}

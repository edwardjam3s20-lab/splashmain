// app/api/org/verify/phone-send/route.js
// POST — send phone OTP via WapiSMS for organization_users. Optional/
// deferred, same as the customer flow — nothing in onboarding blocks on
// this, it just lets an owner confirm the phone number they gave at
// signup. WapiSMS generates, sends, and verifies the code on its own
// side — no local code storage needed (see phone-verify).
// Body: { email, pendingToken }

import { NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabase'
import { checkRateLimit } from '@/lib/rateLimit'
import { verifyOrgToken } from '@/lib/orgSession'
import { orgCorsHeaders } from '@/lib/orgCors'

export async function OPTIONS(request) {
  const origin = request.headers.get('origin') || ''
  return new NextResponse(null, { status: 200, headers: orgCorsHeaders(origin) })
}

export async function POST(request) {
  const origin = request.headers.get('origin') || ''

  const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown'
  const limit = checkRateLimit(`org-phone-send:${ip}`)
  if (!limit.allowed) {
    return NextResponse.json(
      { error: `Too many attempts. Try again in ${limit.retryAfter}s.` },
      { status: 429, headers: orgCorsHeaders(origin) }
    )
  }

  const { email, pendingToken } = await request.json()
  if (!email || !pendingToken) {
    return NextResponse.json(
      { error: 'Invalid request.' },
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

  const supabase = getSupabaseAdmin()
  const { data: user } = await supabase
    .from('organization_users')
    .select('phone')
    .eq('email', cleanEmail)
    .maybeSingle()

  if (!user?.phone) {
    return NextResponse.json(
      { error: 'No phone number on file for this account.' },
      { status: 400, headers: orgCorsHeaders(origin) }
    )
  }

  // Normalize to WapiSMS's expected format: 254XXXXXXXXX (no +, no leading 0)
  const normalizedPhone = user.phone.replace(/\D/g, '').replace(/^0/, '254')

  const formData = new FormData()
  formData.append('secret', process.env.WAPISMS_API_SECRET)
  formData.append('type', 'sms')
  formData.append('message', 'Your SplashPass verification code is {{otp}}. Valid for 10 minutes.')
  formData.append('phone', normalizedPhone)
  formData.append('expire', '600')

  try {
    const res = await fetch('https://wapisms.com/api/send/otp', { method: 'POST', body: formData })
    const rawText = await res.text()
    let data = null
    try { data = JSON.parse(rawText) } catch { /* handled by the check below */ }

    if (!res.ok || !data || data.status !== 200) {
      console.error('[org phone-send] WapiSMS error:', { httpStatus: res.status, rawText })
      return NextResponse.json(
        { error: 'Failed to send SMS. Please try again.' },
        { status: 500, headers: orgCorsHeaders(origin) }
      )
    }
  } catch (err) {
    console.error('[org phone-send] WapiSMS network error:', err.message)
    return NextResponse.json(
      { error: 'Failed to send SMS. Please try again.' },
      { status: 500, headers: orgCorsHeaders(origin) }
    )
  }

  return NextResponse.json({ ok: true }, { headers: orgCorsHeaders(origin) })
}

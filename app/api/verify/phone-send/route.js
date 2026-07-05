// app/api/verify/phone-send/route.js
// POST — send phone OTP via WapiSMS
// Body: { email, pendingToken }

import { NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabase'
import { checkRateLimit } from '@/lib/rateLimit'
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
  const ip = request.headers.get('x-forwarded-for') || 'unknown'
  const limit = checkRateLimit(ip)
  if (!limit.allowed) {
    return NextResponse.json(
      { error: `Too many attempts. Try again in ${limit.retryAfter}s.` },
      { status: 429, headers: corsHeaders() }
    )
  }

  const { email, pendingToken } = await request.json()
  if (!email || !pendingToken) {
    return NextResponse.json(
      { error: 'Invalid request.' },
      { status: 400, headers: corsHeaders() }
    )
  }

  // Validate pending token
  const cleanEmail = email.toLowerCase().trim()
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

  // Get user's phone number
  const { data: profile } = await supabase
    .from('profiles')
    .select('phone')
    .eq('email', cleanEmail)
    .single()

  if (!profile?.phone) {
    return NextResponse.json(
      { error: 'No phone number found on your account.' },
      { status: 400, headers: corsHeaders() }
    )
  }

  // Normalize phone to WapiSMS's expected format: 254XXXXXXXXX (no +, no leading 0)
  const normalizedPhone = profile.phone
    .replace(/\D/g, '')          // strip non-digits (removes the +)
    .replace(/^0/, '254')        // convert leading 0 -> 254

  // Send OTP via WapiSMS — they generate, send, and store the code
  const formData = new FormData()
  formData.append('secret', process.env.WAPISMS_API_SECRET)
  formData.append('type', 'sms')
  formData.append('message', 'Your SplashPass verification code is {{otp}}. Valid for 10 minutes.')
  formData.append('phone', normalizedPhone)
  formData.append('expire', '600') // 10 minutes in seconds

  try {
    const res = await fetch('https://wapisms.com/api/send/otp', {
      method: 'POST',
      body: formData,
    })

    const data = await res.json()

    if (!res.ok || data.status !== 200) {
      console.error('WapiSMS OTP send error:', data)
      return NextResponse.json(
        { error: 'Failed to send SMS. Please try again.' },
        { status: 500, headers: corsHeaders() }
      )
    }
  } catch (err) {
    console.error('WapiSMS network error:', err)
    return NextResponse.json(
      { error: 'Failed to send SMS. Please try again.' },
      { status: 500, headers: corsHeaders() }
    )
  }

  return NextResponse.json({ ok: true }, { headers: corsHeaders() })
}

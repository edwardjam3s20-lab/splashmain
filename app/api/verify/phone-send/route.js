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

  // TEMP DIAGNOSTIC — remove once WapiSMS 400 is resolved
  console.log('WapiSMS phone diagnostic:', {
    rawPhoneFromDB: profile.phone,
    normalizedPhone,
    normalizedLength: normalizedPhone.length,
  })

  // TEMP DIAGNOSTIC — log exact outgoing payload, remove once WapiSMS 400 is resolved
  const outgoingPayload = {
    secret: process.env.WAPISMS_API_SECRET ? '[REDACTED - length ' + process.env.WAPISMS_API_SECRET.length + ']' : '[MISSING]',
    type: 'sms',
    message: 'Your SplashPass verification code is {{otp}}. Valid for 10 minutes.',
    phone: normalizedPhone,
    expire: '600',
  }
  console.log('WapiSMS outgoing payload:', outgoingPayload)

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

    // Capture response metadata before touching the body
    const responseHeaders = {}
    res.headers.forEach((value, key) => { responseHeaders[key] = value })

    // Read as text FIRST — if WapiSMS ever returns an HTML error page
    // (e.g. a Cloudflare block, gateway timeout, or misrouted request),
    // res.json() would throw and we'd lose the actual error content.
    const rawText = await res.text()

    let data = null
    let parseError = null
    try {
      data = JSON.parse(rawText)
    } catch (e) {
      parseError = e.message
    }

    if (!res.ok || !data || data.status !== 200) {
      console.error('WapiSMS OTP send error — FULL DETAIL:', {
        httpStatus: res.status,
        httpStatusText: res.statusText,
        responseHeaders,
        rawResponseText: rawText,
        parsedData: data,
        jsonParseError: parseError,
        payloadSent: outgoingPayload,
      })
      return NextResponse.json(
        { error: 'Failed to send SMS. Please try again.' },
        { status: 500, headers: corsHeaders() }
      )
    }
  } catch (err) {
    console.error('WapiSMS network/fetch error:', {
      message: err.message,
      stack: err.stack,
      payloadSent: outgoingPayload,
    })
    return NextResponse.json(
      { error: 'Failed to send SMS. Please try again.' },
      { status: 500, headers: corsHeaders() }
    )
  }

  return NextResponse.json({ ok: true }, { headers: corsHeaders() })
}

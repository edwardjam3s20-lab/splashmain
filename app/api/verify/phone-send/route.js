// api/verify/phone-send/route.js
// POST — send SMS OTP to phone number for customer verification
// Body: { email, pendingToken }
// Uses Africa's Talking SMS (same provider as booking reminders)

import { NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabase'
import { checkRateLimit } from '@/lib/rateLimit'
import { jwtVerify } from 'jose'
import AfricasTalking from 'africastalking'

const at = AfricasTalking({
  apiKey:   process.env.AT_API_KEY,
  username: process.env.AT_USERNAME || 'sandbox',
})
const sms = at.SMS

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

function generateCode() {
  return Math.floor(100000 + Math.random() * 900000).toString()
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

  // Get user's phone number from profiles
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

  const code = generateCode()
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString()

  await supabase.from('customer_verification').upsert(
    {
      email:                 cleanEmail,
      phone_code:            code,
      phone_code_expires_at: expiresAt,
    },
    { onConflict: 'email' }
  )

  try {
    await sms.send({
      to:      [profile.phone],
      message: `Your SplashPass verification code is ${code}. Valid for 10 minutes. Do not share this code.`,
      from:    process.env.AT_SENDER_ID || undefined,
    })
  } catch (smsError) {
    console.error('SMS error:', smsError)
    return NextResponse.json(
      { error: 'Failed to send SMS. Please try again.' },
      { status: 500, headers: corsHeaders() }
    )
  }

  return NextResponse.json({ ok: true }, { headers: corsHeaders() })
}

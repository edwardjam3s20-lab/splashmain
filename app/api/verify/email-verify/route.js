// api/verify/email-verify/route.js
// POST — confirm 6-digit email OTP, mark email_verified on profile
// Body: { email, pendingToken, code }

import { NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabase'
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
  const { email, pendingToken, code } = await request.json()

  if (!email || !pendingToken || !code) {
    return NextResponse.json(
      { error: 'Missing required fields.' },
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

  // Fetch stored code
  const { data: row } = await supabase
    .from('customer_verification')
    .select('email_code, email_code_expires_at')
    .eq('email', cleanEmail)
    .single()

  if (!row?.email_code) {
    return NextResponse.json(
      { error: 'No code found. Please request a new one.' },
      { status: 400, headers: corsHeaders() }
    )
  }

  if (new Date() > new Date(row.email_code_expires_at)) {
    return NextResponse.json(
      { error: 'Code expired. Please request a new one.' },
      { status: 400, headers: corsHeaders() }
    )
  }

  if (code.trim() !== row.email_code) {
    return NextResponse.json(
      { error: 'Incorrect code. Please try again.' },
      { status: 400, headers: corsHeaders() }
    )
  }

  // Clear used code and mark email verified on profile
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

  return NextResponse.json({ ok: true }, { headers: corsHeaders() })
}

// api/auth/reset-password/route.js
// POST — confirm the reset code from /api/auth/forgot-password and set a
// new password. Body: { email, code, newPassword }
//
// Deliberately does NOT auto-login on success — returns { ok: true } and
// lets the client send them to the normal login screen with their new
// password. Simpler and more standard than re-deriving login's
// email/phone-verification branching here, and it means this route only
// ever has one job: change the password.

import { NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabase'
import { revokeAllRefreshTokensForEmail } from '@/lib/session'
import { checkRateLimit } from '@/lib/rateLimit'

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
    'Vary': 'Origin',
    'Cache-Control': 'no-store',
  }
}

export async function OPTIONS(request) {
  const origin = request.headers.get('origin') || ''
  return new NextResponse(null, { status: 200, headers: corsHeaders(origin) })
}

// Mirrors src/components/v2/PasswordChecklist.tsx on the frontend — kept
// in sync so the checklist shown while typing is also what's actually
// enforced server-side, not just client-side decoration.
function isPasswordValid(password) {
  return password.length >= 8 && /[0-9]/.test(password) && /[^A-Za-z0-9]/.test(password)
}

export async function POST(request) {
  const origin = request.headers.get('origin') || ''

  const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown'
  const limit = checkRateLimit(`reset-password:${ip}`)
  if (!limit.allowed) {
    return NextResponse.json(
      { error: `Too many attempts. Try again in ${limit.retryAfter}s.` },
      { status: 429, headers: corsHeaders(origin) }
    )
  }

  const { email, code, newPassword } = await request.json().catch(() => ({}))
  if (!email || !code || !newPassword) {
    return NextResponse.json(
      { error: 'Email, code, and new password are all required.' },
      { status: 400, headers: corsHeaders(origin) }
    )
  }

  if (!isPasswordValid(String(newPassword))) {
    return NextResponse.json(
      { error: 'Password must be at least 8 characters and include a number and a special character.' },
      { status: 400, headers: corsHeaders(origin) }
    )
  }

  const cleanEmail = String(email).toLowerCase().trim()
  const supabase = getSupabaseAdmin()

  const { data: user } = await supabase
    .from('profiles')
    .select('id, role')
    .eq('email', cleanEmail)
    .maybeSingle()

  // Defensive — forgot-password never sends a code for an operator account,
  // but guard the endpoint itself too rather than relying on that alone.
  if (!user || user.role === 'operator') {
    return NextResponse.json({ error: 'Incorrect code. Please try again.' }, { status: 400, headers: corsHeaders(origin) })
  }

  const { data: row } = await supabase
    .from('customer_verification')
    .select('reset_code, reset_code_expires_at')
    .eq('email', cleanEmail)
    .maybeSingle()

  if (!row?.reset_code) {
    return NextResponse.json(
      { error: 'No reset code found. Please request a new one.' },
      { status: 400, headers: corsHeaders(origin) }
    )
  }
  if (new Date() > new Date(row.reset_code_expires_at)) {
    return NextResponse.json(
      { error: 'Code expired. Please request a new one.' },
      { status: 400, headers: corsHeaders(origin) }
    )
  }
  if (String(code).trim() !== row.reset_code) {
    return NextResponse.json(
      { error: 'Incorrect code. Please try again.' },
      { status: 400, headers: corsHeaders(origin) }
    )
  }

  const { data: hashData, error: hashError } = await supabase.rpc('hash_password', {
    p_password: newPassword,
  })
  if (hashError || !hashData) {
    return NextResponse.json(
      { error: 'Could not reset password. Please try again.' },
      { status: 500, headers: corsHeaders(origin) }
    )
  }
  const hashedPassword = Array.isArray(hashData) ? hashData[0]?.hash_password : hashData

  const { error: updateError } = await supabase
    .from('profiles')
    .update({ password: hashedPassword })
    .eq('email', cleanEmail)

  if (updateError) {
    return NextResponse.json(
      { error: 'Could not reset password. Please try again.' },
      { status: 500, headers: corsHeaders(origin) }
    )
  }

  // One-time code, used — clear it so it can't be replayed.
  await supabase
    .from('customer_verification')
    .update({ reset_code: null, reset_code_expires_at: null })
    .eq('email', cleanEmail)

  // Password changed — kill every other live session/refresh chain for
  // this account, same as a security-conscious "change password" should.
  await revokeAllRefreshTokensForEmail(cleanEmail)

  return NextResponse.json({ ok: true }, { headers: corsHeaders(origin) })
}

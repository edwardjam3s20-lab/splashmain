// api/auth/register/route.js
// POST — create customer account (unverified), send email OTP, return pendingToken
// Flow: register → verify email → verify phone → fully logged in

import { NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabase'
import { createSession } from '@/lib/session'
import { checkRateLimit } from '@/lib/rateLimit'
import { Resend } from 'resend'

const resend = new Resend(process.env.RESEND_API_KEY)

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

function generateCode() {
  return Math.floor(100000 + Math.random() * 900000).toString()
}

export async function POST(request) {
  const origin = request.headers.get('origin') || ''

  // SECURITY: registration had no rate limiting at all — unbounded, this
  // enables mass fake-account creation (each gets a free 30-day trial) and
  // makes the email-enumeration signal below ("account already exists")
  // cheap to script against a large list of addresses. A looser limit than
  // login's, since legitimate multi-device signups from behind the same
  // NAT/IP are more plausible here than repeated login failures.
  const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown'
  const limit = checkRateLimit(`register:${ip}`)
  if (!limit.allowed) {
    return NextResponse.json(
      { error: `Too many attempts. Try again in ${limit.retryAfter}s.` },
      { status: 429, headers: corsHeaders(origin) }
    )
  }

  const { name, email, phone, password } = await request.json()

  if (!name || !email || !phone || !password) {
    return NextResponse.json(
      { error: 'All fields required' },
      { status: 400, headers: corsHeaders(origin) }
    )
  }
  if (password.length < 6) {
    return NextResponse.json(
      { error: 'Password must be at least 6 characters' },
      { status: 400, headers: corsHeaders(origin) }
    )
  }

  if (!/^\+\d{7,15}$/.test(phone.trim())) {
    return NextResponse.json(
      { error: 'Phone must be in international format e.g. +254712345678' },
      { status: 400, headers: corsHeaders(origin) }
    )
  }

  const supabase = getSupabaseAdmin()
  const cleanEmail = email.toLowerCase().trim()
  const cleanPhone = phone.trim()

  const { data: existing } = await supabase
    .from('profiles')
    .select('id, email_verified, phone_verified')
    .eq('email', cleanEmail)
    .maybeSingle()

  if (existing) {
    return NextResponse.json(
      { error: 'An account with this email already exists' },
      { status: 409, headers: corsHeaders(origin) }
    )
  }

  const { data: hashData, error: hashError } = await supabase.rpc('hash_password', {
    p_password: password,
  })

  if (hashError || !hashData) {
    return NextResponse.json(
      { error: 'Registration failed. Please try again.' },
      { status: 500, headers: corsHeaders(origin) }
    )
  }

  const hashedPassword = Array.isArray(hashData) ? hashData[0]?.hash_password : hashData

  const { data: newUsers, error: insertError } = await supabase
    .from('profiles')
    .insert({
      name,
      email:          cleanEmail,
      phone:          cleanPhone,
      password:       hashedPassword,
      role:           'customer',
      sub_status:     'trial',
      loyalty_points: 0,
      loyalty_tier:   'Bronze',
      email_verified: false,
      phone_verified: false,
    })
    .select()

  if (insertError) {
    return NextResponse.json(
      { error: insertError.message },
      { status: 500, headers: corsHeaders(origin) }
    )
  }

  const user = newUsers[0]
  delete user.password

  const pendingToken = await createSession({
    email: cleanEmail,
    name:  user.name,
    role:  user.role,
    pending: true,
  })

  const code = generateCode()
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString()

  await supabase.from('customer_verification').upsert(
    {
      email:                 cleanEmail,
      email_code:            code,
      email_code_expires_at: expiresAt,
    },
    { onConflict: 'email' }
  )

  await resend.emails.send({
    from: 'SplashPass <noreply@splashpass.site>',
    to:   cleanEmail,
    subject: 'Verify your SplashPass email',
    html: `
      <div style="font-family:sans-serif;max-width:480px;margin:0 auto;padding:32px;background:#0f1d30;border-radius:16px;">
        <div style="font-size:28px;font-weight:800;color:#f0f4f8;margin-bottom:8px;">SplashPass</div>
        <div style="font-size:15px;color:#f0f4f8;margin-bottom:24px;">Hi ${user.name}, verify your email to get started.</div>
        <div style="background:#1e3050;border-radius:12px;padding:24px;text-align:center;margin-bottom:24px;">
          <div style="font-size:42px;font-weight:800;letter-spacing:12px;color:#f5a623;font-family:monospace;">${code}</div>
        </div>
        <div style="font-size:13px;color:#7a90a8;line-height:1.6;">
          This code expires in <strong style="color:#f0f4f8;">10 minutes</strong>.<br>
          If you didn't create a SplashPass account, you can ignore this email.
        </div>
      </div>
    `,
  })

  return NextResponse.json(
    { ok: true, user, pendingToken },
    { headers: corsHeaders(origin) }
  )
}

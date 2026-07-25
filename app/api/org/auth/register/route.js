// app/api/org/auth/register/route.js
// POST — create an organization_users account (Step 1: person, not
// business — no organization exists yet). Unverified until email OTP is
// confirmed. Mirrors app/api/auth/register/route.js's flow, but writes to
// organization_users instead of profiles, and issues an org-scoped
// pending session, never the customer one.

import { NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabase'
import { createOrgSession } from '@/lib/orgSession'
import { hashOrgPassword } from '@/lib/orgPassword'
import { checkRateLimit } from '@/lib/rateLimit'
import { orgCorsHeaders } from '@/lib/orgCors'
import { Resend } from 'resend'

const resend = new Resend(process.env.RESEND_API_KEY)

export async function OPTIONS(request) {
  const origin = request.headers.get('origin') || ''
  return new NextResponse(null, { status: 200, headers: orgCorsHeaders(origin) })
}

function generateCode() {
  return Math.floor(100000 + Math.random() * 900000).toString()
}

export async function POST(request) {
  const origin = request.headers.get('origin') || ''

  // SECURITY: unbounded registration enables mass fake-account creation
  // and makes the email-enumeration signal below cheap to script against
  // a list of addresses — same reasoning as the customer register route.
  const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown'
  const limit = checkRateLimit(`org-register:${ip}`)
  if (!limit.allowed) {
    return NextResponse.json(
      { error: `Too many attempts. Try again in ${limit.retryAfter}s.` },
      { status: 429, headers: orgCorsHeaders(origin) }
    )
  }

  const { fullName, email, phone, password } = await request.json()

  if (!fullName || !email || !password) {
    return NextResponse.json(
      { error: 'Name, email and password are required.' },
      { status: 400, headers: orgCorsHeaders(origin) }
    )
  }
  if (String(password).length < 8) {
    return NextResponse.json(
      { error: 'Password must be at least 8 characters.' },
      { status: 400, headers: orgCorsHeaders(origin) }
    )
  }
  if (phone && !/^\+\d{7,15}$/.test(String(phone).trim())) {
    return NextResponse.json(
      { error: 'Phone must be in international format e.g. +254712345678' },
      { status: 400, headers: orgCorsHeaders(origin) }
    )
  }

  const supabase = getSupabaseAdmin()
  const cleanEmail = String(email).toLowerCase().trim()
  const cleanPhone = phone ? String(phone).trim() : null

  const { data: existing } = await supabase
    .from('organization_users')
    .select('id')
    .eq('email', cleanEmail)
    .maybeSingle()

  if (existing) {
    return NextResponse.json(
      { error: 'An account with this email already exists.' },
      { status: 409, headers: orgCorsHeaders(origin) }
    )
  }

  const { data: inserted, error: insertError } = await supabase
    .from('organization_users')
    .insert({
      full_name: String(fullName).trim(),
      email: cleanEmail,
      phone: cleanPhone,
      password: hashOrgPassword(password),
    })
    .select('id, email, full_name, phone, created_at')
    .single()

  if (insertError) {
    // Unique-constraint race: two concurrent requests for the same email
    // (see supabase/003_org_onboarding_support.sql for the constraint).
    if (insertError.code === '23505') {
      return NextResponse.json(
        { error: 'An account with this email already exists.' },
        { status: 409, headers: orgCorsHeaders(origin) }
      )
    }
    console.error('[org register] insert error:', insertError.message)
    return NextResponse.json(
      { error: 'Registration failed. Please try again.' },
      { status: 500, headers: orgCorsHeaders(origin) }
    )
  }

  const pendingToken = await createOrgSession({
    userId: inserted.id,
    email: inserted.email,
    pending: true,
  })

  const code = generateCode()
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString()

  await supabase.from('organization_user_verification').upsert(
    { email: cleanEmail, email_code: code, email_code_expires_at: expiresAt },
    { onConflict: 'email' }
  )

  await resend.emails.send({
    from: 'SplashPass <noreply@splashpass.site>',
    to: cleanEmail,
    subject: 'Verify your SplashPass business account',
    html: `
      <div style="font-family:sans-serif;max-width:480px;margin:0 auto;padding:32px;background:#0B1437;border-radius:16px;">
        <div style="font-size:28px;font-weight:800;color:#f0f4f8;margin-bottom:8px;">SplashPass</div>
        <div style="font-size:15px;color:#f0f4f8;margin-bottom:24px;">Hi ${inserted.full_name}, verify your email to start setting up your business.</div>
        <div style="background:#1e3050;border-radius:12px;padding:24px;text-align:center;margin-bottom:24px;">
          <div style="font-size:42px;font-weight:800;letter-spacing:12px;color:#F5A623;font-family:monospace;">${code}</div>
        </div>
        <div style="font-size:13px;color:#7a90a8;line-height:1.6;">
          This code expires in <strong style="color:#f0f4f8;">10 minutes</strong>.<br>
          If you didn't request this, you can ignore this email.
        </div>
      </div>
    `,
  })

  return NextResponse.json(
    { ok: true, user: inserted, pendingToken },
    { headers: orgCorsHeaders(origin) }
  )
}

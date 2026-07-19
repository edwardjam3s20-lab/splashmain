// api/auth/forgot-password/route.js
// POST — request a password-reset code. Body: { email }
//
// Always responds { ok: true } regardless of whether the email matches an
// account, a role='operator' account, or nothing at all — the alternative
// (a distinct "no account with that email" error) turns this endpoint into
// an email-enumeration oracle. The actual reset code is only generated and
// sent when there's a matching customer account.
//
// Works the same whether the account was created via password registration
// or via Google (google/callback/route.js gives Google signups a random,
// unusable password) — this is in fact the only way a Google-only account
// can ever gain a real password and start being able to log in with
// email+password too.

import { NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabase'
import { checkRateLimit } from '@/lib/rateLimit'
import { Resend } from 'resend'

const resend = new Resend(process.env.RESEND_API_KEY)

// See the matching comment in api/auth/register/route.js — kept in sync
// with that allowlist.
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

function generateCode() {
  return Math.floor(100000 + Math.random() * 900000).toString()
}

export async function POST(request) {
  const origin = request.headers.get('origin') || ''

  const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown'
  const limit = checkRateLimit(`forgot-password:${ip}`)
  if (!limit.allowed) {
    return NextResponse.json(
      { error: `Too many attempts. Try again in ${limit.retryAfter}s.` },
      { status: 429, headers: corsHeaders(origin) }
    )
  }

  const { email } = await request.json().catch(() => ({}))
  if (!email) {
    return NextResponse.json({ error: 'Email is required.' }, { status: 400, headers: corsHeaders(origin) })
  }

  const cleanEmail = String(email).toLowerCase().trim()
  const supabase = getSupabaseAdmin()

  const { data: user } = await supabase
    .from('profiles')
    .select('id, role, name')
    .eq('email', cleanEmail)
    .maybeSingle()

  // Deliberately the same response whether or not a matching customer
  // account exists — see the file-level comment above.
  if (user && user.role !== 'operator') {
    const code = generateCode()
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString()

    await supabase.from('customer_verification').upsert(
      { email: cleanEmail, reset_code: code, reset_code_expires_at: expiresAt },
      { onConflict: 'email' }
    )

    await resend.emails.send({
      from: 'SplashPass <noreply@splashpass.site>',
      to: cleanEmail,
      subject: 'Reset your SplashPass password',
      html: `
        <div style="font-family:sans-serif;max-width:480px;margin:0 auto;padding:32px;background:#0f1d30;border-radius:16px;">
          <div style="font-size:28px;font-weight:800;color:#f0f4f8;margin-bottom:8px;">SplashPass</div>
          <div style="font-size:15px;color:#f0f4f8;margin-bottom:24px;">Hi ${user.name || ''}, here's your password reset code.</div>
          <div style="background:#1e3050;border-radius:12px;padding:24px;text-align:center;margin-bottom:24px;">
            <div style="font-size:42px;font-weight:800;letter-spacing:12px;color:#f5a623;font-family:monospace;">${code}</div>
          </div>
          <div style="font-size:13px;color:#7a90a8;line-height:1.6;">
            This code expires in <strong style="color:#f0f4f8;">10 minutes</strong>.<br>
            If you didn't request this, you can safely ignore this email — your password won't change.
          </div>
        </div>
      `,
    })
  }

  return NextResponse.json({ ok: true }, { headers: corsHeaders(origin) })
}

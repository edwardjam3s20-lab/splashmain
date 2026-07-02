// api/verify/email-send/route.js
// POST — (re)send email verification OTP for customer signup/login flow
// Body: { email, pendingToken }

import { NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabase'
import { Resend } from 'resend'
import { checkRateLimit } from '@/lib/rateLimit'
import { jwtVerify } from 'jose'

const resend = new Resend(process.env.RESEND_API_KEY)
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

  // Validate the pending token
  try {
    const { payload } = await jwtVerify(pendingToken, SECRET)
    if (payload.email !== email.toLowerCase().trim()) {
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
  const cleanEmail = email.toLowerCase().trim()
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

  const { error: emailError } = await resend.emails.send({
    from: 'SplashPass <noreply@splashpass.site>',
    to:   cleanEmail,
    subject: 'Verify your SplashPass email',
    html: `
      <div style="font-family:sans-serif;max-width:480px;margin:0 auto;padding:32px;background:#0f1d30;border-radius:16px;">
        <div style="font-size:28px;font-weight:800;color:#f0f4f8;margin-bottom:8px;">SplashPass</div>
        <div style="font-size:15px;color:#f0f4f8;margin-bottom:24px;">Your email verification code:</div>
        <div style="background:#1e3050;border-radius:12px;padding:24px;text-align:center;margin-bottom:24px;">
          <div style="font-size:42px;font-weight:800;letter-spacing:12px;color:#f5a623;font-family:monospace;">${code}</div>
        </div>
        <div style="font-size:13px;color:#7a90a8;line-height:1.6;">
          This code expires in <strong style="color:#f0f4f8;">10 minutes</strong>.<br>
          If you didn't request this, ignore this email.
        </div>
      </div>
    `,
  })

  if (emailError) {
    return NextResponse.json(
      { error: 'Failed to send email. Please try again.' },
      { status: 500, headers: corsHeaders() }
    )
  }

  return NextResponse.json({ ok: true }, { headers: corsHeaders() })
}

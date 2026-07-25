// app/api/org/verify/email-send/route.js
// POST — (re)send email verification OTP during organization_users signup.
// Body: { email, pendingToken }

import { NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabase'
import { checkRateLimit } from '@/lib/rateLimit'
import { verifyOrgToken } from '@/lib/orgSession'
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

  const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown'
  const limit = checkRateLimit(`org-email-send:${ip}`)
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
    .select('full_name')
    .eq('email', cleanEmail)
    .maybeSingle()

  const code = generateCode()
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString()

  await supabase.from('organization_user_verification').upsert(
    { email: cleanEmail, email_code: code, email_code_expires_at: expiresAt },
    { onConflict: 'email' }
  )

  await resend.emails.send({
    from: 'SplashPass <noreply@splashpass.site>',
    to: cleanEmail,
    subject: 'Your SplashPass verification code',
    html: `
      <div style="font-family:sans-serif;max-width:480px;margin:0 auto;padding:32px;background:#0B1437;border-radius:16px;">
        <div style="font-size:28px;font-weight:800;color:#f0f4f8;margin-bottom:8px;">SplashPass</div>
        <div style="font-size:15px;color:#f0f4f8;margin-bottom:24px;">Hi ${user?.full_name || ''}, here's your verification code.</div>
        <div style="background:#1e3050;border-radius:12px;padding:24px;text-align:center;margin-bottom:24px;">
          <div style="font-size:42px;font-weight:800;letter-spacing:12px;color:#F5A623;font-family:monospace;">${code}</div>
        </div>
        <div style="font-size:13px;color:#7a90a8;line-height:1.6;">
          This code expires in <strong style="color:#f0f4f8;">10 minutes</strong>.
        </div>
      </div>
    `,
  })

  return NextResponse.json({ ok: true }, { headers: orgCorsHeaders(origin) })
}

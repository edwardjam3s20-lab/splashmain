import { NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabase'
import { Resend } from 'resend'
import { checkRateLimit } from '@/lib/rateLimit'

const resend = new Resend(process.env.RESEND_API_KEY)

function generateCode() {
  return Math.floor(100000 + Math.random() * 900000).toString()
}

export async function POST(request) {
  const ip = request.headers.get('x-forwarded-for') || 'unknown'
  const limit = checkRateLimit(ip)
  if (!limit.allowed) {
    return NextResponse.json(
      { error: `Too many attempts. Try again in ${limit.retryAfter}s.` },
      { status: 429 }
    )
  }

  const { email, pendingToken } = await request.json()
  if (!email || !pendingToken) {
    return NextResponse.json({ error: 'Invalid request.' }, { status: 400 })
  }

  // Verify the pending token
  const supabase = getSupabaseAdmin()
  const { data: userData, error } = await supabase.auth.getUser(pendingToken)
  if (error || !userData?.user || userData.user.email !== email) {
    return NextResponse.json({ error: 'Invalid session. Please log in again.' }, { status: 401 })
  }

  // Generate a 6-digit code, store in Supabase with 10 min expiry
  const code = generateCode()
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString()

  await supabase.from('admin_2fa').upsert(
    { email, code, code_expires_at: expiresAt },
    { onConflict: 'email' }
  )

  // Send email via Resend
  const { error: emailError } = await resend.emails.send({
    from: 'SplashPass Admin <onboarding@resend.dev>',
    to: email,
    subject: 'Your SplashPass Admin Login Code',
    html: `
      <div style="font-family:sans-serif;max-width:480px;margin:0 auto;padding:32px;background:#0f1d30;border-radius:16px;">
        <div style="font-size:28px;font-weight:800;color:#f0f4f8;margin-bottom:8px;">SplashPass</div>
        <div style="font-size:14px;color:#7a90a8;margin-bottom:32px;">Admin Panel</div>
        <div style="font-size:15px;color:#f0f4f8;margin-bottom:24px;">Your login verification code:</div>
        <div style="background:#1e3050;border-radius:12px;padding:24px;text-align:center;margin-bottom:24px;">
          <div style="font-size:42px;font-weight:800;letter-spacing:12px;color:#f5a623;font-family:monospace;">${code}</div>
        </div>
        <div style="font-size:13px;color:#7a90a8;line-height:1.6;">
          This code expires in <strong style="color:#f0f4f8;">10 minutes</strong>.<br>
          If you didn't request this, ignore this email.
        </div>
      </div>
    `
  })

  if (emailError) {
    console.error('Email error:', emailError)
    return NextResponse.json({ error: 'Failed to send email. Please try again.' }, { status: 500 })
  }

  return NextResponse.json({ success: true })
}

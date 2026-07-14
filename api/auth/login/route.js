// api/auth/login/route.js
// POST — verify password, check verification status, set session or return pendingToken

import { NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabase'
import { createSession, setSessionCookie, issueRefreshToken, setRefreshCookie } from '@/lib/session'
import { checkRateLimit, resetRateLimit } from '@/lib/rateLimit'
import { Resend } from 'resend'

const resend = new Resend(process.env.RESEND_API_KEY)

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
  // SECURITY: this route previously had no rate limiting at all, unlike
  // the operator login (app/api/operator/auth/login/route.js), which
  // already uses this same limiter — customer accounts were open to
  // unlimited password guessing. Matches the operator login's limits
  // (5 attempts / 15 min / IP) for consistency.
  const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown'
  const limit = checkRateLimit(`customer-login:${ip}`)
  if (!limit.allowed) {
    return NextResponse.json(
      { error: `Too many attempts. Try again in ${limit.retryAfter}s.` },
      { status: 429, headers: corsHeaders() }
    )
  }

  const { email, password } = await request.json()

  if (!email || !password) {
    return NextResponse.json(
      { error: 'Email and password required' },
      { status: 400, headers: corsHeaders() }
    )
  }

  const supabase = getSupabaseAdmin()

  const { data, error } = await supabase.rpc('verify_password', {
    p_email:    email.toLowerCase().trim(),
    p_password: password,
  })

  if (error) {
    return NextResponse.json(
      { error: error.message },
      { status: 500, headers: corsHeaders() }
    )
  }

  if (!data || data.length === 0) {
    return NextResponse.json(
      { error: 'Invalid email or password' },
      { status: 401, headers: corsHeaders() }
    )
  }

  const user = data[0]
  delete user.password

  if (user.role === 'operator') {
    return NextResponse.json(
      { error: 'Use the operator app to log in' },
      { status: 403, headers: corsHeaders() }
    )
  }

  // If either verification is incomplete, return a pendingToken so the
  // client can resume the verification flow rather than blocking silently.
  if (!user.email_verified || !user.phone_verified) {
    const pendingToken = await createSession({
      email:   user.email,
      name:    user.name,
      role:    user.role,
      pending: true,
    })

    // Re-send whichever OTP they still need so they land on the right
    // screen with a fresh code already in their inbox/messages.
    const cleanEmail = user.email
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString()

    if (!user.email_verified) {
      const code = generateCode()
      await supabase.from('customer_verification').upsert(
        { email: cleanEmail, email_code: code, email_code_expires_at: expiresAt },
        { onConflict: 'email' }
      )
      await resend.emails.send({
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
            <div style="font-size:13px;color:#7a90a8;">Expires in 10 minutes.</div>
          </div>
        `,
      })
    }

    return NextResponse.json(
      {
        ok:           false,
        pendingToken,
        user,
        emailVerified: user.email_verified,
        phoneVerified: user.phone_verified,
      },
      { headers: corsHeaders() }
    )
  }

  // Fully verified — issue real session: a short-lived access token plus a
  // new refresh-token chain. The refresh token is what lets the client
  // silently keep the session alive past 15 minutes without another
  // password prompt — see lib/session.js and /api/auth/refresh.
  resetRateLimit(`customer-login:${ip}`)
  const token = await createSession({
    email: user.email,
    name:  user.name,
    role:  user.role,
  })
  const refreshToken = await issueRefreshToken(user.email)

  // SECURITY: previously this returned `pendingToken: token` here too —
  // `token` at this point is the real, live session JWT, sent in the
  // plaintext JSON body in addition to being set as an httpOnly cookie
  // below. Anything that can read a fetch response (client JS, browser
  // extensions, logging/analytics SDKs that capture responses) would get
  // a bearer-equivalent of the session, defeating the purpose of
  // httpOnly. The client never used this value in the success branch
  // anyway (see loginWithEmail in the customer app, which discards it
  // when data.ok is true) — it's only meaningful in the pending/
  // unverified branch above, where it really is a distinct short-lived
  // "pending" token, not the full session.
  const res = NextResponse.json(
    { ok: true, user },
    { headers: corsHeaders() }
  )
  setSessionCookie(res, token)
  setRefreshCookie(res, refreshToken)
  return res
}

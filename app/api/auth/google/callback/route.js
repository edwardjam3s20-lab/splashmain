// app/api/auth/google/callback/route.js
// GET — Google redirects here with ?code=...&state=... after the user
// approves the consent screen. Exchange the code for tokens, pull the
// user's profile off Google, find-or-create the matching `profiles` row,
// then set the same session cookies login/route.js sets. This is a
// full-page browser redirect, not an XHR call, so — like the /google
// start route — it doesn't need CORS headers.

import { NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabase'
import { createSession, setSessionCookie, issueRefreshToken, setRefreshCookie } from '@/lib/session'
import crypto from 'crypto'

const FRONTEND_URL = process.env.CUSTOMER_APP_ORIGIN || 'https://app.splashpass.site'

function redirectWithError(nextOrigin, message) {
  const url = new URL(nextOrigin)
  url.searchParams.set('googleAuthError', message)
  const res = NextResponse.redirect(url.toString())
  res.cookies.delete('google_oauth_state')
  res.cookies.delete('google_oauth_next')
  return res
}

export async function GET(request) {
  const { searchParams, origin: requestOrigin } = new URL(request.url)
  const code = searchParams.get('code')
  const state = searchParams.get('state')
  const googleError = searchParams.get('error')

  const cookieState = request.cookies.get('google_oauth_state')?.value
  const nextOrigin = request.cookies.get('google_oauth_next')?.value || FRONTEND_URL

  if (googleError) {
    return redirectWithError(nextOrigin, 'google_denied')
  }
  if (!code || !state || !cookieState || state !== cookieState) {
    return redirectWithError(nextOrigin, 'invalid_state')
  }

  const redirectUri = process.env.GOOGLE_REDIRECT_URI || `${requestOrigin}/api/auth/google/callback`

  // Exchange the authorization code for tokens.
  const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: process.env.GOOGLE_CLIENT_ID,
      client_secret: process.env.GOOGLE_CLIENT_SECRET,
      redirect_uri: redirectUri,
      grant_type: 'authorization_code',
    }),
  })

  if (!tokenRes.ok) {
    return redirectWithError(nextOrigin, 'token_exchange_failed')
  }
  const tokens = await tokenRes.json()

  // Pull the user's Google profile using the access token.
  const profileRes = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
    headers: { Authorization: `Bearer ${tokens.access_token}` },
  })
  if (!profileRes.ok) {
    return redirectWithError(nextOrigin, 'profile_fetch_failed')
  }
  const googleProfile = await profileRes.json()
  // googleProfile: { sub, email, email_verified, name, picture, ... }

  if (!googleProfile.email) {
    return redirectWithError(nextOrigin, 'no_email_from_google')
  }

  const cleanEmail = googleProfile.email.toLowerCase().trim()
  const supabase = getSupabaseAdmin()

  const { data: existing, error: lookupError } = await supabase
    .from('profiles')
    .select('id, email, name, phone, role, email_verified, phone_verified')
    .eq('email', cleanEmail)
    .maybeSingle()

  if (lookupError) {
    return redirectWithError(nextOrigin, 'lookup_failed')
  }

  if (existing && existing.role === 'operator') {
    return redirectWithError(nextOrigin, 'use_operator_app')
  }

  let user = existing

  if (!user) {
    // NOTE: `profiles` requires a `password` and (per register/route.js)
    // a validated `phone` — neither of which Google gives us. This sets
    // a random unusable password (Google users never need it — they'll
    // always come back through this route) and leaves phone blank/unset.
    // I haven't seen the actual `profiles` table schema/constraints, so
    // if `phone` is NOT NULL this insert will fail — worth confirming
    // before shipping, and swapping in whatever placeholder your schema
    // allows.
    const { data: hashData, error: hashError } = await supabase.rpc('hash_password', {
      p_password: crypto.randomBytes(32).toString('hex'),
    })
    if (hashError || !hashData) {
      return redirectWithError(nextOrigin, 'account_creation_failed')
    }
    const hashedPassword = Array.isArray(hashData) ? hashData[0]?.hash_password : hashData

    const { data: newUsers, error: insertError } = await supabase
      .from('profiles')
      .insert({
        name: googleProfile.name || cleanEmail.split('@')[0],
        email: cleanEmail,
        password: hashedPassword,
        role: 'customer',
        sub_status: 'trial',
        loyalty_points: 0,
        loyalty_tier: 'Bronze',
        // Google's own email_verified flag confirms ownership, so we can
        // skip our OTP step for email — same trust boundary as the rest
        // of this codebase treats a confirmed OTP.
        email_verified: true,
        phone_verified: false,
      })
      .select()

    if (insertError || !newUsers?.length) {
      return redirectWithError(nextOrigin, 'account_creation_failed')
    }
    user = newUsers[0]
  } else if (!user.email_verified) {
    // Existing password-based account, now confirmed via Google — mark
    // email verified so they're not stuck re-doing OTP for no reason.
    await supabase.from('profiles').update({ email_verified: true }).eq('id', user.id)
    user.email_verified = true
  }

  delete user.password

  // Mirrors login/route.js: fully verified -> real session. Accounts that
  // already had a phone number on file but never confirmed it (e.g. an
  // existing password-based account) still go through the OTP resend
  // flow. Brand-new Google signups have no phone at all — there's
  // nothing to text an OTP to yet — so instead of routing them into a
  // broken OTP screen, we log them in with a full session and flag
  // profileIncomplete so the client sends them to /profile-setup to
  // collect (and then verify) a phone number.
  if (!user.phone_verified && user.phone) {
    const pendingToken = await createSession({
      email: user.email,
      name: user.name,
      role: user.role,
      pending: true,
    })
    const url = new URL(nextOrigin)
    url.searchParams.set('pendingToken', pendingToken)
    url.searchParams.set('email', user.email)
    url.searchParams.set('needsPhone', '1')
    const res = NextResponse.redirect(url.toString())
    res.cookies.delete('google_oauth_state')
    res.cookies.delete('google_oauth_next')
    return res
  }

  const token = await createSession({
    email: user.email,
    name: user.name,
    role: user.role,
  })
  const refreshToken = await issueRefreshToken(user.email)

  const url = new URL(nextOrigin)
  if (!user.phone) {
    url.searchParams.set('profileIncomplete', '1')
  }

  const res = NextResponse.redirect(url.toString())
  setSessionCookie(res, token)
  setRefreshCookie(res, refreshToken)
  res.cookies.delete('google_oauth_state')
  res.cookies.delete('google_oauth_next')
  return res
}

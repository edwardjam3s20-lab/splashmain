// app/api/auth/google/route.js
// GET — starts the Google OAuth flow: redirect the browser to Google's
// consent screen. This is a full-page navigation (the user clicks a
// "Continue with Google" link/button that points here), not an XHR call,
// so it doesn't need the CORS handling that login/register use.

import { NextResponse } from 'next/server'
import crypto from 'crypto'

// Same allowlist used by login/register/refresh — reused here only to
// validate the optional `next` redirect target below, so we never bounce
// the user back to an arbitrary attacker-controlled URL after login.
const CUSTOMER_APP_ORIGINS = new Set([
  'http://localhost:5173',
  'https://splashpass-react.vercel.app',
  'https://splashpass.site',
  'https://www.splashpass.site',
  'https://app.splashpass.site',
])

const FRONTEND_URL = process.env.CUSTOMER_APP_ORIGIN || 'https://app.splashpass.site'

export async function GET(request) {
  const { searchParams, origin: requestOrigin } = new URL(request.url)

  // Where to send the browser back to after a successful login. Defaults
  // to the main customer app; only honors `next` if it's one of our own
  // origins, to avoid an open-redirect via this param.
  const requestedNext = searchParams.get('next') || ''
  let nextOrigin = FRONTEND_URL
  try {
    const parsedNext = new URL(requestedNext, FRONTEND_URL)
    if (CUSTOMER_APP_ORIGINS.has(parsedNext.origin)) {
      nextOrigin = parsedNext.toString()
    }
  } catch {
    // requestedNext was empty or not a valid URL — fall back to default
  }

  // CSRF protection: a random nonce that we also stash in an httpOnly
  // cookie, then check on the callback (see callback/route.js). Google
  // echoes the `state` param back verbatim, so this is the standard way
  // to prove the callback request actually followed from this redirect
  // and wasn't forged.
  const state = crypto.randomBytes(24).toString('base64url')

  // GOOGLE_REDIRECT_URI must exactly match one of the "Authorized redirect
  // URIs" configured on the OAuth client in Google Cloud Console —
  // e.g. https://api.splashpass.site/api/auth/google/callback
  const redirectUri = process.env.GOOGLE_REDIRECT_URI || `${requestOrigin}/api/auth/google/callback`

  const authUrl = new URL('https://accounts.google.com/o/oauth2/v2/auth')
  authUrl.searchParams.set('client_id', process.env.GOOGLE_CLIENT_ID)
  authUrl.searchParams.set('redirect_uri', redirectUri)
  authUrl.searchParams.set('response_type', 'code')
  authUrl.searchParams.set('scope', 'openid email profile')
  authUrl.searchParams.set('state', state)
  authUrl.searchParams.set('access_type', 'online')
  authUrl.searchParams.set('prompt', 'select_account')

  const res = NextResponse.redirect(authUrl.toString())

  res.cookies.set('google_oauth_state', state, {
    httpOnly: true,
    secure: true,
    sameSite: 'lax',
    path: '/',
    maxAge: 600, // 10 min — plenty for the round trip to Google and back
  })
  res.cookies.set('google_oauth_next', nextOrigin, {
    httpOnly: true,
    secure: true,
    sameSite: 'lax',
    path: '/',
    maxAge: 600,
  })

  return res
}

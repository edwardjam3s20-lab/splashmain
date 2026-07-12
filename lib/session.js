import { SignJWT, jwtVerify } from 'jose'
import { cookies } from 'next/headers'

// SECURITY: no fallback secret. A hardcoded fallback here means anyone who
// reads this source file (public GitHub repo, a leaked build, this exact
// review) can forge a valid session JWT for ANY email/role if the real env
// var was never set in Vercel — that's a full authentication bypass across
// customer, operator, and admin sessions alike, all sharing this one
// signing key. Failing loudly at first use is far safer than failing open.
function getSecret() {
  const secret = process.env.SESSION_SECRET
  if (!secret || secret.length < 32) {
    throw new Error(
      'SESSION_SECRET is not set (or is shorter than 32 chars). Set a long, ' +
      'random value in the Vercel environment — sessions cannot be signed ' +
      'or verified without it. Generate one with: openssl rand -base64 32'
    )
  }
  return new TextEncoder().encode(secret)
}

const COOKIE_NAME = 'splashpass_session'

export async function createSession(payload) {
  const token = await new SignJWT(payload)
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime('8h')
    .sign(getSecret())
  return token
}

export async function getSession() {
  const cookieStore = cookies()
  const token = cookieStore.get(COOKIE_NAME)?.value
  // No cookie at all is just "signed out" — not an error, nothing to log.
  if (!token) return null

  try {
    const { payload } = await jwtVerify(token, getSecret())
    return payload
  } catch (err) {
    // Previously every failure here — expired token, wrong/rotated signing
    // key, malformed cookie, a missing SESSION_SECRET env var — collapsed
    // into the same silent `null`, with nothing logged anywhere. That's
    // what made the intermittent 401s undiagnosable: a warm serverless
    // instance still holding a pre-rotation SESSION_SECRET would fail
    // jwtVerify() with a signature mismatch, look identical to any other
    // rejection, and leave zero trace in Vercel's logs. err.code (a jose
    // convention — e.g. 'ERR_JWS_SIGNATURE_VERIFICATION_FAILED' vs
    // 'ERR_JWT_EXPIRED') is what actually distinguishes those cases.
    // Logs the failure reason only — never the token itself.
    console.error('[session] getSession() rejected a token:', {
      code: err?.code ?? 'UNKNOWN',
      message: err?.message,
    })
    return null
  }
}

export function setSessionCookie(res, token) {
  res.cookies.set(COOKIE_NAME, token, {
    httpOnly: true,
    // The customer app and splashmain are separate origins (different
    // Vercel deployments) — a 'lax' cookie set here is never sent back on
    // the customer app's subsequent cross-origin fetches to splashmain,
    // so every getSession() call after login would see no cookie at all.
    // 'none' is required for a cookie to survive a cross-site request;
    // browsers mandate 'secure: true' whenever sameSite is 'none' (the
    // cookie is silently dropped otherwise), so that's hardcoded rather
    // than conditional on NODE_ENV the way it was before. This exactly
    // mirrors the operator app's earlier lax->none cookie fix.
    secure: true,
    sameSite: 'none',
    maxAge: 60 * 60 * 8, // 8 hours
    path: '/'
  })
}

export function clearSessionCookie(res) {
  res.cookies.set(COOKIE_NAME, '', {
    maxAge: 0,
    path: '/',
    secure: true,
    sameSite: 'none',
  })
}

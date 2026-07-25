// lib/orgSession.js
// Session handling for organization_users — the SaaS-redesign account type
// (a person), distinct from the customer session (splashpass_session) and
// the legacy operator session (splashpass_operator_session). Uses its own
// cookie so none of the three can be confused for one another, but shares
// the single getSecret() signing key from lib/session.js rather than
// defining its own fallback — see operatorSession.js's comment for why a
// second hardcoded fallback here would reopen the exact bug already fixed
// once (and is still open in a few /api/verify/* files — separate fix).
import { SignJWT, jwtVerify } from 'jose'
import { cookies } from 'next/headers'
import { getSecret } from './session'

const COOKIE_NAME = 'splashpass_org_session'

// Flat expiry, no refresh-token rotation — mirrors the operator session's
// approach (simplest thing that works for a logged-into-an-app-all-day
// account) rather than the customer flow's rotating-refresh-token system.
// Revisit if org owners report being logged out mid-shift.
const SESSION_TTL = '12h'
const SESSION_MAXAGE = 60 * 60 * 12
const PENDING_TTL = '15m' // matches the OTP code's 10-minute window plus buffer

export async function createOrgSession(payload) {
  const ttl = payload.pending ? PENDING_TTL : SESSION_TTL
  return new SignJWT({ role: 'org_user', ...payload })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(ttl)
    .sign(getSecret())
}

export async function getOrgSession() {
  try {
    const token = cookies().get(COOKIE_NAME)?.value
    if (!token) return null
    const { payload } = await jwtVerify(token, getSecret())
    if (payload.role !== 'org_user') return null
    return payload
  } catch {
    return null
  }
}

// Verifies a pendingToken passed explicitly in a request body — the OTP
// verification endpoints receive it this way, not via cookie, same as the
// customer flow's pendingToken pattern.
export async function verifyOrgToken(token) {
  try {
    const { payload } = await jwtVerify(token, getSecret())
    if (payload.role !== 'org_user') return null
    return payload
  } catch {
    return null
  }
}

// SameSite='none': the operator React app (soon to host the org SaaS UI)
// is on a different domain than this backend — see operatorSession.js's
// identical comment for why 'lax' would silently 401 every request.
export function setOrgSessionCookie(res, token) {
  res.cookies.set(COOKIE_NAME, token, {
    httpOnly: true,
    secure: true,
    sameSite: 'none',
    maxAge: SESSION_MAXAGE,
    path: '/',
  })
}

export function clearOrgSessionCookie(res) {
  res.cookies.set(COOKIE_NAME, '', {
    httpOnly: true,
    secure: true,
    sameSite: 'none',
    maxAge: 0,
    path: '/',
  })
}

export function publicOrgUser(user) {
  if (!user) return null
  return {
    id: user.id,
    email: user.email,
    phone: user.phone ?? null,
    full_name: user.full_name,
    email_verified: Boolean(user.email_verified_at),
    phone_verified: Boolean(user.phone_verified_at),
  }
}

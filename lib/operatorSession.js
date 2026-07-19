import { SignJWT, jwtVerify } from 'jose'
import { cookies } from 'next/headers'
// SECURITY: no fallback secret here -- see lib/session.js's getSecret() for
// why. This file used to sign its own fallback ('fallback_secret_32_chars_
// minimum!!'), independently of the fix applied to lib/session.js and the
// tfa routes. That meant operator sessions were still forgeable if
// SESSION_SECRET was ever missing at a cold start, even after that fix.
// Importing the single shared getSecret() closes that gap and ensures there
// is exactly one signing key, and exactly one place that fails loudly if
// it's missing, for every session type (customer, admin, operator).
import { getSecret } from './session'

const COOKIE_NAME = 'splashpass_operator_session'

export async function createOperatorSession(payload) {
  return new SignJWT({ role: 'operator', ...payload })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime('12h')
    .sign(getSecret())
}

export async function getOperatorSession() {
  try {
    const token = cookies().get(COOKIE_NAME)?.value
    if (!token) return null
    const { payload } = await jwtVerify(token, getSecret())
    if (payload.role !== 'operator') return null
    return payload
  } catch {
    return null
  }
}

/**
 * SameSite='none' (not 'lax'): the operator React app is deployed on a
 * different domain than this backend, so every API call is cross-origin.
 * 'lax' cookies are not sent on cross-origin fetch requests, which would
 * make every authenticated call silently 401 despite a successful login.
 * 'none' requires secure:true unconditionally — browsers reject 'none'
 * cookies without it, regardless of NODE_ENV.
 */
export function setOperatorSessionCookie(res, token) {
  res.cookies.set(COOKIE_NAME, token, {
    httpOnly: true,
    secure: true,
    sameSite: 'none',
    maxAge: 60 * 60 * 12,
    path: '/',
  })
}

export function clearOperatorSessionCookie(res) {
  res.cookies.set(COOKIE_NAME, '', {
    httpOnly: true,
    secure: true,
    sameSite: 'none',
    maxAge: 0,
    path: '/',
  })
}

export function publicOperator(op) {
  if (!op) return null
  return {
    id: op.id,
    name: op.name,
    email: op.email,
    wash_point: op.wash_point,
    wash_point_id: op.wash_point_id ?? null,
    status: op.status || 'open',
    commission_tier: op.commission_tier != null ? Number(op.commission_tier) : 1,
  }
}

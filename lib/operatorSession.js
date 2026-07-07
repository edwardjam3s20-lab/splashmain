import { SignJWT, jwtVerify } from 'jose'
import { cookies } from 'next/headers'

// No fallback secret. A hardcoded default here would mean any deploy that
// forgets to set SESSION_SECRET (wrong Vercel env target, missing var,
// typo) silently starts signing every operator session with a value
// that's sitting in plaintext in this file — anyone who's ever seen this
// source could forge a session for any operator by email. Failing loudly
// at boot is strictly better than failing open at runtime.
if (!process.env.SESSION_SECRET) {
  throw new Error(
    'SESSION_SECRET is not set. Refusing to start with an insecure default — set SESSION_SECRET in this environment\'s variables before deploying.'
  )
}
const SECRET = new TextEncoder().encode(process.env.SESSION_SECRET)
const COOKIE_NAME = 'splashpass_operator_session'

export async function createOperatorSession(payload) {
  return new SignJWT({ role: 'operator', ...payload })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime('12h')
    .sign(SECRET)
}

export async function getOperatorSession() {
  try {
    const token = cookies().get(COOKIE_NAME)?.value
    if (!token) return null
    const { payload } = await jwtVerify(token, SECRET)
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

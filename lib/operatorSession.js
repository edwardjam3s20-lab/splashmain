import { SignJWT, jwtVerify } from 'jose'
import { cookies } from 'next/headers'

const SECRET = new TextEncoder().encode(
  process.env.SESSION_SECRET || 'fallback_secret_32_chars_minimum!!'
)
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

export function setOperatorSessionCookie(res, token) {
  res.cookies.set(COOKIE_NAME, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: 60 * 60 * 12,
    path: '/',
  })
}

export function clearOperatorSessionCookie(res) {
  res.cookies.set(COOKIE_NAME, '', { maxAge: 0, path: '/' })
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
  }
}

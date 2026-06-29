import { SignJWT, jwtVerify } from 'jose'
import { cookies } from 'next/headers'

const SECRET = new TextEncoder().encode(
  process.env.SESSION_SECRET || 'fallback_secret_32_chars_minimum!!'
)
const COOKIE_NAME = 'splashpass_session'

export async function createSession(payload) {
  const token = await new SignJWT(payload)
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime('8h')
    .sign(SECRET)
  return token
}

export async function getSession() {
  try {
    const cookieStore = cookies()
    const token = cookieStore.get(COOKIE_NAME)?.value
    if (!token) return null
    const { payload } = await jwtVerify(token, SECRET)
    return payload
  } catch {
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

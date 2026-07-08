import { jwtVerify } from 'jose'

export const ADMIN_COOKIE = 'splashpass_session'
export const OPERATOR_COOKIE = 'splashpass_operator_session'

// SECURITY: no fallback secret -- see the matching comment in lib/session.js.
// A hardcoded fallback here would let anyone forge a valid admin or
// operator session if SESSION_SECRET was never set in the environment.
function getSecretKey() {
  const secret = process.env.SESSION_SECRET
  if (!secret || secret.length < 32) {
    throw new Error(
      'SESSION_SECRET is not set (or is shorter than 32 chars). Sessions ' +
      'cannot be verified without it.'
    )
  }
  return new TextEncoder().encode(secret)
}

/**
 * @param {import('next/server').NextRequest} request
 */
export async function verifyAdminSession(request) {
  const token = request.cookies.get(ADMIN_COOKIE)?.value
  if (!token) return null
  try {
    const { payload } = await jwtVerify(token, getSecretKey())
    return payload
  } catch {
    return null
  }
}

/**
 * @param {import('next/server').NextRequest} request
 */
export async function verifyOperatorSession(request) {
  const token = request.cookies.get(OPERATOR_COOKIE)?.value
  if (!token) return null
  try {
    const { payload } = await jwtVerify(token, getSecretKey())
    if (payload.role !== 'operator') return null
    return payload
  } catch {
    return null
  }
}

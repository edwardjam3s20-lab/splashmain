import { jwtVerify } from 'jose'
import { getSessionSecretKey as getSecretKey } from '@/lib/sessionSecret'

export const ADMIN_COOKIE = 'splashpass_session'
export const OPERATOR_COOKIE = 'splashpass_operator_session'

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

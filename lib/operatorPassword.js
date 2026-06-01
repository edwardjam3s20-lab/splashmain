import { createHash } from 'crypto'

export function hashOperatorPassword(password) {
  const secret = process.env.SESSION_SECRET || ''
  return createHash('sha256').update(password + secret).digest('hex')
}

export function verifyOperatorPassword(password, storedHash) {
  if (!storedHash || !password) return false
  const hashed = hashOperatorPassword(password)
  // New operators: SHA-256 hash; legacy rows may still be plaintext
  if (storedHash === hashed) return true
  if (storedHash.length < 64 && storedHash === password) return true
  return false
}

import bcrypt from 'bcryptjs'
import { createHash } from 'crypto'

const SALT_ROUNDS = 10

/**
 * Hash a plain text password with bcrypt.
 * Called when admin sets/resets a password, or on first-login upgrade.
 */
export function hashOperatorPassword(password) {
  const plain = String(password).trim()
  return bcrypt.hashSync(plain, SALT_ROUNDS)
}

/**
 * Verify a plain text password against a stored hash.
 * Supports:
 *   1. bcrypt hashes  — new standard (starts with $2a$ / $2b$)
 *   2. SHA-256 hashes — legacy, auto-upgraded to bcrypt on next login
 *   3. Plain text     — very old records, also auto-upgraded on next login
 */
export function verifyOperatorPassword(password, storedHash) {
  if (!storedHash || password == null) return false

  const plain = String(password).trim()
  const stored = String(storedHash).trim()
  if (!plain || !stored) return false

  // bcrypt — primary path
  if (stored.startsWith('$2')) {
    return bcrypt.compareSync(plain, stored)
  }

  // Legacy SHA-256 with SESSION_SECRET
  const secret = process.env.SESSION_SECRET || 'fallback_secret_32_chars_minimum!!'
  const legacyHash = createHash('sha256')
    .update(plain + secret)
    .digest('hex')
  if (stored.toLowerCase() === legacyHash.toLowerCase()) return true

  // Legacy SHA-256 without secret
  const legacyNoSecret = createHash('sha256').update(plain).digest('hex')
  if (stored.toLowerCase() === legacyNoSecret.toLowerCase()) return true

  // Plain text fallback (very old records)
  if (stored.length < 64 && stored === plain) return true

  return false
}

/**
 * Returns true if the stored value is NOT a bcrypt hash.
 * The login route uses this to trigger an on-the-fly upgrade to bcrypt.
 */
export function isPlaintextPassword(storedHash) {
  if (!storedHash) return false
  // bcrypt hashes always start with $2 — everything else needs upgrading
  return !String(storedHash).trim().startsWith('$2')
}

// lib/orgPassword.js
// Password hashing for organization_users. Brand-new table — unlike
// lib/operatorPassword.js there's no legacy plaintext/SHA-256 data to
// support, so this is deliberately bcrypt-only with no fallback
// verification paths (and critically, no SESSION_SECRET-keyed legacy hash
// — that's the exact pattern that left a hardcoded fallback secret string
// inside operatorPassword.js).
import bcrypt from 'bcryptjs'

const SALT_ROUNDS = 10

export function hashOrgPassword(password) {
  return bcrypt.hashSync(String(password).trim(), SALT_ROUNDS)
}

export function verifyOrgPassword(password, storedHash) {
  if (!storedHash || password == null) return false
  const plain = String(password).trim()
  const stored = String(storedHash).trim()
  if (!plain || !stored) return false
  return bcrypt.compareSync(plain, stored)
}

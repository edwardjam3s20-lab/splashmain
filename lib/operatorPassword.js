import { createHash, hash as cryptoHash } from 'crypto'
import { getSessionSecret, LEGACY_DEV_SECRET } from '@/lib/sessionSecret'

export { getSessionSecret }

export function hashOperatorPassword(password) {
  const plain = String(password).trim()
  return createHash('sha256').update(plain + getSessionSecret()).digest('hex')
}

function hashWithSecret(password, secret) {
  return createHash('sha256').update(String(password).trim() + secret).digest('hex')
}

/** @returns {string[]} */
function legacyHashCandidates(password) {
  const plain = String(password).trim()
  const secrets = [...new Set([
    getSessionSecret(),
    LEGACY_DEV_SECRET,
    '',
    process.env.SESSION_SECRET || '',
  ].filter((s) => s !== undefined))]
  const candidates = []

  for (const secret of secrets) {
    candidates.push(hashWithSecret(plain, secret))

    const input = plain + secret
    try {
      const hex = cryptoHash('sha256', input, 'hex')
      if (typeof hex === 'string') candidates.push(hex)
    } catch {
      /* ignore */
    }
    try {
      const raw = cryptoHash('sha256', input)
      if (raw instanceof ArrayBuffer) {
        candidates.push(Buffer.from(raw).toString('hex'))
      } else if (Buffer.isBuffer(raw)) {
        candidates.push(raw.toString('hex'))
      }
    } catch {
      /* ignore */
    }
  }

  candidates.push(createHash('sha256').update(plain).digest('hex'))
  return [...new Set(candidates)]
}

export function verifyOperatorPassword(password, storedHash) {
  if (!storedHash || password == null) return false

  const plain = String(password).trim()
  const stored = String(storedHash).trim()
  if (!plain || !stored) return false

  const primary = hashOperatorPassword(plain)
  if (stored.toLowerCase() === primary.toLowerCase()) return true

  for (const legacy of legacyHashCandidates(plain)) {
    if (stored.toLowerCase() === legacy.toLowerCase()) return true
  }

  if (stored.length < 64 && stored === plain) return true

  return false
}

export function isPlaintextPassword(storedHash) {
  if (!storedHash) return false
  const stored = String(storedHash).trim()
  return stored.length > 0 && stored.length < 64
}

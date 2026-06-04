/**
 * Single source of truth for the JWT / password-hashing secret.
 *
 * Production MUST provide a strong SESSION_SECRET (>= 32 chars); we fail closed
 * rather than silently signing sessions with a publicly known value. Outside
 * production we fall back to a dev-only default so local dev and `next build`
 * keep working without configuration.
 */

/**
 * Dev-only fallback. NEVER used in production. Exported so legacy operator
 * password hashes that were created with it can still be verified.
 */
export const LEGACY_DEV_SECRET = 'fallback_secret_32_chars_minimum!!'

const MIN_LENGTH = 32

export function getSessionSecret() {
  const secret = process.env.SESSION_SECRET

  if (process.env.NODE_ENV === 'production') {
    if (!secret || secret.length < MIN_LENGTH) {
      throw new Error(
        `SESSION_SECRET must be set to at least ${MIN_LENGTH} characters in production.`
      )
    }
    return secret
  }

  return secret && secret.length > 0 ? secret : LEGACY_DEV_SECRET
}

export function getSessionSecretKey() {
  return new TextEncoder().encode(getSessionSecret())
}

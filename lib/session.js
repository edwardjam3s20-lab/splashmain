import { SignJWT, jwtVerify } from 'jose'
import { cookies } from 'next/headers'
import { randomBytes, randomUUID, createHash } from 'crypto'
import { getSupabaseAdmin } from './supabase'

// SECURITY: no fallback secret. A hardcoded fallback here means anyone who
// reads this source file (public GitHub repo, a leaked build, this exact
// review) can forge a valid session JWT for ANY email/role if the real env
// var was never set in Vercel — that's a full authentication bypass across
// customer, operator, and admin sessions alike, all sharing this one
// signing key. Failing loudly at first use is far safer than failing open.
export function getSecret() {
  const secret = process.env.SESSION_SECRET
  if (!secret || secret.length < 32) {
    throw new Error(
      'SESSION_SECRET is not set (or is shorter than 32 chars). Set a long, ' +
      'random value in the Vercel environment — sessions cannot be signed ' +
      'or verified without it. Generate one with: openssl rand -base64 32'
    )
  }
  return new TextEncoder().encode(secret)
}

const COOKIE_NAME = 'splashpass_session'
const REFRESH_COOKIE_NAME = 'splashpass_refresh'

// Short-lived on purpose — see rotateRefreshToken() below for why this is
// safe to keep short without hurting UX: the client refreshes silently
// before this ever expires under normal use.
const ACCESS_TOKEN_TTL = '15m'
const ACCESS_TOKEN_MAXAGE = 60 * 15

const REFRESH_TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000 // 30 days
const REFRESH_TOKEN_MAXAGE = 60 * 60 * 24 * 30

// ─── Access token (JWT) ─────────────────────────────────────────────────────
// Unchanged in shape from before — every existing route that calls
// getSession() keeps working exactly as it did. Only the expiry changed.

export async function createSession(payload) {
  const token = await new SignJWT(payload)
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(ACCESS_TOKEN_TTL)
    .sign(getSecret())
  return token
}

export async function getSession() {
  const cookieStore = cookies()
  const token = cookieStore.get(COOKIE_NAME)?.value
  if (!token) return null

  try {
    const { payload } = await jwtVerify(token, getSecret())
    return payload
  } catch (err) {
    // err.code (jose convention, e.g. 'ERR_JWT_EXPIRED' vs
    // 'ERR_JWS_SIGNATURE_VERIFICATION_FAILED') is what actually
    // distinguishes "just expired, client should refresh" from "something
    // is actually wrong" — logged, never the token itself.
    console.error('[session] getSession() rejected a token:', {
      code: err?.code ?? 'UNKNOWN',
      message: err?.message,
    })
    return null
  }
}

export function setSessionCookie(res, token) {
  res.cookies.set(COOKIE_NAME, token, {
    httpOnly: true,
    secure: true,
    sameSite: 'none', // cross-origin (splashpass-react <-> splashmain), required for the cookie to survive
    maxAge: ACCESS_TOKEN_MAXAGE,
    path: '/',
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

// ─── Refresh token (opaque, DB-backed, rotated on every use) ───────────────
// Deliberately NOT a JWT — a JWT refresh token can't be revoked without a
// server-side blocklist anyway, so there's no benefit over a plain random
// token checked against a table we control. Only the SHA-256 hash is ever
// stored; the plaintext token only ever exists in the cookie and in transit.

function hashToken(token) {
  return createHash('sha256').update(token).digest('hex')
}

function generateOpaqueToken() {
  return randomBytes(32).toString('hex')
}

// Scoped to /api/auth — this is a long-lived, powerful credential, so it
// has no reason to be attached to requests outside the auth routes that
// actually consume it (login doesn't need it, profile reads don't need it).
export function setRefreshCookie(res, token) {
  res.cookies.set(REFRESH_COOKIE_NAME, token, {
    httpOnly: true,
    secure: true,
    sameSite: 'none',
    maxAge: REFRESH_TOKEN_MAXAGE,
    path: '/api/auth',
  })
}

export function clearRefreshCookie(res) {
  res.cookies.set(REFRESH_COOKIE_NAME, '', {
    maxAge: 0,
    path: '/api/auth',
    secure: true,
    sameSite: 'none',
  })
}

export function getRefreshCookieValue() {
  const cookieStore = cookies()
  return cookieStore.get(REFRESH_COOKIE_NAME)?.value ?? null
}

// Issues a brand-new rotation chain ("family"). Called once, at real login —
// never at the pending/unverified stage, since an account that isn't fully
// verified yet shouldn't get a 30-day standing credential.
export async function issueRefreshToken(customerEmail) {
  const supabase = getSupabaseAdmin()
  const plain = generateOpaqueToken()
  const familyId = randomUUID()
  const expiresAt = new Date(Date.now() + REFRESH_TOKEN_TTL_MS).toISOString()

  const { error } = await supabase.from('customer_refresh_tokens').insert({
    customer_email: customerEmail,
    token_hash: hashToken(plain),
    family_id: familyId,
    expires_at: expiresAt,
  })

  if (error) {
    throw new Error('Failed to persist refresh token: ' + error.message)
  }

  return plain
}

// The core of the whole lifecycle. Verifies the presented refresh token,
// and — if valid — atomically rotates it: the presented token is marked
// revoked and a brand new one is issued in the same family. Returns one of:
//   { status: 'ok', email, newToken }
//   { status: 'expired' }          — refresh token's own TTL passed
//   { status: 'invalid' }          — no matching row at all
//   { status: 'reuse_detected' }   — this exact token was already rotated
//                                    away once before (see comment below)
export async function rotateRefreshToken(presentedToken) {
  const supabase = getSupabaseAdmin()
  const presentedHash = hashToken(presentedToken)

  const { data: row, error } = await supabase
    .from('customer_refresh_tokens')
    .select('*')
    .eq('token_hash', presentedHash)
    .maybeSingle()

  if (error || !row) {
    return { status: 'invalid' }
  }

  if (row.revoked_at) {
    // REUSE DETECTED: a token that was already exchanged for a newer one is
    // being presented again. Under normal use this can never happen — the
    // client always holds the newest token in the family. The only ways to
    // get here are a stolen copy of an old token being replayed, or a race
    // between two requests firing at once. Either way, the safe move is to
    // kill the ENTIRE family, including whatever token is currently "live" —
    // that forces a real login and closes the window rather than trusting a
    // chain that's already been shown to be double-used.
    await supabase
      .from('customer_refresh_tokens')
      .update({ revoked_at: new Date().toISOString() })
      .eq('family_id', row.family_id)
      .is('revoked_at', null)
    return { status: 'reuse_detected' }
  }

  if (new Date(row.expires_at) < new Date()) {
    return { status: 'expired' }
  }

  const newPlain = generateOpaqueToken()
  const newExpiresAt = new Date(Date.now() + REFRESH_TOKEN_TTL_MS).toISOString()

  const { error: revokeErr } = await supabase
    .from('customer_refresh_tokens')
    .update({ revoked_at: new Date().toISOString() })
    .eq('id', row.id)

  if (revokeErr) return { status: 'invalid' }

  const { error: insertErr } = await supabase.from('customer_refresh_tokens').insert({
    customer_email: row.customer_email,
    token_hash: hashToken(newPlain),
    family_id: row.family_id,
    expires_at: newExpiresAt,
  })

  if (insertErr) return { status: 'invalid' }

  return { status: 'ok', email: row.customer_email, newToken: newPlain }
}

// Full logout — kills every token for this user, not just the one in the
// current cookie, so "log out" also ends any other device's session chain.
export async function revokeAllRefreshTokensForEmail(email) {
  const supabase = getSupabaseAdmin()
  await supabase
    .from('customer_refresh_tokens')
    .update({ revoked_at: new Date().toISOString() })
    .eq('customer_email', email)
    .is('revoked_at', null)
}

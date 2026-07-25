// app/api/org/auth/login/route.js
// POST — organization_users login. Body: { email, password }

import { NextResponse } from 'next/server'
import { checkRateLimit, resetRateLimit } from '@/lib/rateLimit'
import { getSupabaseAdmin } from '@/lib/supabase'
import { verifyOrgPassword } from '@/lib/orgPassword'
import { createOrgSession, setOrgSessionCookie, publicOrgUser } from '@/lib/orgSession'
import { orgCorsHeaders } from '@/lib/orgCors'

export async function OPTIONS(request) {
  const origin = request.headers.get('origin') || ''
  return new NextResponse(null, { status: 200, headers: orgCorsHeaders(origin) })
}

export async function POST(request) {
  const origin = request.headers.get('origin') || ''

  const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown'
  const limit = checkRateLimit(`org-login:${ip}`)
  if (!limit.allowed) {
    return NextResponse.json(
      { error: `Too many attempts. Try again in ${limit.retryAfter}s.` },
      { status: 429, headers: orgCorsHeaders(origin) }
    )
  }

  const { email, password } = await request.json()
  const cleanEmail = String(email || '').toLowerCase().trim()
  const cleanPassword = String(password || '').trim()

  if (!cleanEmail || !cleanPassword) {
    return NextResponse.json(
      { error: 'Email and password required.' },
      { status: 400, headers: orgCorsHeaders(origin) }
    )
  }

  const supabase = getSupabaseAdmin()
  const { data: user, error } = await supabase
    .from('organization_users')
    .select('*')
    .eq('email', cleanEmail)
    .maybeSingle()

  if (error) {
    console.error('[org login] load error:', error.message)
    return NextResponse.json(
      { error: 'Could not sign in. Try again.' },
      { status: 500, headers: orgCorsHeaders(origin) }
    )
  }

  // Same message whether the account doesn't exist or the password is
  // wrong — distinguishing the two lets an attacker enumerate registered
  // business-owner emails.
  if (!user || !verifyOrgPassword(cleanPassword, user.password)) {
    return NextResponse.json(
      { error: 'Incorrect email or password.' },
      { status: 401, headers: orgCorsHeaders(origin) }
    )
  }

  if (!user.email_verified_at) {
    const pendingToken = await createOrgSession({ userId: user.id, email: user.email, pending: true })
    return NextResponse.json(
      { error: 'Please verify your email to continue.', code: 'EMAIL_UNVERIFIED', pendingToken },
      { status: 403, headers: orgCorsHeaders(origin) }
    )
  }

  resetRateLimit(`org-login:${ip}`)

  const token = await createOrgSession({ userId: user.id, email: user.email })
  const res = NextResponse.json(
    { user: publicOrgUser(user) },
    { headers: orgCorsHeaders(origin) }
  )
  setOrgSessionCookie(res, token)
  return res
}

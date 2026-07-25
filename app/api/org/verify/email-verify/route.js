// app/api/org/verify/email-verify/route.js
// POST — confirm 6-digit email OTP, mark email_verified_at, issue a full
// (non-pending) org_user session. Phone verification is deferred, same as
// the customer flow — the caller can proceed straight to Step 2 (business
// details) after this.
// Body: { email, pendingToken, code }

import { NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabase'
import {
  createOrgSession,
  setOrgSessionCookie,
  verifyOrgToken,
  publicOrgUser,
} from '@/lib/orgSession'
import { orgCorsHeaders } from '@/lib/orgCors'

export async function OPTIONS(request) {
  const origin = request.headers.get('origin') || ''
  return new NextResponse(null, { status: 200, headers: orgCorsHeaders(origin) })
}

export async function POST(request) {
  const origin = request.headers.get('origin') || ''

  const { email, pendingToken, code } = await request.json()
  if (!email || !pendingToken || !code) {
    return NextResponse.json(
      { error: 'Missing required fields.' },
      { status: 400, headers: orgCorsHeaders(origin) }
    )
  }

  const cleanEmail = String(email).toLowerCase().trim()
  const payload = await verifyOrgToken(pendingToken)
  if (!payload || payload.email !== cleanEmail) {
    return NextResponse.json(
      { error: 'Invalid session. Please log in again.' },
      { status: 401, headers: orgCorsHeaders(origin) }
    )
  }

  const supabase = getSupabaseAdmin()
  const { data: row } = await supabase
    .from('organization_user_verification')
    .select('email_code, email_code_expires_at')
    .eq('email', cleanEmail)
    .maybeSingle()

  if (!row?.email_code) {
    return NextResponse.json(
      { error: 'No code found. Please request a new one.' },
      { status: 400, headers: orgCorsHeaders(origin) }
    )
  }
  if (new Date() > new Date(row.email_code_expires_at)) {
    return NextResponse.json(
      { error: 'Code expired. Please request a new one.' },
      { status: 400, headers: orgCorsHeaders(origin) }
    )
  }
  if (String(code).trim() !== row.email_code) {
    return NextResponse.json(
      { error: 'Incorrect code. Please try again.' },
      { status: 400, headers: orgCorsHeaders(origin) }
    )
  }

  const [, updateResult] = await Promise.all([
    supabase
      .from('organization_user_verification')
      .update({ email_code: null, email_code_expires_at: null })
      .eq('email', cleanEmail),
    supabase
      .from('organization_users')
      .update({ email_verified_at: new Date().toISOString() })
      .eq('email', cleanEmail)
      .select()
      .single(),
  ])

  const user = updateResult.data
  const token = await createOrgSession({ userId: user.id, email: user.email })

  const res = NextResponse.json(
    { ok: true, user: publicOrgUser(user) },
    { headers: orgCorsHeaders(origin) }
  )
  setOrgSessionCookie(res, token)
  return res
}

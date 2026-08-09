// app/api/org/auth/change-password/route.js
// POST — change the logged-in organization_users account's password.
// Body: { currentPassword, newPassword }
//
// Account-level, not organization-scoped -- uses requireOrgUser (just "am
// I logged in") rather than requireOrgMember/requireWashpointMember, same
// reasoning as the legacy operator/auth/change-password route this
// mirrors.

import { NextResponse } from 'next/server'
import { checkRateLimit } from '@/lib/rateLimit'
import { requireOrgUser } from '@/lib/requireOrgUser'
import { verifyOrgPassword, hashOrgPassword } from '@/lib/orgPassword'
import { getSupabaseAdmin } from '@/lib/supabase'
import { orgCorsHeaders } from '@/lib/orgCors'

export async function OPTIONS(request) {
  const origin = request.headers.get('origin') || ''
  return new NextResponse(null, { status: 200, headers: orgCorsHeaders(origin) })
}

export async function POST(request) {
  const origin = request.headers.get('origin') || ''

  const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown'
  const limit = checkRateLimit(`org-pw:${ip}`)
  if (!limit.allowed) {
    return NextResponse.json(
      { error: `Too many attempts. Try again in ${limit.retryAfter}s.` },
      { status: 429, headers: orgCorsHeaders(origin) }
    )
  }

  const auth = await requireOrgUser()
  if (auth.error) {
    return NextResponse.json({ error: auth.error }, { status: auth.status, headers: orgCorsHeaders(origin) })
  }

  const { currentPassword, newPassword } = await request.json().catch(() => ({}))
  const current = String(currentPassword || '').trim()
  const next = String(newPassword || '').trim()

  if (!current || !next) {
    return NextResponse.json({ error: 'Current and new password are required.' }, { status: 400, headers: orgCorsHeaders(origin) })
  }
  if (next.length < 6) {
    return NextResponse.json({ error: 'New password must be at least 6 characters.' }, { status: 400, headers: orgCorsHeaders(origin) })
  }
  if (current === next) {
    return NextResponse.json({ error: 'Choose a different password than your current one.' }, { status: 400, headers: orgCorsHeaders(origin) })
  }

  const supabase = getSupabaseAdmin()

  // requireOrgUser()'s own select deliberately excludes `password` (never
  // leak the hash through a shared "who am I" helper) -- fetch it fresh
  // here, scoped to the already-authenticated user's own id only.
  const { data: row, error: loadError } = await supabase
    .from('organization_users')
    .select('password')
    .eq('id', auth.user.id)
    .maybeSingle()

  if (loadError || !row) {
    console.error('[org change-password] load error:', loadError?.message)
    return NextResponse.json({ error: 'Could not verify your account.' }, { status: 500, headers: orgCorsHeaders(origin) })
  }

  if (!verifyOrgPassword(current, row.password)) {
    return NextResponse.json({ error: 'Current password is incorrect.' }, { status: 401, headers: orgCorsHeaders(origin) })
  }

  const { error } = await supabase
    .from('organization_users')
    .update({ password: hashOrgPassword(next) })
    .eq('id', auth.user.id)

  if (error) {
    console.error('[org change-password] update error:', error.message)
    return NextResponse.json({ error: 'Could not update password.' }, { status: 500, headers: orgCorsHeaders(origin) })
  }

  return NextResponse.json({ success: true }, { headers: orgCorsHeaders(origin) })
}

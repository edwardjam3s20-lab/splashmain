// app/api/org/auth/me/route.js
// GET — the authenticated org_user's profile plus every organization they
// belong to (with role and verification status). The frontend uses this
// to decide where onboarding resumes:
//   no memberships                                -> Step 2 (create business)
//   membership + verification_status not verified  -> resume verification / show status
//   membership + verification_status = verified     -> dashboard

import { NextResponse } from 'next/server'
import { requireOrgUser } from '@/lib/requireOrgUser'
import { publicOrgUser } from '@/lib/orgSession'
import { getSupabaseAdmin } from '@/lib/supabase'
import { orgCorsHeaders } from '@/lib/orgCors'

export async function OPTIONS(request) {
  const origin = request.headers.get('origin') || ''
  return new NextResponse(null, { status: 200, headers: orgCorsHeaders(origin) })
}

export async function GET(request) {
  const origin = request.headers.get('origin') || ''

  const auth = await requireOrgUser()
  if (auth.error) {
    return NextResponse.json(
      { error: auth.error },
      { status: auth.status, headers: orgCorsHeaders(origin) }
    )
  }

  const supabase = getSupabaseAdmin()
  const { data: memberships, error } = await supabase
    .from('organization_members')
    .select('role, status, organization:organizations(id, name, verification_status, suspended_at)')
    .eq('user_id', auth.user.id)
    .is('removed_at', null)

  if (error) {
    console.error('[org me] membership load error:', error.message)
    return NextResponse.json(
      { error: 'Could not load organizations.' },
      { status: 500, headers: orgCorsHeaders(origin) }
    )
  }

  return NextResponse.json(
    { user: publicOrgUser(auth.user), organizations: memberships || [] },
    { headers: orgCorsHeaders(origin) }
  )
}

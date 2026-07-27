// app/api/org/invitations/[id]/route.js
// POST (action=revoke) — cancel a pending invitation. Owner can revoke
// anything in the org; manager can only revoke ones they personally sent.

import { NextResponse } from 'next/server'
import { requireOrgMember } from '@/lib/requireOrgMember'
import { getSupabaseAdmin } from '@/lib/supabase'
import { orgCorsHeaders } from '@/lib/orgCors'

export async function OPTIONS(request) {
  const origin = request.headers.get('origin') || ''
  return new NextResponse(null, { status: 200, headers: orgCorsHeaders(origin) })
}

export async function POST(request, { params }) {
  const origin = request.headers.get('origin') || ''
  const { id: invitationId } = params
  const body = await request.json().catch(() => ({}))
  const { organization_id: organizationId, action } = body || {}

  if (action !== 'revoke') {
    return NextResponse.json({ error: 'Unknown action.' }, { status: 400, headers: orgCorsHeaders(origin) })
  }

  const auth = await requireOrgMember(organizationId, ['owner', 'manager'])
  if (auth.error) {
    return NextResponse.json({ error: auth.error }, { status: auth.status, headers: orgCorsHeaders(origin) })
  }

  const supabase = getSupabaseAdmin()
  const { data: invitation, error: fetchError } = await supabase
    .from('invitations')
    .select('*')
    .eq('id', invitationId)
    .eq('organization_id', organizationId)
    .maybeSingle()

  if (fetchError) return NextResponse.json({ error: 'Could not load invitation.' }, { status: 500, headers: orgCorsHeaders(origin) })
  if (!invitation) return NextResponse.json({ error: 'Invitation not found.' }, { status: 404, headers: orgCorsHeaders(origin) })

  if (auth.member.role === 'manager' && invitation.invited_by !== auth.user.id) {
    return NextResponse.json({ error: 'You can only revoke invitations you sent.' }, { status: 403, headers: orgCorsHeaders(origin) })
  }
  if (invitation.status !== 'pending') {
    return NextResponse.json({ error: `Cannot revoke an invitation that is already ${invitation.status}.` }, { status: 409, headers: orgCorsHeaders(origin) })
  }

  const { data: updated, error: updateError } = await supabase
    .from('invitations')
    .update({ status: 'revoked', revoked_at: new Date().toISOString() })
    .eq('id', invitationId)
    .select('id, email, phone, role, washpoint_ids, status, created_at, expires_at, accepted_at, revoked_at')
    .single()

  if (updateError) {
    console.error('[org invitations revoke] error:', updateError.message)
    return NextResponse.json({ error: 'Could not revoke invitation.' }, { status: 500, headers: orgCorsHeaders(origin) })
  }

  await supabase.from('audit_logs').insert({
    organization_id: organizationId,
    actor_user_id: auth.user.id,
    actor_type: 'organization_user',
    action: 'invitation.revoked',
    target_type: 'invitation',
    target_id: invitationId,
    metadata: { email: invitation.email },
  })

  return NextResponse.json({ ok: true, invitation: updated }, { headers: orgCorsHeaders(origin) })
}

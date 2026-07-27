// app/api/org/invitations/accept/route.js
// POST — accept a pending invitation. Requires an authenticated (email-
// verified) organization_users session -- the person either just
// registered+verified, or logged into an existing account, before hitting
// this. Body: { token }
//
// Enforces that the invitation's email matches the logged-in account's
// email -- without this, a leaked invite link could be redeemed by anyone
// with any account, not just the person it was actually sent to.

import { NextResponse } from 'next/server'
import { createHash } from 'crypto'
import { requireOrgUser } from '@/lib/requireOrgUser'
import { getSupabaseAdmin } from '@/lib/supabase'
import { orgCorsHeaders } from '@/lib/orgCors'

function hashToken(token) {
  return createHash('sha256').update(token).digest('hex')
}

export async function OPTIONS(request) {
  const origin = request.headers.get('origin') || ''
  return new NextResponse(null, { status: 200, headers: orgCorsHeaders(origin) })
}

export async function POST(request) {
  const origin = request.headers.get('origin') || ''

  const auth = await requireOrgUser()
  if (auth.error) {
    return NextResponse.json({ error: auth.error }, { status: auth.status, headers: orgCorsHeaders(origin) })
  }

  const { token } = await request.json().catch(() => ({}))
  if (!token) {
    return NextResponse.json({ error: 'Invitation token required.' }, { status: 400, headers: orgCorsHeaders(origin) })
  }

  const supabase = getSupabaseAdmin()
  const { data: invitation, error: fetchError } = await supabase
    .from('invitations')
    .select('*')
    .eq('token_hash', hashToken(token))
    .maybeSingle()

  if (fetchError) return NextResponse.json({ error: 'Could not load invitation.' }, { status: 500, headers: orgCorsHeaders(origin) })
  if (!invitation) return NextResponse.json({ error: 'This invitation link is invalid.' }, { status: 404, headers: orgCorsHeaders(origin) })
  if (invitation.status !== 'pending') {
    return NextResponse.json({ error: `This invitation has already been ${invitation.status}.` }, { status: 409, headers: orgCorsHeaders(origin) })
  }
  if (new Date() > new Date(invitation.expires_at)) {
    return NextResponse.json({ error: 'This invitation has expired. Ask for a new one.' }, { status: 409, headers: orgCorsHeaders(origin) })
  }
  if (invitation.email.toLowerCase() !== auth.user.email.toLowerCase()) {
    return NextResponse.json(
      { error: `This invitation was sent to ${invitation.email}. Sign in with that email to accept it.` },
      { status: 403, headers: orgCorsHeaders(origin) }
    )
  }

  // Already an active member (e.g. double-accept, or invited twice)?
  const { data: existingMembership } = await supabase
    .from('organization_members')
    .select('id')
    .eq('organization_id', invitation.organization_id)
    .eq('user_id', auth.user.id)
    .is('removed_at', null)
    .maybeSingle()

  if (existingMembership) {
    await supabase.from('invitations').update({
      status: 'accepted', accepted_by: auth.user.id, accepted_at: new Date().toISOString(),
    }).eq('id', invitation.id)
    return NextResponse.json({ error: 'You are already a member of this organization.' }, { status: 409, headers: orgCorsHeaders(origin) })
  }

  const { data: member, error: memberError } = await supabase
    .from('organization_members')
    .insert({
      organization_id: invitation.organization_id,
      user_id: auth.user.id,
      role: invitation.role,
      status: 'active',
      invited_by: invitation.invited_by,
    })
    .select()
    .single()

  if (memberError) {
    console.error('[org invitations accept] membership insert error:', memberError.message)
    return NextResponse.json({ error: 'Could not accept invitation.' }, { status: 500, headers: orgCorsHeaders(origin) })
  }

  const washpointIds = Array.isArray(invitation.washpoint_ids) ? invitation.washpoint_ids : []
  if (washpointIds.length > 0) {
    const { error: wpmError } = await supabase.from('washpoint_members').insert(
      washpointIds.map((washpointId) => ({
        washpoint_id: washpointId,
        organization_member_id: member.id,
      }))
    )
    if (wpmError) {
      // Non-fatal: the membership itself is real and is what actually
      // grants org access; washpoint assignment can be fixed up by an
      // owner from Team management afterward if this partially failed.
      console.error('[org invitations accept] washpoint_members insert error:', wpmError.message)
    }
  }

  await supabase.from('invitations').update({
    status: 'accepted',
    accepted_by: auth.user.id,
    accepted_at: new Date().toISOString(),
  }).eq('id', invitation.id)

  const { data: organization } = await supabase
    .from('organizations')
    .select('id, name, verification_status, suspended_at')
    .eq('id', invitation.organization_id)
    .maybeSingle()

  await supabase.from('audit_logs').insert({
    organization_id: invitation.organization_id,
    actor_user_id: auth.user.id,
    actor_type: 'organization_user',
    action: 'invitation.accepted',
    target_type: 'organization_member',
    target_id: member.id,
    metadata: { role: invitation.role },
  })

  return NextResponse.json({
    ok: true,
    organization,
    role: member.role,
  }, { headers: orgCorsHeaders(origin) })
}

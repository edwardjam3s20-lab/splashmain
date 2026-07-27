// app/api/org/invitations/route.js
// POST — create a staff invitation. Owner can invite manager/attendant for
// any of the org's washpoints; manager can only invite attendant, and only
// for washpoints they themselves are assigned to (spec: "Managers must not
// automatically receive sensitive owner permissions" -- inviting on behalf
// of a washpoint they don't manage would be exactly that).
// GET — list invitations for an org. Owner sees all; manager sees only the
// ones they personally sent.

import { NextResponse } from 'next/server'
import { randomBytes, createHash } from 'crypto'
import { requireOrgMember } from '@/lib/requireOrgMember'
import { getSupabaseAdmin } from '@/lib/supabase'
import { orgCorsHeaders } from '@/lib/orgCors'
import { Resend } from 'resend'

const resend = new Resend(process.env.RESEND_API_KEY)
const INVITABLE_ROLES = new Set(['manager', 'attendant'])
const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000 // 7 days

function hashToken(token) {
  return createHash('sha256').update(token).digest('hex')
}

export async function OPTIONS(request) {
  const origin = request.headers.get('origin') || ''
  return new NextResponse(null, { status: 200, headers: orgCorsHeaders(origin) })
}

export async function GET(request) {
  const origin = request.headers.get('origin') || ''
  const organizationId = new URL(request.url).searchParams.get('organization_id')

  const auth = await requireOrgMember(organizationId, ['owner', 'manager'])
  if (auth.error) {
    return NextResponse.json({ error: auth.error }, { status: auth.status, headers: orgCorsHeaders(origin) })
  }

  const supabase = getSupabaseAdmin()
  let query = supabase
    .from('invitations')
    .select('id, email, phone, role, washpoint_ids, status, created_at, expires_at, accepted_at, revoked_at')
    .eq('organization_id', organizationId)
    .order('created_at', { ascending: false })

  // Managers only see what they themselves sent -- not the org's full
  // staffing picture, which is Owner-only visibility per the spec.
  if (auth.member.role === 'manager') {
    query = query.eq('invited_by', auth.user.id)
  }

  const { data, error } = await query
  if (error) {
    console.error('[org invitations GET] error:', error.message)
    return NextResponse.json({ error: 'Could not load invitations.' }, { status: 500, headers: orgCorsHeaders(origin) })
  }

  return NextResponse.json({ invitations: data || [] }, { headers: orgCorsHeaders(origin) })
}

export async function POST(request) {
  const origin = request.headers.get('origin') || ''
  const body = await request.json().catch(() => ({}))
  const { organization_id: organizationId, email, phone, role, washpoint_ids: washpointIds } = body || {}

  const auth = await requireOrgMember(organizationId, ['owner', 'manager'])
  if (auth.error) {
    return NextResponse.json({ error: auth.error }, { status: auth.status, headers: orgCorsHeaders(origin) })
  }

  if (!email || !String(email).trim()) {
    return NextResponse.json({ error: 'Email is required.' }, { status: 400, headers: orgCorsHeaders(origin) })
  }
  if (!INVITABLE_ROLES.has(role)) {
    return NextResponse.json({ error: 'Role must be manager or attendant.' }, { status: 400, headers: orgCorsHeaders(origin) })
  }
  const cleanWashpointIds = Array.isArray(washpointIds) ? washpointIds.filter(Boolean) : []
  if (cleanWashpointIds.length === 0) {
    return NextResponse.json({ error: 'At least one washpoint is required.' }, { status: 400, headers: orgCorsHeaders(origin) })
  }

  // Manager-specific restrictions -- enforced here, not just hidden in the
  // UI. A manager cannot invite another manager (role escalation), and can
  // only assign washpoints they themselves are assigned to.
  if (auth.member.role === 'manager') {
    if (role !== 'attendant') {
      return NextResponse.json({ error: 'Managers can only invite attendants.' }, { status: 403, headers: orgCorsHeaders(origin) })
    }
  }

  const supabase = getSupabaseAdmin()

  // Validate every washpoint_id actually belongs to this org (never trust
  // client-supplied IDs), and if the actor is a manager, that they're
  // themselves assigned to each one.
  const { data: orgWashpoints, error: wpError } = await supabase
    .from('wash_points')
    .select('id')
    .eq('organization_id', organizationId)
    .in('id', cleanWashpointIds)

  if (wpError) {
    return NextResponse.json({ error: 'Could not verify washpoints.' }, { status: 500, headers: orgCorsHeaders(origin) })
  }
  if ((orgWashpoints || []).length !== cleanWashpointIds.length) {
    return NextResponse.json({ error: 'One or more washpoints are invalid for this organization.' }, { status: 400, headers: orgCorsHeaders(origin) })
  }

  if (auth.member.role === 'manager') {
    const { data: assigned } = await supabase
      .from('washpoint_members')
      .select('washpoint_id')
      .eq('organization_member_id', auth.member.id)
      .in('washpoint_id', cleanWashpointIds)

    if ((assigned || []).length !== cleanWashpointIds.length) {
      return NextResponse.json(
        { error: 'You can only invite staff to washpoints you manage.' },
        { status: 403, headers: orgCorsHeaders(origin) }
      )
    }
  }

  const cleanEmail = String(email).toLowerCase().trim()

  // Already an active member? Nothing to invite.
  const { data: existingUser } = await supabase
    .from('organization_users')
    .select('id')
    .eq('email', cleanEmail)
    .maybeSingle()
  if (existingUser) {
    const { data: existingMembership } = await supabase
      .from('organization_members')
      .select('id')
      .eq('organization_id', organizationId)
      .eq('user_id', existingUser.id)
      .is('removed_at', null)
      .maybeSingle()
    if (existingMembership) {
      return NextResponse.json({ error: 'This person is already a member of your organization.' }, { status: 409, headers: orgCorsHeaders(origin) })
    }
  }

  const token = randomBytes(32).toString('hex')
  const tokenHash = hashToken(token)
  const expiresAt = new Date(Date.now() + INVITE_TTL_MS).toISOString()

  // Refresh-in-place rather than stack duplicates: one pending invite per
  // (org, email) at a time.
  const { data: existingInvite } = await supabase
    .from('invitations')
    .select('id')
    .eq('organization_id', organizationId)
    .eq('email', cleanEmail)
    .eq('status', 'pending')
    .maybeSingle()

  let invitation
  if (existingInvite) {
    const { data, error } = await supabase
      .from('invitations')
      .update({
        phone: phone || null,
        role,
        washpoint_ids: cleanWashpointIds,
        token_hash: tokenHash,
        invited_by: auth.user.id,
        expires_at: expiresAt,
      })
      .eq('id', existingInvite.id)
      .select()
      .single()
    if (error) {
      console.error('[org invitations POST] refresh error:', error.message)
      return NextResponse.json({ error: 'Could not send invitation.' }, { status: 500, headers: orgCorsHeaders(origin) })
    }
    invitation = data
  } else {
    const { data, error } = await supabase
      .from('invitations')
      .insert({
        organization_id: organizationId,
        email: cleanEmail,
        phone: phone || null,
        role,
        washpoint_ids: cleanWashpointIds,
        status: 'pending',
        token_hash: tokenHash,
        invited_by: auth.user.id,
        expires_at: expiresAt,
      })
      .select()
      .single()
    if (error) {
      console.error('[org invitations POST] insert error:', error.message)
      return NextResponse.json({ error: 'Could not send invitation.' }, { status: 500, headers: orgCorsHeaders(origin) })
    }
    invitation = data
  }

  const { data: organization } = await supabase
    .from('organizations')
    .select('name')
    .eq('id', organizationId)
    .maybeSingle()

  const inviteUrl = `${process.env.OPERATOR_APP_URL || 'https://operator.splashpass.site'}/invite/${token}`

  await resend.emails.send({
    from: 'SplashPass <noreply@splashpass.site>',
    to: cleanEmail,
    subject: `You've been invited to join ${organization?.name || 'a business'} on SplashPass`,
    html: `
      <div style="font-family:sans-serif;max-width:480px;margin:0 auto;padding:32px;background:#0B1437;border-radius:16px;">
        <div style="font-size:28px;font-weight:800;color:#f0f4f8;margin-bottom:8px;">SplashPass</div>
        <div style="font-size:15px;color:#f0f4f8;margin-bottom:24px;">
          You've been invited to join <strong>${organization?.name || 'a business'}</strong> as ${role === 'manager' ? 'a Manager' : 'an Attendant'}.
        </div>
        <a href="${inviteUrl}" style="display:inline-block;background:#2563EB;color:#fff;text-decoration:none;font-weight:700;padding:14px 24px;border-radius:10px;">Accept invitation</a>
        <div style="font-size:13px;color:#7a90a8;line-height:1.6;margin-top:24px;">
          This invitation expires in 7 days. If you weren't expecting this, you can ignore this email.
        </div>
      </div>
    `,
  })

  await supabase.from('audit_logs').insert({
    organization_id: organizationId,
    actor_user_id: auth.user.id,
    actor_type: 'organization_user',
    action: 'invitation.sent',
    target_type: 'invitation',
    target_id: invitation.id,
    metadata: { email: cleanEmail, role },
  })

  const { token_hash, ...publicInvitation } = invitation
  return NextResponse.json({ ok: true, invitation: publicInvitation }, { headers: orgCorsHeaders(origin) })
}

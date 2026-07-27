// app/api/org-verifications/[id]/route.js
// PATCH — admin-only. Takes a review action on an organization's
// verification. `id` is the organization id (not a verification row id —
// organization_verifications is an append-only history, this always acts
// on the organization's current state and appends a new review record).
//
// Body: { action: 'approve'|'request_changes'|'reject'|'suspend'|'restore', notes?: string }

import { NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabase'
import { getSession } from '@/lib/session'

// Each action's allowed source states — prevents e.g. suspending an
// organization that was never verified, or approving one that's already
// rejected without an explicit new submission.
const TRANSITIONS = {
  approve: { from: ['submitted', 'under_review', 'action_required'], to: 'verified', requiresNotes: false },
  request_changes: { from: ['submitted', 'under_review'], to: 'action_required', requiresNotes: true },
  reject: { from: ['submitted', 'under_review', 'action_required'], to: 'rejected', requiresNotes: true },
  suspend: { from: ['verified'], to: 'suspended', requiresNotes: true },
  restore: { from: ['suspended'], to: 'verified', requiresNotes: false },
}

export async function PATCH(request, { params }) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (session.role !== 'admin') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { id: organizationId } = params
  const { action, notes } = await request.json().catch(() => ({}))

  const transition = TRANSITIONS[action]
  if (!transition) {
    return NextResponse.json(
      { error: `Unknown action. Must be one of: ${Object.keys(TRANSITIONS).join(', ')}` },
      { status: 400 }
    )
  }
  if (transition.requiresNotes && !notes?.trim()) {
    return NextResponse.json(
      { error: `Notes are required for "${action}" — the organization needs to know why.` },
      { status: 400 }
    )
  }

  const supabase = getSupabaseAdmin()

  const { data: organization, error: orgError } = await supabase
    .from('organizations')
    .select('*')
    .eq('id', organizationId)
    .maybeSingle()

  if (orgError) return NextResponse.json({ error: 'Could not load organization.' }, { status: 500 })
  if (!organization) return NextResponse.json({ error: 'Organization not found.' }, { status: 404 })

  if (!transition.from.includes(organization.verification_status)) {
    return NextResponse.json(
      {
        error: `Cannot "${action}" an organization with status "${organization.verification_status}". ` +
          `Valid from: ${transition.from.join(', ')}.`,
      },
      { status: 409 }
    )
  }

  const orgUpdates = { verification_status: transition.to, updated_at: new Date().toISOString() }
  if (transition.to === 'verified') orgUpdates.verified_at = new Date().toISOString()
  if (transition.to === 'suspended') orgUpdates.suspended_at = new Date().toISOString()
  if (transition.to === 'verified' && organization.verification_status === 'suspended') {
    // Restoring — clear the suspension timestamp rather than leaving a
    // stale one on an organization that's active again.
    orgUpdates.suspended_at = null
  }

  const { data: updatedOrg, error: updateError } = await supabase
    .from('organizations')
    .update(orgUpdates)
    .eq('id', organizationId)
    .select()
    .single()

  if (updateError) {
    console.error('[org-verifications PATCH] org update error:', updateError.message)
    return NextResponse.json({ error: 'Could not update organization.' }, { status: 500 })
  }

  // Carry forward the most recent submitted_data — this action doesn't
  // change what the business submitted, only the review outcome, but the
  // history row should still be self-contained (what was reviewed +
  // what was decided), not require joining back to an earlier row.
  const { data: previousVerification } = await supabase
    .from('organization_verifications')
    .select('submitted_data')
    .eq('organization_id', organizationId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  const { error: verificationError } = await supabase.from('organization_verifications').insert({
    organization_id: organizationId,
    submitted_data: previousVerification?.submitted_data || {},
    status: transition.to,
    reviewed_by: session.email,
    reviewed_at: new Date().toISOString(),
    notes: notes?.trim() || null,
  })

  if (verificationError) {
    console.error('[org-verifications PATCH] verification insert error:', verificationError.message)
    // Non-fatal — the organization's actual status already updated above,
    // which is the part that matters operationally. The history row is
    // an audit nicety on top, not the source of truth.
  }

  await supabase.from('audit_logs').insert({
    organization_id: organizationId,
    actor_user_id: null,
    actor_type: 'admin',
    action: `organization.${action}`,
    target_type: 'organization',
    target_id: organizationId,
    metadata: { admin_email: session.email, notes: notes?.trim() || null, from: organization.verification_status, to: transition.to },
  })

  return NextResponse.json({ ok: true, organization: updatedOrg })
}

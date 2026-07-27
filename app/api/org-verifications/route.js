// app/api/org-verifications/route.js
// GET — admin-only. Lists organizations for the verification review queue,
// each enriched with its owner, its most recent verification submission,
// and a washpoint count. Admin-side counterpart to the org onboarding
// flow's Step 3 — this is what turns a 'submitted' organization into
// 'verified' (or 'action_required' / 'rejected').
//
// Query param: ?status=submitted,under_review — comma-separated, optional.
// Omit to return every organization regardless of status.

import { NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabase'
import { getSession } from '@/lib/session'

export async function GET(request) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (session.role !== 'admin') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const statusParam = new URL(request.url).searchParams.get('status')
  const statuses = statusParam
    ? statusParam.split(',').map((s) => s.trim()).filter(Boolean)
    : null

  const supabase = getSupabaseAdmin()

  let orgQuery = supabase
    .from('organizations')
    .select('*')
    .order('created_at', { ascending: false })
  if (statuses && statuses.length > 0) {
    orgQuery = orgQuery.in('verification_status', statuses)
  }

  const { data: organizations, error: orgError } = await orgQuery
  if (orgError) {
    console.error('[org-verifications GET] organizations error:', orgError.message)
    return NextResponse.json({ error: 'Could not load organizations.' }, { status: 500 })
  }

  const orgIds = (organizations || []).map((o) => o.id)
  if (orgIds.length === 0) {
    return NextResponse.json({ organizations: [] })
  }

  const [{ data: verifications, error: verError }, { data: members, error: memberError }, { data: washpoints, error: wpError }] =
    await Promise.all([
      supabase
        .from('organization_verifications')
        .select('*')
        .in('organization_id', orgIds)
        .order('created_at', { ascending: false }),
      supabase
        .from('organization_members')
        .select('organization_id, user:organization_users(id, email, full_name, phone)')
        .in('organization_id', orgIds)
        .eq('role', 'owner')
        .is('removed_at', null),
      supabase.from('wash_points').select('id, organization_id').in('organization_id', orgIds),
    ])

  if (verError) console.error('[org-verifications GET] verifications error:', verError.message)
  if (memberError) console.error('[org-verifications GET] members error:', memberError.message)
  if (wpError) console.error('[org-verifications GET] washpoints error:', wpError.message)

  // organization_verifications is append-only (one row per submission/
  // review event) — verifications is already ordered newest-first, so the
  // first match per org is the latest.
  const latestVerificationByOrg = new Map()
  for (const v of verifications || []) {
    if (!latestVerificationByOrg.has(v.organization_id)) {
      latestVerificationByOrg.set(v.organization_id, v)
    }
  }

  const ownerByOrg = new Map()
  for (const m of members || []) {
    if (!ownerByOrg.has(m.organization_id)) ownerByOrg.set(m.organization_id, m.user)
  }

  const washpointCountByOrg = new Map()
  for (const wp of washpoints || []) {
    washpointCountByOrg.set(wp.organization_id, (washpointCountByOrg.get(wp.organization_id) || 0) + 1)
  }

  const result = (organizations || []).map((org) => ({
    ...org,
    owner: ownerByOrg.get(org.id) || null,
    latest_verification: latestVerificationByOrg.get(org.id) || null,
    washpoint_count: washpointCountByOrg.get(org.id) || 0,
  }))

  return NextResponse.json({ organizations: result })
}

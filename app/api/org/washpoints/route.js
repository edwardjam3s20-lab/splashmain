// app/api/org/washpoints/route.js
// GET  — list washpoints for an organization. Owners see every washpoint;
//        managers/attendants see only the ones they're assigned to via
//        washpoint_members (spec: "Managers must NOT automatically
//        receive sensitive owner permissions" — org-wide visibility is
//        one of those).
// POST — create a washpoint (Step 4 of onboarding, and later "add another
//        location" from the dashboard). Owner-only: the spec gives
//        washpoint creation to Owner, not Manager ("Manage assigned
//        washpoints" is explicitly narrower than "Create/edit/remove").
//
// Query/body param: organization_id — required either way, verified
// server-side against organization_members by requireOrgMember(), never
// trusted as-is from the client.

import { NextResponse } from 'next/server'
import { requireOrgMember } from '@/lib/requireOrgMember'
import { getSupabaseAdmin } from '@/lib/supabase'
import { orgCorsHeaders } from '@/lib/orgCors'

export async function OPTIONS(request) {
  const origin = request.headers.get('origin') || ''
  return new NextResponse(null, { status: 200, headers: orgCorsHeaders(origin) })
}

export async function GET(request) {
  const origin = request.headers.get('origin') || ''
  const organizationId = new URL(request.url).searchParams.get('organization_id')

  const auth = await requireOrgMember(organizationId)
  if (auth.error) {
    return NextResponse.json({ error: auth.error }, { status: auth.status, headers: orgCorsHeaders(origin) })
  }

  const supabase = getSupabaseAdmin()

  if (auth.member.role === 'owner') {
    const { data, error } = await supabase
      .from('wash_points')
      .select('*')
      .eq('organization_id', organizationId)
      .order('created_at', { ascending: true })

    if (error) {
      console.error('[org washpoints GET] owner list error:', error.message)
      return NextResponse.json({ error: 'Could not load washpoints.' }, { status: 500, headers: orgCorsHeaders(origin) })
    }
    return NextResponse.json({ washpoints: data || [] }, { headers: orgCorsHeaders(origin) })
  }

  // Manager/attendant: only washpoints they're explicitly assigned to.
  const { data, error } = await supabase
    .from('washpoint_members')
    .select('washpoint:wash_points(*)')
    .eq('organization_member_id', auth.member.id)

  if (error) {
    console.error('[org washpoints GET] member list error:', error.message)
    return NextResponse.json({ error: 'Could not load washpoints.' }, { status: 500, headers: orgCorsHeaders(origin) })
  }

  const washpoints = (data || []).map((row) => row.washpoint).filter(Boolean)
  return NextResponse.json({ washpoints }, { headers: orgCorsHeaders(origin) })
}

export async function POST(request) {
  const origin = request.headers.get('origin') || ''
  const body = await request.json().catch(() => ({}))
  const {
    organization_id: organizationId,
    name, area, phone, lat, lng,
    opens_at: opensAt, closes_at: closesAt,
    description, photos,
  } = body || {}

  const auth = await requireOrgMember(organizationId, ['owner'])
  if (auth.error) {
    return NextResponse.json({ error: auth.error }, { status: auth.status, headers: orgCorsHeaders(origin) })
  }

  if (!name || !String(name).trim()) {
    return NextResponse.json({ error: 'Washpoint name is required.' }, { status: 400, headers: orgCorsHeaders(origin) })
  }
  if (!area || !String(area).trim()) {
    return NextResponse.json({ error: 'Location/area is required.' }, { status: 400, headers: orgCorsHeaders(origin) })
  }

  const insertRow = {
    organization_id: organizationId,
    name: String(name).trim(),
    area: String(area).trim(),
    phone: phone || null,
    lat: typeof lat === 'number' ? lat : (lat ? parseFloat(lat) : null),
    lng: typeof lng === 'number' ? lng : (lng ? parseFloat(lng) : null),
    description: description || null,
    photos: Array.isArray(photos) ? photos : [],
    // Not tier-based for orgs (that's a legacy per-operator concept) — 1 is
    // a harmless placeholder so this stays insertable now that the column
    // is NOT NULL with no default. Same convention already used in
    // lib/orgAccess.js's computeOrgCommissionSplit() for the same reason.
    commission_tier: 1,
  }
  // opens_at/closes_at are optional at creation — an owner can set hours
  // later from Settings (same PATCH the legacy operator hours route uses,
  // once that route is re-scoped to organization_members in a later pass).
  if (opensAt) insertRow.opens_at = opensAt
  if (closesAt) insertRow.closes_at = closesAt

  const supabase = getSupabaseAdmin()
  const { data: washpoint, error } = await supabase
    .from('wash_points')
    .insert(insertRow)
    .select()
    .single()

  if (error) {
    console.error('[org washpoints POST] insert error:', error.message)
    return NextResponse.json({ error: 'Could not create washpoint.' }, { status: 500, headers: orgCorsHeaders(origin) })
  }

  await supabase.from('audit_logs').insert({
    organization_id: organizationId,
    actor_user_id: auth.user.id,
    actor_type: 'organization_user',
    action: 'washpoint.created',
    target_type: 'washpoint',
    target_id: washpoint.id,
    metadata: { name: washpoint.name },
  })

  return NextResponse.json({ ok: true, washpoint }, { headers: orgCorsHeaders(origin) })
}

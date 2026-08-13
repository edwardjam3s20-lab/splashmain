// app/api/org/promotions/route.js
// GET  — list promotions for an organization (optionally filtered by washpoint)
// POST — create a promotion. Owner/manager only, and only for orgs that
//        currently have access (trial or subscribed) -- same threshold
//        cash payments use, see lib/cashEligibility.js / lib/orgAccess.js.

import { NextResponse } from 'next/server'
import { requireOrgMember } from '@/lib/requireOrgMember'
import { getSupabaseAdmin } from '@/lib/supabase'
import { orgCorsHeaders } from '@/lib/orgCors'
import { orgHasAccess } from '@/lib/orgAccess'

export async function OPTIONS(request) {
  const origin = request.headers.get('origin') || ''
  return new NextResponse(null, { status: 200, headers: orgCorsHeaders(origin) })
}

export async function GET(request) {
  const origin = request.headers.get('origin') || ''
  const { searchParams } = new URL(request.url)
  const organizationId = searchParams.get('organization_id')
  const washPointId = searchParams.get('wash_point_id')

  const auth = await requireOrgMember(organizationId, ['owner', 'manager'])
  if (auth.error) {
    return NextResponse.json({ error: auth.error }, { status: auth.status, headers: orgCorsHeaders(origin) })
  }

  const supabase = getSupabaseAdmin()
  let query = supabase
    .from('promotions')
    .select('*')
    .eq('organization_id', organizationId)
    .order('created_at', { ascending: false })

  if (washPointId) query = query.eq('wash_point_id', washPointId)

  const { data: promotions, error } = await query
  if (error) {
    return NextResponse.json({ error: 'Could not load promotions.' }, { status: 500, headers: orgCorsHeaders(origin) })
  }

  return NextResponse.json({ promotions }, { headers: orgCorsHeaders(origin) })
}

export async function POST(request) {
  const origin = request.headers.get('origin') || ''
  const body = await request.json().catch(() => ({}))
  const { organization_id: organizationId } = body || {}

  const auth = await requireOrgMember(organizationId, ['owner', 'manager'])
  if (auth.error) {
    return NextResponse.json({ error: auth.error }, { status: auth.status, headers: orgCorsHeaders(origin) })
  }

  const supabase = getSupabaseAdmin()

  // Same threshold cash payments use: only orgs with active access (trial
  // or paid subscription) can run promotions at all.
  const { data: organization } = await supabase
    .from('organizations')
    .select('sub_status, created_at')
    .eq('id', organizationId)
    .maybeSingle()

  if (!organization || !orgHasAccess(organization)) {
    return NextResponse.json(
      { error: 'Promotions are only available to subscribed organizations (including your free trial).' },
      { status: 403, headers: orgCorsHeaders(origin) }
    )
  }

  const {
    wash_point_id: washPointId,
    wash_point_extra_id: washPointExtraId,
    title,
    description,
    discount_type: discountType,
    discount_value: discountValue,
    starts_at: startsAt,
    ends_at: endsAt,
  } = body

  if (!washPointId || !title?.trim()) {
    return NextResponse.json({ error: 'wash_point_id and title are required.' }, { status: 400, headers: orgCorsHeaders(origin) })
  }
  if (!['percent', 'fixed'].includes(discountType)) {
    return NextResponse.json({ error: 'discount_type must be "percent" or "fixed".' }, { status: 400, headers: orgCorsHeaders(origin) })
  }
  const value = Number(discountValue)
  if (!Number.isFinite(value) || value <= 0 || (discountType === 'percent' && value > 100)) {
    return NextResponse.json({ error: 'Invalid discount_value.' }, { status: 400, headers: orgCorsHeaders(origin) })
  }
  if (endsAt && startsAt && new Date(endsAt) <= new Date(startsAt)) {
    return NextResponse.json({ error: 'ends_at must be after starts_at.' }, { status: 400, headers: orgCorsHeaders(origin) })
  }

  // Confirm the washpoint (and, if given, the service) actually belong to
  // this organization -- never trust the IDs alone.
  const { data: washpoint } = await supabase
    .from('wash_points')
    .select('id')
    .eq('id', washPointId)
    .eq('organization_id', organizationId)
    .maybeSingle()
  if (!washpoint) {
    return NextResponse.json({ error: 'Washpoint not found in this organization.' }, { status: 404, headers: orgCorsHeaders(origin) })
  }

  if (washPointExtraId) {
    const { data: service } = await supabase
      .from('wash_point_extras')
      .select('id')
      .eq('id', washPointExtraId)
      .eq('wash_point_id', washPointId)
      .maybeSingle()
    if (!service) {
      return NextResponse.json({ error: 'Service not found at this washpoint.' }, { status: 404, headers: orgCorsHeaders(origin) })
    }
  }

  const { data: promotion, error } = await supabase
    .from('promotions')
    .insert({
      organization_id: organizationId,
      wash_point_id: washPointId,
      wash_point_extra_id: washPointExtraId || null,
      title: title.trim(),
      description: description?.trim() || null,
      discount_type: discountType,
      discount_value: value,
      starts_at: startsAt || new Date().toISOString(),
      ends_at: endsAt || null,
      active: true,
      created_by: auth.user.id,
    })
    .select()
    .single()

  if (error) {
    console.error('[org promotions] create error:', error.message)
    return NextResponse.json({ error: 'Could not create promotion.' }, { status: 500, headers: orgCorsHeaders(origin) })
  }

  await supabase.from('audit_logs').insert({
    organization_id: organizationId,
    actor_user_id: auth.user.id,
    actor_type: 'organization_user',
    action: 'promotion.created',
    target_type: 'promotion',
    target_id: promotion.id,
    metadata: { title: promotion.title, discount_type: discountType, discount_value: value },
  })

  return NextResponse.json({ ok: true, promotion }, { headers: orgCorsHeaders(origin) })
}

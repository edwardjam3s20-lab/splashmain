// app/api/org/services/[id]/route.js
// PATCH — edit a service. DELETE — remove one. Owner-only, same reasoning
// as POST in the sibling route: pricing is owner scope, not manager.
//
// Body (both): { organization_id, washpoint_id } required for auth, since
// requireWashpointMember needs both to resolve role + washpoint scope.
// PATCH additionally accepts any subset of { name, description, price,
// duration, icon, prices_by_car_type }.

import { NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabase'
import { requireWashpointMember } from '@/lib/requireWashpointMember'
import { orgCorsHeaders } from '@/lib/orgCors'

const CAR_TYPES = ['saloon', 'suv', 'pickup', 'van', 'hatchback', 'coupe']

export async function OPTIONS(request) {
  const origin = request.headers.get('origin') || ''
  return new NextResponse(null, { status: 200, headers: orgCorsHeaders(origin) })
}

// Mirrors org/washpoints/[id]'s "never trust the [id] alone" reasoning --
// confirms this specific service row actually belongs to the washpoint
// requireWashpointMember just verified the caller can act at, not just
// any washpoint in any organization.
async function assertOwnsService(supabase, washpointId, id) {
  const { data, error } = await supabase
    .from('wash_point_extras')
    .select('id, wash_point_id')
    .eq('id', id)
    .maybeSingle()
  if (error || !data) return false
  return String(data.wash_point_id) === String(washpointId)
}

export async function PATCH(request, { params }) {
  const origin = request.headers.get('origin') || ''
  const body = await request.json().catch(() => ({}))
  const { organization_id: organizationId, washpoint_id: washpointId, ...fields } = body || {}

  const auth = await requireWashpointMember(organizationId, washpointId, ['owner'])
  if (auth.error) {
    return NextResponse.json({ error: auth.error }, { status: auth.status, headers: orgCorsHeaders(origin) })
  }

  const supabase = getSupabaseAdmin()
  const owns = await assertOwnsService(supabase, washpointId, params.id)
  if (!owns) {
    return NextResponse.json({ error: 'Service not found' }, { status: 404, headers: orgCorsHeaders(origin) })
  }

  const { name, description, price, duration, icon, prices_by_car_type: pricesByCarType } = fields

  const updates = {}
  if (name !== undefined) {
    const value = String(name).trim()
    if (!value) return NextResponse.json({ error: 'Name cannot be empty.' }, { status: 400, headers: orgCorsHeaders(origin) })
    updates.name = value
  }
  if (description !== undefined) updates.description = description
  if (price != null) {
    if (isNaN(Number(price))) return NextResponse.json({ error: 'Price must be a number.' }, { status: 400, headers: orgCorsHeaders(origin) })
    updates.price = Number(price)
  }
  if (duration !== undefined) updates.duration = duration || null
  if (icon !== undefined) updates.icon = icon || '🚿'

  if (pricesByCarType && typeof pricesByCarType === 'object') {
    for (const type of CAR_TYPES) {
      const value = pricesByCarType[type]
      // Empty string clears that car type's override back to the base price.
      updates[`price_${type}`] = value === '' || value == null ? null : Number(value)
    }
  }

  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: 'No changes provided.' }, { status: 400, headers: orgCorsHeaders(origin) })
  }

  const { data, error } = await supabase
    .from('wash_point_extras')
    .update(updates)
    .eq('id', params.id)
    .select()
    .single()

  if (error) {
    console.error('[org services PATCH] error:', error.message)
    return NextResponse.json({ error: error.message }, { status: 500, headers: orgCorsHeaders(origin) })
  }

  await supabase.from('audit_logs').insert({
    organization_id: organizationId,
    actor_user_id: auth.user.id,
    actor_type: 'organization_user',
    action: 'service.updated',
    target_type: 'wash_point_extra',
    target_id: params.id,
    metadata: { washpoint_id: washpointId, fields: Object.keys(updates) },
  })

  return NextResponse.json({ ok: true, service: data }, { headers: orgCorsHeaders(origin) })
}

export async function DELETE(request, { params }) {
  const origin = request.headers.get('origin') || ''
  const body = await request.json().catch(() => ({}))
  const { organization_id: organizationId, washpoint_id: washpointId } = body || {}

  const auth = await requireWashpointMember(organizationId, washpointId, ['owner'])
  if (auth.error) {
    return NextResponse.json({ error: auth.error }, { status: auth.status, headers: orgCorsHeaders(origin) })
  }

  const supabase = getSupabaseAdmin()
  const owns = await assertOwnsService(supabase, washpointId, params.id)
  if (!owns) {
    return NextResponse.json({ error: 'Service not found' }, { status: 404, headers: orgCorsHeaders(origin) })
  }

  const { error } = await supabase.from('wash_point_extras').delete().eq('id', params.id)
  if (error) {
    console.error('[org services DELETE] error:', error.message)
    return NextResponse.json({ error: error.message }, { status: 500, headers: orgCorsHeaders(origin) })
  }

  await supabase.from('audit_logs').insert({
    organization_id: organizationId,
    actor_user_id: auth.user.id,
    actor_type: 'organization_user',
    action: 'service.deleted',
    target_type: 'wash_point_extra',
    target_id: params.id,
    metadata: { washpoint_id: washpointId },
  })

  return NextResponse.json({ ok: true }, { headers: orgCorsHeaders(origin) })
}

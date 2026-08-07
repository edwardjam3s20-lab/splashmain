// app/api/org/services/route.js
// GET  — list services (wash_point_extras) at a washpoint. Any active role
//        can view -- an attendant needs to see prices while scanning.
// POST — add a service. Owner-only, same scope as the washpoints screen
// this lives under ("pricing owners set per washpoint") -- not the
// owner/manager scope used for washers/roster, since pricing is a
// structural decision about the washpoint, not day-to-day staffing.
//
// Query/body param: washpoint_id (organization_id required for auth too)
//
// This is the org-model equivalent of app/api/operator/services/route.js.
// Same wash_point_extras table (booking creation in app/api/bookings
// reads from it regardless of whether the washpoint is legacy or
// org-owned), just scoped via requireWashpointMember instead of a single
// pinned operator.wash_point_id, since one org can own several washpoints.

import { NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabase'
import { requireWashpointMember } from '@/lib/requireWashpointMember'
import { orgCorsHeaders } from '@/lib/orgCors'

const CAR_TYPES = ['saloon', 'suv', 'pickup', 'van', 'hatchback', 'coupe']

export async function OPTIONS(request) {
  const origin = request.headers.get('origin') || ''
  return new NextResponse(null, { status: 200, headers: orgCorsHeaders(origin) })
}

export async function GET(request) {
  const origin = request.headers.get('origin') || ''
  const { searchParams } = new URL(request.url)
  const organizationId = searchParams.get('organization_id')
  const washpointId = searchParams.get('washpoint_id')

  const auth = await requireWashpointMember(organizationId, washpointId)
  if (auth.error) {
    return NextResponse.json({ error: auth.error }, { status: auth.status, headers: orgCorsHeaders(origin) })
  }

  const supabase = getSupabaseAdmin()
  const { data, error } = await supabase
    .from('wash_point_extras')
    .select('*')
    .eq('wash_point_id', washpointId)
    .order('price', { ascending: true })

  if (error) {
    console.error('[org services GET] error:', error.message)
    return NextResponse.json({ error: error.message }, { status: 500, headers: orgCorsHeaders(origin) })
  }

  return NextResponse.json({ services: data || [] }, { headers: orgCorsHeaders(origin) })
}

export async function POST(request) {
  const origin = request.headers.get('origin') || ''
  const body = await request.json().catch(() => ({}))
  const {
    organization_id: organizationId,
    washpoint_id: washpointId,
    name,
    description,
    price,
    duration,
    icon,
    prices_by_car_type: pricesByCarType,
  } = body || {}

  const auth = await requireWashpointMember(organizationId, washpointId, ['owner'])
  if (auth.error) {
    return NextResponse.json({ error: auth.error }, { status: auth.status, headers: orgCorsHeaders(origin) })
  }
  if (!name || !String(name).trim()) {
    return NextResponse.json({ error: 'Service name is required.' }, { status: 400, headers: orgCorsHeaders(origin) })
  }
  if (price == null || isNaN(Number(price))) {
    return NextResponse.json({ error: 'A valid price is required.' }, { status: 400, headers: orgCorsHeaders(origin) })
  }

  const insertRow = {
    wash_point_id: washpointId,
    name: String(name).trim(),
    description: description || '',
    price: Number(price),
    duration: duration || null,
    icon: icon || '🚿',
  }

  // Optional per-car-type prices. Any car type left blank/omitted falls
  // back to the base `price` column at booking time -- same convention
  // as the legacy operator/services route.
  if (pricesByCarType && typeof pricesByCarType === 'object') {
    for (const type of CAR_TYPES) {
      const value = pricesByCarType[type]
      if (value != null && value !== '') {
        insertRow[`price_${type}`] = Number(value)
      }
    }
  }

  const supabase = getSupabaseAdmin()
  const { data, error } = await supabase
    .from('wash_point_extras')
    .insert(insertRow)
    .select()
    .single()

  if (error) {
    console.error('[org services POST] error:', error.message)
    return NextResponse.json({ error: error.message }, { status: 500, headers: orgCorsHeaders(origin) })
  }

  await supabase.from('audit_logs').insert({
    organization_id: organizationId,
    actor_user_id: auth.user.id,
    actor_type: 'organization_user',
    action: 'service.created',
    target_type: 'wash_point_extra',
    target_id: data.id,
    metadata: { washpoint_id: washpointId, name: data.name, price: data.price },
  })

  return NextResponse.json({ ok: true, service: data }, { headers: orgCorsHeaders(origin) })
}

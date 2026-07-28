// app/api/org/scan/lookup/route.js
// GET — find a customer's confirmed booking today by plate, scoped to a
// specific washpoint. Org-aware equivalent of app/api/operator/lookup;
// deliberately a separate route rather than a modified one (see the
// planning discussion: option 1, fully parallel, for a first pass on
// live production scanning).
//
// Unlike the legacy route (which matches booking.location === a name
// string), this filters on booking.washpoint_id -- a real FK -- which
// only bookings against org-owned washpoints will have set. Any role
// (owner/manager/attendant) can look up a booking; the state-changing
// actions in [id]/route.js are the ones that differentiate by role.
//
// Query params: organization_id, washpoint_id, plate

import { NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabase'
import { requireWashpointMember } from '@/lib/requireWashpointMember'
import { orgCorsHeaders } from '@/lib/orgCors'

export async function OPTIONS(request) {
  const origin = request.headers.get('origin') || ''
  return new NextResponse(null, { status: 200, headers: orgCorsHeaders(origin) })
}

export async function GET(request) {
  const origin = request.headers.get('origin') || ''
  const url = new URL(request.url)
  const organizationId = url.searchParams.get('organization_id')
  const washpointId = url.searchParams.get('washpoint_id')
  const plate = url.searchParams.get('plate')?.trim()

  const auth = await requireWashpointMember(organizationId, washpointId)
  if (auth.error) {
    return NextResponse.json({ error: auth.error }, { status: auth.status, headers: orgCorsHeaders(origin) })
  }
  if (!plate) {
    return NextResponse.json({ error: 'Plate required' }, { status: 400, headers: orgCorsHeaders(origin) })
  }

  const supabase = getSupabaseAdmin()
  const today = new Date().toISOString().split('T')[0]

  const { data: users } = await supabase
    .from('profiles')
    .select('*')
    .ilike('plate', plate)

  if (!users?.length) {
    return NextResponse.json({ user: null, booking: null }, { headers: orgCorsHeaders(origin) })
  }

  const user = users[0]
  const { data: bookings } = await supabase
    .from('bookings')
    .select('*')
    .eq('user_email', user.email)
    .eq('date', today)
    .eq('status', 'confirmed')
    .eq('washpoint_id', washpointId)
    .order('time', { ascending: true })
    .limit(1)

  return NextResponse.json({
    user,
    booking: bookings?.[0] || null,
  }, { headers: orgCorsHeaders(origin) })
}

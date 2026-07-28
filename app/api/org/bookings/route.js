// app/api/org/bookings/route.js
// GET — list bookings for a washpoint (any active role there). Org-aware
// equivalent of app/api/operator/bookings/route.js -- same query params
// (date, from, to, status), scoped by washpoint_id (a real FK) instead of
// the legacy location-name match.
//
// Query params: organization_id, washpoint_id, date | from/to, status

import { NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabase'
import { requireWashpointMember } from '@/lib/requireWashpointMember'
import { enrichBookingCommission } from '@/lib/commission'
import { orgCorsHeaders } from '@/lib/orgCors'

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

  const from = searchParams.get('from')
  const to = searchParams.get('to')
  const status = searchParams.get('status')
  const date = searchParams.get('date')

  const supabase = getSupabaseAdmin()
  let query = supabase
    .from('bookings')
    .select('*')
    .eq('washpoint_id', washpointId)
    .order('time', { ascending: true })

  if (date) {
    query = query.eq('date', date)
  } else {
    if (from) query = query.gte('date', from)
    if (to) query = query.lte('date', to)
  }

  if (status) {
    const statuses = status.split(',').map((s) => s.trim()).filter(Boolean)
    query = statuses.length > 1 ? query.in('status', statuses) : query.eq('status', statuses[0])
  }

  const { data, error } = await query
  if (error) {
    console.error('[org bookings GET] error:', error.message)
    return NextResponse.json({ error: error.message }, { status: 500, headers: orgCorsHeaders(origin) })
  }

  const tier = auth.washpoint.commission_tier ?? 1
  const bookings = (data || []).map((b) => enrichBookingCommission(b, tier))

  return NextResponse.json({ bookings, commission_tier: tier }, { headers: orgCorsHeaders(origin) })
}

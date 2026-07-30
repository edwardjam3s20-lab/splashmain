// app/api/org/dashboard/route.js
// GET — summary metrics for the org dashboard home screen. Role-scoped,
// not just role-hidden-in-the-UI:
//   owner    — org-wide (every washpoint), includes revenue.
//   manager  — scoped to their own assigned washpoints only (spec:
//              "operational analytics", distinct from owner's
//              "organization-wide financial analytics"), no revenue.
//   attendant — no aggregate metrics at all (nothing in the spec gives
//              them analytics access) — just their own recently-processed
//              washes, via staff_member_id, so the response isn't empty.
//
// "Active Plans" from the reference mockup is deliberately NOT here — that
// number lives in the customer loyalty/subscription system, a completely
// separate data model this pass hasn't looked at. Not faking a number for
// it.
//
// Query param: organization_id

import { NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabase'
import { requireOrgMember } from '@/lib/requireOrgMember'
import { enrichBookingCommission } from '@/lib/commission'
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
  const role = auth.member.role
  const today = new Date().toISOString().split('T')[0]

  // Resolve the washpoint scope this role can see. Same rule as
  // requireWashpointMember/the invitations route: owner = every washpoint
  // in the org, manager/attendant = only what they're explicitly assigned
  // via washpoint_members.
  let washpointIds = []
  if (role === 'owner') {
    const { data: wps } = await supabase.from('wash_points').select('id').eq('organization_id', organizationId)
    washpointIds = (wps || []).map((w) => w.id)
  } else {
    const { data: assignments } = await supabase
      .from('washpoint_members')
      .select('washpoint_id')
      .eq('organization_member_id', auth.member.id)
    washpointIds = (assignments || []).map((a) => a.washpoint_id)
  }

  if (washpointIds.length === 0) {
    return NextResponse.json({
      role,
      washpoint_count: 0,
      staff_count: 0,
      washes_today: 0,
      customers_today: 0,
      revenue_today: null,
      recent_washes: [],
    }, { headers: orgCorsHeaders(origin) })
  }

  // Attendants get no aggregate metrics — just their own recent washes —
  // so skip the counting work entirely for that role rather than compute
  // numbers nobody asked for and nothing renders.
  if (role === 'attendant') {
    const { data: mine } = await supabase
      .from('bookings')
      .select('id, user_name, car_plate, washpoint_id, status, time, date, wash_completed_at')
      .eq('staff_member_id', auth.member.id)
      .in('washpoint_id', washpointIds)
      .order('date', { ascending: false })
      .order('time', { ascending: false })
      .limit(8)

    const { data: wps } = await supabase.from('wash_points').select('id, name').in('id', washpointIds)
    const washpointName = new Map((wps || []).map((w) => [w.id, w.name]))

    return NextResponse.json({
      role,
      washpoint_count: washpointIds.length,
      recent_washes: (mine || []).map((b) => ({
        id: b.id,
        customer_name: b.user_name,
        plate: b.car_plate,
        washpoint_name: washpointName.get(b.washpoint_id) || null,
        staff_name: null,
        status: b.status,
        time: b.time,
        date: b.date,
      })),
    }, { headers: orgCorsHeaders(origin) })
  }

  const { data: todaysBookings, error: bookingsError } = await supabase
    .from('bookings')
    .select('*')
    .in('washpoint_id', washpointIds)
    .eq('date', today)
    .neq('status', 'rejected')
    .order('time', { ascending: false })

  if (bookingsError) {
    console.error('[org dashboard] bookings error:', bookingsError.message)
    return NextResponse.json({ error: 'Could not load dashboard.' }, { status: 500, headers: orgCorsHeaders(origin) })
  }

  const bookings = todaysBookings || []
  const washesToday = bookings.length
  const customersToday = new Set(bookings.map((b) => b.user_email).filter(Boolean)).size

  let revenueToday = null
  if (role === 'owner') {
    revenueToday = bookings
      .filter((b) => b.status === 'completed')
      .reduce((sum, b) => sum + (enrichBookingCommission(b).operator_amount || 0), 0)
  }

  const { data: staffRows } = await supabase
    .from('organization_members')
    .select('id')
    .eq('organization_id', organizationId)
    .neq('role', 'owner')
    .is('removed_at', null)

  // Staff-name lookup for the recent-washes list -- staff_member_id points
  // at organization_members, which has no name of its own; join through to
  // organization_users for full_name.
  const staffMemberIds = [...new Set(bookings.map((b) => b.staff_member_id).filter(Boolean))]
  const staffNameByMemberId = new Map()
  if (staffMemberIds.length > 0) {
    const { data: members } = await supabase
      .from('organization_members')
      .select('id, user:organization_users(full_name)')
      .in('id', staffMemberIds)
    for (const m of members || []) {
      staffNameByMemberId.set(m.id, m.user?.full_name || null)
    }
  }

  const washpointNameById = new Map()
  {
    const { data: wps } = await supabase.from('wash_points').select('id, name').in('id', washpointIds)
    for (const w of wps || []) washpointNameById.set(w.id, w.name)
  }

  const recentWashes = bookings.slice(0, 8).map((b) => ({
    id: b.id,
    customer_name: b.user_name,
    plate: b.car_plate,
    washpoint_name: washpointNameById.get(b.washpoint_id) || null,
    staff_name: b.staff_member_id ? staffNameByMemberId.get(b.staff_member_id) || null : null,
    status: b.status,
    time: b.time,
    date: b.date,
  }))

  return NextResponse.json({
    role,
    washpoint_count: washpointIds.length,
    staff_count: (staffRows || []).length,
    washes_today: washesToday,
    customers_today: customersToday,
    revenue_today: revenueToday,
    recent_washes: recentWashes,
  }, { headers: orgCorsHeaders(origin) })
}

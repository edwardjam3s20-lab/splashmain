// app/api/org/bookings/[id]/route.js
// GET   — view a booking (any active role at its washpoint).
// PATCH — the wash lifecycle: accept, reject, assign, free, start,
//         complete. Org-aware equivalent of
//         app/api/operator/bookings/[id]/route.js -- deliberately a
//         separate route (option 1 from the planning discussion: fully
//         parallel, so nothing that works today on the legacy route can
//         break). Ported logic is intentionally identical where the
//         behavior itself doesn't change; differences are called out
//         below.
//
// Key difference from the legacy route: auth is derived FROM the booking
// itself (booking.organization_id / booking.washpoint_id), not from the
// caller's own identity outward. That means a booking with either of
// those columns unset simply isn't manageable through this route at all
// -- there's no backfill-on-write here the way the legacy route has,
// because backfilling would require deriving org/washpoint from the
// booking BEFORE authorizing against it, which is circular for a route
// whose whole authorization model starts from those same columns. Any
// booking in that state stays on the legacy operator route until the
// operator->org data migration (still unwritten) backfills it properly.
//
// Also sets staff_member_id (the acting organization_members.id) on every
// action -- closing the gap flagged during the wash-attribution pass,
// where operators had no organization_members equivalent to attribute to.

import { NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabase'
import { requireWashpointMember } from '@/lib/requireWashpointMember'
import { orgCorsHeaders } from '@/lib/orgCors'

const ACTION_ROLES = {
  accept: ['owner', 'manager'],
  reject: ['owner', 'manager'],
  assign: ['owner', 'manager'],
  free: ['owner', 'manager'],
  start: ['owner', 'manager', 'attendant'],
  complete: ['owner', 'manager', 'attendant'],
}

async function loadOrgBooking(supabase, id) {
  const { data, error } = await supabase.from('bookings').select('*').eq('id', id).maybeSingle()
  if (error) return { error: 'Could not load booking', status: 500 }
  if (!data) return { error: 'Booking not found', status: 404 }
  if (!data.organization_id || !data.washpoint_id) {
    return { error: 'This booking is not linked to an organization yet.', status: 409 }
  }
  return { booking: data }
}

// Same ownership check as the legacy route, just parameterized off the
// booking's real washpoint_id FK instead of an operator's pinned
// wash_point_id.
async function ownedWasher(supabase, washerId, washpointId) {
  const { data, error } = await supabase
    .from('wash_point_staff')
    .select('id, wash_point_id')
    .eq('id', washerId)
    .maybeSingle()
  if (error || !data) return { error: 'Washer not found', status: 404 }
  if (String(data.wash_point_id) !== String(washpointId)) {
    return { error: 'That washer is not on this washpoint\'s staff', status: 403 }
  }
  return { ok: true }
}

function isUniqueViolation(error) {
  return error?.code === '23505'
}

async function notifyCustomer(request, booking, message) {
  try {
    const origin = new URL(request.url).origin
    await fetch(`${origin}/api/send-sms`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phone: booking.user_phone || booking.user_email, message }),
    })
  } catch (e) {
    console.error('[org bookings] notifyCustomer SMS failed:', e.message)
  }
}

export async function OPTIONS(request) {
  const origin = request.headers.get('origin') || ''
  return new NextResponse(null, { status: 200, headers: orgCorsHeaders(origin) })
}

export async function GET(request, { params }) {
  const origin = request.headers.get('origin') || ''
  const supabase = getSupabaseAdmin()

  const found = await loadOrgBooking(supabase, params.id)
  if (found.error) {
    return NextResponse.json({ error: found.error }, { status: found.status, headers: orgCorsHeaders(origin) })
  }

  const auth = await requireWashpointMember(found.booking.organization_id, found.booking.washpoint_id)
  if (auth.error) {
    return NextResponse.json({ error: auth.error }, { status: auth.status, headers: orgCorsHeaders(origin) })
  }

  return NextResponse.json({ booking: found.booking }, { headers: orgCorsHeaders(origin) })
}

export async function PATCH(request, { params }) {
  const origin = request.headers.get('origin') || ''
  const body = await request.json().catch(() => ({}))
  const supabase = getSupabaseAdmin()

  const found = await loadOrgBooking(supabase, params.id)
  if (found.error) {
    return NextResponse.json({ error: found.error }, { status: found.status, headers: orgCorsHeaders(origin) })
  }
  const booking = found.booking

  // Confirm org+washpoint membership first (any active role), THEN check
  // whether that specific role can perform the requested action -- this
  // way "you're assigned here but attendants can't accept bookings" reads
  // as 403 Forbidden, not 404/401, which is the more honest status.
  const auth = await requireWashpointMember(booking.organization_id, booking.washpoint_id)
  if (auth.error) {
    return NextResponse.json({ error: auth.error }, { status: auth.status, headers: orgCorsHeaders(origin) })
  }

  const allowedRoles = ACTION_ROLES[body.action]
  if (!allowedRoles) {
    return NextResponse.json({ error: 'Unknown or missing action.' }, { status: 400, headers: orgCorsHeaders(origin) })
  }
  if (!allowedRoles.includes(auth.member.role)) {
    return NextResponse.json(
      { error: `Your role (${auth.member.role}) cannot perform "${body.action}".` },
      { status: 403, headers: orgCorsHeaders(origin) }
    )
  }

  const updates = { staff_member_id: auth.member.id }
  let smsMessage = null

  switch (body.action) {
    case 'accept': {
      if (booking.status !== 'pending') {
        return NextResponse.json(
          { error: `Cannot accept a booking with status "${booking.status}".` },
          { status: 409, headers: orgCorsHeaders(origin) }
        )
      }
      updates.status = 'accepted'
      updates.accepted_at = new Date().toISOString()
      smsMessage = `SplashPass: ${booking.location} accepted your booking request for ${booking.date} at ${booking.time}. Complete payment in the app to confirm.`
      break
    }

    case 'reject': {
      if (booking.status !== 'pending') {
        return NextResponse.json(
          { error: `Cannot reject a booking with status "${booking.status}".` },
          { status: 409, headers: orgCorsHeaders(origin) }
        )
      }
      updates.status = 'rejected'
      updates.rejected_at = new Date().toISOString()
      updates.rejection_reason = body.reason || null
      smsMessage = `SplashPass: ${booking.location} could not accept your booking for ${booking.date} at ${booking.time}. Please book another wash point in the app.`
      break
    }

    case 'complete': {
      updates.status = 'completed'
      updates.points_earned = body.points_earned ?? booking.points_earned ?? 10
      updates.wash_completed_at = new Date().toISOString()
      break
    }

    case 'assign': {
      if (!body.assigned_washer_id) {
        return NextResponse.json({ error: 'assigned_washer_id is required' }, { status: 400, headers: orgCorsHeaders(origin) })
      }
      const owned = await ownedWasher(supabase, body.assigned_washer_id, booking.washpoint_id)
      if (owned.error) {
        return NextResponse.json({ error: owned.error }, { status: owned.status, headers: orgCorsHeaders(origin) })
      }
      updates.assigned_washer_id = body.assigned_washer_id
      // NOT assigned_by_operator_id -- that column is FK'd to the legacy
      // operators table; this actor is an organization_members row, which
      // is exactly what staff_member_id (set above, unconditionally) is
      // for.
      updates.assigned_at = new Date().toISOString()
      updates.wash_started_at = null
      updates.wash_completed_at = null
      break
    }

    case 'start': {
      if (!booking.assigned_washer_id) {
        return NextResponse.json({ error: 'Assign a washer before starting the wash' }, { status: 400, headers: orgCorsHeaders(origin) })
      }
      updates.wash_started_at = new Date().toISOString()
      break
    }

    case 'free': {
      updates.assigned_washer_id = null
      updates.assigned_at = null
      updates.wash_started_at = null
      break
    }
  }

  const { data, error } = await supabase
    .from('bookings')
    .update(updates)
    .eq('id', params.id)
    .select()
    .single()

  if (error) {
    if (isUniqueViolation(error)) {
      return NextResponse.json(
        { error: 'This washer is already on another active job.' },
        { status: 409, headers: orgCorsHeaders(origin) }
      )
    }
    console.error('[org bookings PATCH] update error:', error.message)
    return NextResponse.json({ error: error.message }, { status: 500, headers: orgCorsHeaders(origin) })
  }

  if (smsMessage) {
    await notifyCustomer(request, data, smsMessage)
  }

  return NextResponse.json({ booking: data }, { headers: orgCorsHeaders(origin) })
}

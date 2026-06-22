import { NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabase'
import { requireOperator } from '@/lib/requireOperator'

async function getBookingForOperator(supabase, id, op) {
  const { data, error } = await supabase.from('bookings').select('*').eq('id', id).single()
  if (error || !data) return { error: 'Booking not found', status: 404 }
  if (data.location !== op.wash_point) {
    return { error: 'Booking is not for your wash point', status: 403 }
  }
  return { booking: data }
}

// Confirms a washer id belongs to the operator's own wash point before
// it can be written onto a booking. Without this, an operator could
// assign a booking to another wash point's staff member.
async function ownedWasher(supabase, washerId, wpId) {
  const { data, error } = await supabase
    .from('wash_point_staff')
    .select('id, wash_point_id')
    .eq('id', washerId)
    .single()
  if (error || !data) return { error: 'Washer not found', status: 404 }
  if (String(data.wash_point_id) !== String(wpId)) {
    return { error: 'That washer is not on your staff', status: 403 }
  }
  return { ok: true }
}

function isUniqueViolation(error) {
  // Postgres unique_violation
  return error?.code === '23505'
}

export async function GET(_request, { params }) {
  const result = await requireOperator()
  if (result.error) {
    return NextResponse.json({ error: result.error }, { status: result.status })
  }

  const supabase = getSupabaseAdmin()
  const found = await getBookingForOperator(supabase, params.id, result.operator)
  if (found.error) {
    return NextResponse.json({ error: found.error }, { status: found.status })
  }
  return NextResponse.json({ booking: found.booking })
}

export async function PATCH(request, { params }) {
  const result = await requireOperator()
  if (result.error) {
    return NextResponse.json({ error: result.error }, { status: result.status })
  }

  const body = await request.json()
  const supabase = getSupabaseAdmin()
  const found = await getBookingForOperator(supabase, params.id, result.operator)
  if (found.error) {
    return NextResponse.json({ error: found.error }, { status: found.status })
  }

  const booking = found.booking
  const updates = {}

  switch (body.action) {
    case 'complete': {
      updates.status = 'completed'
      updates.points_earned = body.points_earned ?? booking.points_earned ?? 10
      // Also frees the washer: without this, one_active_assignment_per_washer
      // would keep treating this washer as busy forever.
      updates.wash_completed_at = new Date().toISOString()
      break
    }

    case 'assign': {
      if (!body.assigned_washer_id) {
        return NextResponse.json({ error: 'assigned_washer_id is required' }, { status: 400 })
      }
      if (!result.operator.wash_point_id) {
        return NextResponse.json({ error: 'No wash point linked to your account' }, { status: 400 })
      }
      const owned = await ownedWasher(supabase, body.assigned_washer_id, result.operator.wash_point_id)
      if (owned.error) {
        return NextResponse.json({ error: owned.error }, { status: owned.status })
      }
      updates.assigned_washer_id = body.assigned_washer_id
      updates.assigned_by_operator_id = result.operator.id
      updates.assigned_at = new Date().toISOString()
      // Starting a fresh assignment clears any stale completion/start state
      // from a previous wash attempt on this booking.
      updates.wash_started_at = null
      updates.wash_completed_at = null
      break
    }

    case 'start': {
      if (!booking.assigned_washer_id) {
        return NextResponse.json({ error: 'Assign a washer before starting the wash' }, { status: 400 })
      }
      updates.wash_started_at = new Date().toISOString()
      break
    }

    case 'free': {
      // Releases the washer without marking the booking completed --
      // e.g. operator picked the wrong person and wants to reassign.
      updates.assigned_washer_id = null
      updates.assigned_by_operator_id = null
      updates.assigned_at = null
      updates.wash_started_at = null
      break
    }

    default: {
      // Back-compat: allow direct field writes for callers not yet
      // using the action-based API.
      if (body.wash_started_at !== undefined) updates.wash_started_at = body.wash_started_at
      break
    }
  }

  if (!Object.keys(updates).length) {
    return NextResponse.json({ error: 'No valid updates' }, { status: 400 })
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
        { status: 409 }
      )
    }
    const msg = error.message || ''
    if (msg.includes('assigned_washer') || msg.includes('wash_started_at') || msg.includes('wash_completed_at')) {
      return NextResponse.json(
        {
          error:
            'Database missing assignment columns. Run supabase/operator_wash_assignment.sql in Supabase SQL editor.',
        },
        { status: 500 }
      )
    }
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ booking: data })
}

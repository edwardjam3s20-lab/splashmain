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

  if (body.action === 'complete') {
    updates.status = 'completed'
    updates.points_earned = body.points_earned ?? booking.points_earned ?? 10
  }

  if (body.assigned_washer_id !== undefined) updates.assigned_washer_id = body.assigned_washer_id
  if (body.assigned_washer_name !== undefined) updates.assigned_washer_name = body.assigned_washer_name
  if (body.wash_started_at !== undefined) updates.wash_started_at = body.wash_started_at

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
    const msg = error.message || ''
    if (msg.includes('assigned_washer') || msg.includes('wash_started_at')) {
      return NextResponse.json(
        {
          error:
            'Database missing assignment columns. Run supabase/operator_ops.sql in Supabase SQL editor.',
        },
        { status: 500 }
      )
    }
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ booking: data })
}

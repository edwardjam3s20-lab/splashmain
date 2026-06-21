import { NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabase'
import { requireOperator } from '@/lib/requireOperator'

const CAR_TYPES = ['saloon', 'suv', 'pickup', 'van', 'hatchback', 'coupe']

async function assertOwnsService(supabase, wpId, id) {
  const { data, error } = await supabase
    .from('wash_point_extras')
    .select('id, wash_point_id')
    .eq('id', id)
    .maybeSingle()
  if (error || !data) return false
  return String(data.wash_point_id) === String(wpId)
}

export async function PATCH(request, { params }) {
  const result = await requireOperator()
  if (result.error) {
    return NextResponse.json({ error: result.error }, { status: result.status })
  }

  const wpId = result.operator.wash_point_id
  if (!wpId) {
    return NextResponse.json({ error: 'No wash point linked to your account' }, { status: 400 })
  }

  const { id } = params
  const supabase = getSupabaseAdmin()

  // Make sure operators can only edit services belonging to their own wash point
  const owns = await assertOwnsService(supabase, wpId, id)
  if (!owns) {
    return NextResponse.json({ error: 'Service not found' }, { status: 404 })
  }

  const body = await request.json()
  const { name, description, price, duration, icon, prices_by_car_type } = body

  const updates = {}
  if (name !== undefined) updates.name = name
  if (description !== undefined) updates.description = description
  if (price != null) updates.price = price
  if (duration !== undefined) updates.duration = duration || null
  if (icon !== undefined) updates.icon = icon || '🚿'

  if (prices_by_car_type && typeof prices_by_car_type === 'object') {
    for (const type of CAR_TYPES) {
      const value = prices_by_car_type[type]
      // Empty string clears that car type's override back to the base price
      updates[`price_${type}`] = value === '' || value == null ? null : Number(value)
    }
  }

  const { data, error } = await supabase
    .from('wash_point_extras')
    .update(updates)
    .eq('id', id)
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ service: data })
}

export async function DELETE(_request, { params }) {
  const result = await requireOperator()
  if (result.error) {
    return NextResponse.json({ error: result.error }, { status: result.status })
  }

  const wpId = result.operator.wash_point_id
  if (!wpId) {
    return NextResponse.json({ error: 'No wash point linked to your account' }, { status: 400 })
  }

  const { id } = params
  const supabase = getSupabaseAdmin()

  const owns = await assertOwnsService(supabase, wpId, id)
  if (!owns) {
    return NextResponse.json({ error: 'Service not found' }, { status: 404 })
  }

  const { error } = await supabase.from('wash_point_extras').delete().eq('id', id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ success: true })
}

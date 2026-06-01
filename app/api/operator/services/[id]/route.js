import { NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabase'
import { requireOperator } from '@/lib/requireOperator'

async function assertServiceOwnership(supabase, id, wpId) {
  const { data, error } = await supabase
    .from('wash_point_extras')
    .select('*')
    .eq('id', id)
    .single()
  if (error || !data) return { error: 'Service not found', status: 404 }
  if (String(data.wash_point_id) !== String(wpId)) {
    return { error: 'Not allowed', status: 403 }
  }
  return { service: data }
}

export async function PATCH(request, { params }) {
  const result = await requireOperator()
  if (result.error) {
    return NextResponse.json({ error: result.error }, { status: result.status })
  }

  const wpId = result.operator.wash_point_id
  if (!wpId) {
    return NextResponse.json({ error: 'No wash point linked' }, { status: 400 })
  }

  const supabase = getSupabaseAdmin()
  const owned = await assertServiceOwnership(supabase, params.id, wpId)
  if (owned.error) {
    return NextResponse.json({ error: owned.error }, { status: owned.status })
  }

  const { name, description, price, duration, icon } = await request.json()
  const updates = {}
  if (name !== undefined) updates.name = name
  if (description !== undefined) updates.description = description
  if (price !== undefined) updates.price = price
  if (duration !== undefined) updates.duration = duration
  if (icon !== undefined) updates.icon = icon

  const { data, error } = await supabase
    .from('wash_point_extras')
    .update(updates)
    .eq('id', params.id)
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
    return NextResponse.json({ error: 'No wash point linked' }, { status: 400 })
  }

  const supabase = getSupabaseAdmin()
  const owned = await assertServiceOwnership(supabase, params.id, wpId)
  if (owned.error) {
    return NextResponse.json({ error: owned.error }, { status: owned.status })
  }

  const { error } = await supabase.from('wash_point_extras').delete().eq('id', params.id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ success: true })
}

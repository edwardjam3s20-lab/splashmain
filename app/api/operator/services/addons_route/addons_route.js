// app/api/operator/services/addons/route.js
// GET  — fetch all add-ons for this wash point
// POST — replace the full add-ons list (operator app sends the complete array)

import { NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabase'
import { requireOperator } from '@/lib/requireOperator'

export async function GET() {
  const result = await requireOperator()
  if (result.error) {
    return NextResponse.json({ error: result.error }, { status: result.status })
  }

  const wpId = result.operator.wash_point_id
  if (!wpId) {
    return NextResponse.json({ addons: [], warning: 'No wash_point_id on operator account' })
  }

  const supabase = getSupabaseAdmin()
  const { data, error } = await supabase
    .from('wash_point_extras')
    .select('*')
    .eq('wash_point_id', wpId)
    .eq('service_type', 'addon')
    .order('price', { ascending: true })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ addons: data || [] })
}

export async function POST(request) {
  const result = await requireOperator()
  if (result.error) {
    return NextResponse.json({ error: result.error }, { status: result.status })
  }

  const wpId = result.operator.wash_point_id
  if (!wpId) {
    return NextResponse.json({ error: 'No wash point linked to your account' }, { status: 400 })
  }

  const addons = await request.json()

  if (!Array.isArray(addons)) {
    return NextResponse.json({ error: 'Expected an array of add-ons' }, { status: 400 })
  }

  const supabase = getSupabaseAdmin()

  // Delete all existing add-ons for this wash point, then re-insert
  // This keeps the logic simple and matches how the operator app sends
  // the full list on every save
  const { error: deleteError } = await supabase
    .from('wash_point_extras')
    .delete()
    .eq('wash_point_id', wpId)
    .eq('service_type', 'addon')

  if (deleteError) {
    return NextResponse.json({ error: deleteError.message }, { status: 500 })
  }

  if (!addons.length) {
    return NextResponse.json({ ok: true, addons: [] })
  }

  const rows = addons.map(function(a) {
    return {
      wash_point_id: wpId,
      name:          a.name,
      description:   a.desc  || a.description || '',
      price:         a.price,
      duration:      a.duration || null,
      icon:          a.icon  || '➕',
      service_type:  'addon',
    }
  })

  const { data, error: insertError } = await supabase
    .from('wash_point_extras')
    .insert(rows)
    .select()

  if (insertError) {
    return NextResponse.json({ error: insertError.message }, { status: 500 })
  }

  return NextResponse.json({ ok: true, addons: data })
}

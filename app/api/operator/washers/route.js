import { NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabase'
import { requireOperator } from '@/lib/requireOperator'

function tableMissing(error) {
  const m = error?.message || ''
  return m.includes('wash_point_staff') || m.includes('does not exist')
}

export async function GET() {
  const result = await requireOperator()
  if (result.error) {
    return NextResponse.json({ error: result.error }, { status: result.status })
  }

  const wpId = result.operator.wash_point_id
  if (!wpId) {
    return NextResponse.json({ washers: [], useLocal: true })
  }

  const supabase = getSupabaseAdmin()
  const { data, error } = await supabase
    .from('wash_point_staff')
    .select('*')
    .eq('wash_point_id', wpId)
    .order('name')

  if (error) {
    if (tableMissing(error)) {
      return NextResponse.json({ washers: [], useLocal: true })
    }
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ washers: data || [], useLocal: false })
}

export async function POST(request) {
  const result = await requireOperator()
  if (result.error) {
    return NextResponse.json({ error: result.error }, { status: result.status })
  }

  const wpId = result.operator.wash_point_id
  if (!wpId) {
    return NextResponse.json({ error: 'No wash_point_id on account', useLocal: true }, { status: 400 })
  }

  const { name, role } = await request.json()
  if (!name?.trim()) {
    return NextResponse.json({ error: 'Name required' }, { status: 400 })
  }

  const supabase = getSupabaseAdmin()
  const { data, error } = await supabase
    .from('wash_point_staff')
    .insert({ wash_point_id: wpId, name: name.trim(), role: role || 'Washer' })
    .select()
    .single()

  if (error) {
    if (tableMissing(error)) {
      return NextResponse.json({ error: 'Run supabase/operator_ops.sql first', useLocal: true }, { status: 503 })
    }
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ washer: data })
}

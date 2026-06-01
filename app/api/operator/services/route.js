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
    return NextResponse.json({
      services: [],
      warning: 'No wash_point_id on operator account. Link in admin.',
    })
  }

  const supabase = getSupabaseAdmin()
  const { data, error } = await supabase
    .from('wash_point_extras')
    .select('*')
    .eq('wash_point_id', wpId)
    .order('price', { ascending: true })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ services: data || [] })
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

  const { name, description, price, duration, icon } = await request.json()
  if (!name || price == null) {
    return NextResponse.json({ error: 'Name and price required' }, { status: 400 })
  }

  const supabase = getSupabaseAdmin()
  const { data, error } = await supabase
    .from('wash_point_extras')
    .insert({
      wash_point_id: wpId,
      name,
      description: description || '',
      price,
      duration: duration || null,
      icon: icon || '🚿',
    })
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ service: data })
}

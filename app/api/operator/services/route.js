import { NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabase'
import { requireOperator } from '@/lib/requireOperator'

const CAR_TYPES = ['saloon', 'suv', 'pickup', 'van', 'hatchback', 'coupe']

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

  const body = await request.json()
  const { name, description, price, duration, icon, prices_by_car_type } = body

  if (!name || price == null) {
    return NextResponse.json({ error: 'Name and price required' }, { status: 400 })
  }

  const insertRow = {
    wash_point_id: wpId,
    name,
    description: description || '',
    price,
    duration: duration || null,
    icon: icon || '🚿',
  }

  // Optional per-car-type prices. Any car type left blank/omitted falls
  // back to the base `price` column at booking time.
  if (prices_by_car_type && typeof prices_by_car_type === 'object') {
    for (const type of CAR_TYPES) {
      const value = prices_by_car_type[type]
      if (value != null && value !== '') {
        insertRow[`price_${type}`] = Number(value)
      }
    }
  }

  const supabase = getSupabaseAdmin()
  const { data, error } = await supabase
    .from('wash_point_extras')
    .insert(insertRow)
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ service: data })
}

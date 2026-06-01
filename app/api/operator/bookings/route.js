import { NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabase'
import { requireOperator } from '@/lib/requireOperator'

export async function GET(request) {
  const result = await requireOperator()
  if (result.error) {
    return NextResponse.json({ error: result.error }, { status: result.status })
  }

  const { searchParams } = new URL(request.url)
  const from = searchParams.get('from')
  const to = searchParams.get('to')
  const status = searchParams.get('status')
  const date = searchParams.get('date')

  const supabase = getSupabaseAdmin()
  let query = supabase.from('bookings').select('*').order('time', { ascending: true })

  if (result.operator.wash_point) {
    query = query.eq('location', result.operator.wash_point)
  }

  if (date) {
    query = query.eq('date', date)
  } else {
    if (from) query = query.gte('date', from)
    if (to) query = query.lte('date', to)
  }

  if (status) query = query.eq('status', status)

  const { data, error } = await query
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ bookings: data || [] })
}

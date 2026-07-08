import { NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabase'
import { requireOperator } from '@/lib/requireOperator'

export async function GET(request) {
  const result = await requireOperator()
  if (result.error) {
    return NextResponse.json({ error: result.error }, { status: result.status })
  }

  const plate = new URL(request.url).searchParams.get('plate')?.trim()
  if (!plate) {
    return NextResponse.json({ error: 'Plate required' }, { status: 400 })
  }

  const supabase = getSupabaseAdmin()
  const today = new Date().toISOString().split('T')[0]

  const { data: users } = await supabase
    .from('profiles')
    .select('*')
    .ilike('plate', plate)

  if (!users?.length) {
    return NextResponse.json({ user: null, booking: null })
  }

  const user = users[0]
  let bookingQuery = supabase
    .from('bookings')
    .select('*')
    .eq('user_email', user.email)
    .eq('date', today)
    .eq('status', 'confirmed')

  if (result.operator.wash_point) {
    bookingQuery = bookingQuery.eq('location', result.operator.wash_point)
  }

  const { data: bookings } = await bookingQuery.order('time', { ascending: true }).limit(1)

  return NextResponse.json({
    user,
    booking: bookings?.[0] || null,
  })
}

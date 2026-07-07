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

  // Operators only ever need enough to confirm they're looking at the
  // right customer and find today's booking — never the whole profiles
  // row. select('*') here previously returned every column on the table
  // (including the password field) straight into the operator app's
  // network response for any plate an operator typed in.
  const supabase = getSupabaseAdmin()
  const today = new Date().toISOString().split('T')[0]

  const { data: users } = await supabase
    .from('profiles')
    .select('name, plate, email, phone')
    .ilike('plate', plate)

  if (!users?.length) {
    return NextResponse.json({ user: null, booking: null })
  }

  const user = users[0]

  // wash_point scoping must be mandatory, not conditional. If an operator
  // record is ever missing wash_point (null, bad data, migration gap),
  // the old `if (result.operator.wash_point)` check silently skipped the
  // filter entirely and returned a matching booking from ANY location.
  if (!result.operator.wash_point) {
    return NextResponse.json({ error: 'Operator has no assigned wash point' }, { status: 403 })
  }

  const { data: bookings } = await supabase
    .from('bookings')
    .select('*')
    .eq('user_email', user.email)
    .eq('date', today)
    .eq('status', 'confirmed')
    .eq('location', result.operator.wash_point)
    .order('time', { ascending: true })
    .limit(1)

  return NextResponse.json({
    user,
    booking: bookings?.[0] || null,
  })
}


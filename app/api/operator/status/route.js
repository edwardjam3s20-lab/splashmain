import { NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabase'
import { requireOperator } from '@/lib/requireOperator'

export async function PATCH(request) {
  const result = await requireOperator()
  if (result.error) {
    return NextResponse.json({ error: result.error }, { status: result.status })
  }

  const { status } = await request.json()
  if (!['open', 'paused'].includes(status)) {
    return NextResponse.json({ error: 'Status must be open or paused' }, { status: 400 })
  }

  const supabase = getSupabaseAdmin()
  const { data, error } = await supabase
    .from('operators')
    .update({ status })
    .eq('id', result.operator.id)
    .select('id,name,email,wash_point,wash_point_id,status')
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ operator: data })
}

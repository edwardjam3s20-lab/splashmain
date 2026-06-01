import { NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabase'
import { requireOperator } from '@/lib/requireOperator'
import { publicOperator } from '@/lib/operatorSession'

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
  const { error } = await supabase
    .from('operators')
    .update({ status })
    .eq('id', result.operator.id)

  if (error?.message?.includes('status') && error.message.includes('does not exist')) {
    return NextResponse.json({
      operator: publicOperator({ ...result.operator, status }),
      warning: 'Open/closed is saved on this device only until you add operators.status in Supabase.',
    })
  }

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({
    operator: publicOperator({ ...result.operator, status }),
  })
}

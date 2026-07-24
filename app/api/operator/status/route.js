import { NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabase'
import { requireOperator } from '@/lib/requireOperator'
import { publicOperator } from '@/lib/operatorSession'
import { operatorHasAccess } from '@/lib/operatorAccess'

export async function PATCH(request) {
  const result = await requireOperator()
  if (result.error) {
    return NextResponse.json({ error: result.error }, { status: result.status })
  }

  const { status } = await request.json()
  if (!['open', 'paused'].includes(status)) {
    return NextResponse.json({ error: 'Status must be open or paused' }, { status: 400 })
  }

  // Same gate as login: block going online once trial's expired without a
  // subscription. Pausing is always allowed — an expired operator can
  // still close their wash point, just not reopen it.
  if (status === 'open' && result.operator.created_at && !operatorHasAccess(result.operator)) {
    return NextResponse.json({
      error: 'Your 14-day free trial has ended. Subscribe to go back online.',
      code: 'SUBSCRIPTION_REQUIRED',
    }, { status: 402 })
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

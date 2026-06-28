import { NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabase'
import { requireOperator } from '@/lib/requireOperator'

export async function POST(request) {
  const result = await requireOperator()
  if (result.error) {
    return NextResponse.json({ error: result.error }, { status: result.status })
  }

  const subscription = await request.json().catch(() => null)
  if (!subscription?.endpoint || !subscription?.keys?.p256dh || !subscription?.keys?.auth) {
    return NextResponse.json({ error: 'Invalid subscription payload' }, { status: 400 })
  }

  const supabase = getSupabaseAdmin()
  // Upsert on endpoint: the same browser/device re-subscribing (e.g. after
  // a service worker update rotates the subscription) should replace its
  // old row, not create a duplicate.
  const { error } = await supabase.from('push_subscriptions').upsert(
    {
      operator_id: result.operator.id,
      endpoint: subscription.endpoint,
      keys: subscription.keys,
    },
    { onConflict: 'endpoint' }
  )

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ ok: true })
}

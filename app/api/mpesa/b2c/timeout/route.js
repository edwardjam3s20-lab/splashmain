import { NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabase'
import { isFromSafaricom } from '@/lib/mpesaCallbackAuth'

export async function POST(request) {
  if (!isFromSafaricom(request, 'b2c/timeout')) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const body = await request.json().catch(() => ({}))
  const result = body?.Result || body?.result || body?.Body?.Result || body
  const conversationId = result?.ConversationID || body?.ConversationID
  const originatorConversationId = result?.OriginatorConversationID || body?.OriginatorConversationID

  if (conversationId || originatorConversationId) {
    const supabase = getSupabaseAdmin()
    let query = supabase
      .from('operator_payments')
      .update({
        status: 'failed',
        mpesa_result_description: result?.ResultDesc || 'M-Pesa B2C request timed out.',
        raw_result: body,
        completed_at: new Date().toISOString(),
      })
    if (conversationId) query = query.eq('mpesa_conversation_id', conversationId)
    else query = query.eq('mpesa_originator_conversation_id', originatorConversationId)
    await query
  }

  return NextResponse.json({ ok: true })
}

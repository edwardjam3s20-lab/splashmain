import { NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabase'
import { isFromSafaricom } from '@/lib/mpesaCallbackAuth'

function callbackResult(body) {
  return body?.Result || body?.result || body?.Body?.Result || null
}

function resultParam(result, key) {
  const raw = result?.ResultParameters?.ResultParameter || []
  const params = Array.isArray(raw) ? raw : [raw]
  return params.find((p) => p.Key === key)?.Value ?? null
}

async function updatePayment(result, rawBody, statusOverride) {
  const conversationId = result?.ConversationID || null
  const originatorConversationId = result?.OriginatorConversationID || null
  if (!conversationId && !originatorConversationId) return

  const resultCode = Number(result?.ResultCode)
  const status = statusOverride || (resultCode === 0 ? 'completed' : 'failed')
  const supabase = getSupabaseAdmin()
  const receipt = resultParam(result, 'TransactionReceipt')
  const updates = {
    status,
    mpesa_result_code: Number.isFinite(resultCode) ? resultCode : null,
    mpesa_result_description: result?.ResultDesc || null,
    mpesa_transaction_id: receipt,
    raw_result: rawBody,
    completed_at: new Date().toISOString(),
  }
  if (receipt) updates.reference = receipt

  let query = supabase.from('operator_payments').update(updates)

  if (conversationId) query = query.eq('mpesa_conversation_id', conversationId)
  else query = query.eq('mpesa_originator_conversation_id', originatorConversationId)

  await query
}

export async function POST(request) {
  if (!isFromSafaricom(request, 'b2c/result')) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const body = await request.json().catch(() => ({}))
  const result = callbackResult(body)
  await updatePayment(result, body)
  return NextResponse.json({ ok: true })
}

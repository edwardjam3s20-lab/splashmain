import { NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabase'
import { getSession } from '@/lib/session'
import { initiateB2CPayment, normalizeMpesaPhone } from '@/lib/mpesaB2c'

export async function GET() {
  const session = await getSession()
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const supabase = getSupabaseAdmin()
  const { data, error } = await supabase
    .from('operator_payments')
    .select('*')
    .order('paid_at', { ascending: false })

  if (error) {
    return NextResponse.json({ error: error.message, code: error.code, details: error.details, hint: error.hint }, { status: 500 })
  }

  return NextResponse.json({ payments: data || [] })
}

export async function POST(request) {
  const session = await getSession()
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const body = await request.json()
  const {
    wash_point,
    operator_name,
    operator_id,
    operator_phone,
    amount,
    method,
    reference,
    notes,
  } = body

  if (!wash_point || !amount) {
    return NextResponse.json({ error: 'Wash point and amount are required.' }, { status: 400 })
  }

  const payAmount = Math.round(Number(amount))
  if (payAmount <= 0) {
    return NextResponse.json({ error: 'Amount must be greater than zero.' }, { status: 400 })
  }

  const supabase = getSupabaseAdmin()
  const payMethod = method || 'mpesa'
  const shouldSendMpesa = payMethod === 'mpesa'
  const normalPhone = shouldSendMpesa ? normalizeMpesaPhone(operator_phone) : normalizeMpesaPhone(operator_phone) || null

  if (shouldSendMpesa && !normalPhone) {
    return NextResponse.json({ error: 'A valid operator M-Pesa phone number is required.' }, { status: 400 })
  }

  const row = {
    wash_point,
    operator_name: operator_name || null,
    operator_phone: normalPhone,
    amount: payAmount,
    method: payMethod,
    reference: reference || null,
    notes: notes || null,
    status: shouldSendMpesa ? 'pending' : 'manual',
    requested_by: session.email || null,
    initiated_at: new Date().toISOString(),
    paid_at: new Date().toISOString(),
  }
  if (operator_id) row.operator_id = operator_id

  const { data, error } = await supabase.from('operator_payments').insert(row).select().single()

  if (error) {
    return NextResponse.json({ error: error.message, code: error.code, details: error.details, hint: error.hint }, { status: 500 })
  }

  if (!shouldSendMpesa) {
    return NextResponse.json({ payment: data })
  }

  try {
    const payout = await initiateB2CPayment({
      amount: payAmount,
      phone: normalPhone,
      paymentId: data.id,
      remarks: notes || `SplashPass payout to ${operator_name || wash_point}`,
      request,
    })

    const { data: updated, error: updateError } = await supabase
      .from('operator_payments')
      .update({
        status: 'submitted',
        operator_phone: payout.phone,
        mpesa_conversation_id: payout.conversationId,
        mpesa_originator_conversation_id: payout.originatorConversationId,
        mpesa_response_code: payout.responseCode,
        mpesa_response_description: payout.responseDescription,
        raw_response: payout.response,
      })
      .eq('id', data.id)
      .select()
      .single()

    if (updateError) {
      return NextResponse.json({ payment: data, warning: updateError.message }, { status: 202 })
    }

    return NextResponse.json({ payment: updated, payoutSubmitted: true }, { status: 202 })
  } catch (e) {
    await supabase
      .from('operator_payments')
      .update({
        status: 'failed',
        mpesa_response_description: e.message,
        completed_at: new Date().toISOString(),
      })
      .eq('id', data.id)

    return NextResponse.json({ error: e.message, payment: { ...data, status: 'failed' } }, { status: 502 })
  }
}

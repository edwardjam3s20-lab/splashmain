import { NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabase'
import { getSession } from '@/lib/session'

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
    if (error.message?.includes('operator_payments')) {
      return NextResponse.json({ payments: [], tableMissing: true })
    }
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ payments: data || [] })
}

export async function POST(request) {
  const session = await getSession()
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const body = await request.json()
  const { wash_point, operator_name, operator_id, amount, method, reference, notes } = body

  if (!wash_point || !amount) {
    return NextResponse.json({ error: 'Wash point and amount are required.' }, { status: 400 })
  }

  const payAmount = Math.round(Number(amount))
  if (payAmount <= 0) {
    return NextResponse.json({ error: 'Amount must be greater than zero.' }, { status: 400 })
  }

  const supabase = getSupabaseAdmin()
  const row = {
    wash_point,
    operator_name: operator_name || null,
    amount: payAmount,
    method: method || 'mpesa',
    reference: reference || null,
    notes: notes || null,
    paid_at: new Date().toISOString(),
  }
  if (operator_id) row.operator_id = operator_id

  const { data, error } = await supabase.from('operator_payments').insert(row).select().single()

  if (error) {
    if (error.message?.includes('operator_payments')) {
      return NextResponse.json(
        {
          error:
            'operator_payments table missing. Run supabase/operator_commission.sql in Supabase.',
        },
        { status: 500 }
      )
    }
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ payment: data })
}

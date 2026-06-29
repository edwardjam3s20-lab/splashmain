// app/api/operator/wash-point-hours/route.js
// GET  — returns the operator's own wash point's opens_at/closes_at
// PATCH — updates them
// Body for PATCH: { opens_at: "07:00", closes_at: "21:00" }

import { NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabase'
import { requireOperator } from '@/lib/requireOperator'

const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/

export async function GET() {
  const result = await requireOperator()
  if (result.error) {
    return NextResponse.json({ error: result.error }, { status: result.status })
  }

  if (!result.operator.wash_point_id) {
    return NextResponse.json({ error: 'No wash point linked to your account' }, { status: 400 })
  }

  const supabase = getSupabaseAdmin()
  const { data, error } = await supabase
    .from('wash_points')
    .select('opens_at, closes_at')
    .eq('id', result.operator.wash_point_id)
    .single()

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json(data)
}

export async function PATCH(request) {
  const result = await requireOperator()
  if (result.error) {
    return NextResponse.json({ error: result.error }, { status: result.status })
  }

  if (!result.operator.wash_point_id) {
    return NextResponse.json({ error: 'No wash point linked to your account' }, { status: 400 })
  }

  const body = await request.json().catch(() => null)
  const opensAt = body?.opens_at
  const closesAt = body?.closes_at

  if (!opensAt || !closesAt || !TIME_RE.test(opensAt) || !TIME_RE.test(closesAt)) {
    return NextResponse.json({ error: 'opens_at and closes_at must be HH:MM (24-hour)' }, { status: 400 })
  }
  if (closesAt <= opensAt) {
    return NextResponse.json({ error: 'closes_at must be after opens_at' }, { status: 400 })
  }

  const supabase = getSupabaseAdmin()
  const { data, error } = await supabase
    .from('wash_points')
    .update({ opens_at: opensAt, closes_at: closesAt })
    .eq('id', result.operator.wash_point_id)
    .select('opens_at, closes_at')
    .single()

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json(data)
}

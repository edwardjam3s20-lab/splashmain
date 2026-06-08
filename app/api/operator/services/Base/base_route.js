// app/api/operator/services/base/route.js
// GET  — fetch this wash point's base prices
// POST — upsert base prices (creates or replaces the single row)

import { NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabase'
import { requireOperator } from '@/lib/requireOperator'

export async function GET() {
  const result = await requireOperator()
  if (result.error) {
    return NextResponse.json({ error: result.error }, { status: result.status })
  }

  const wpId = result.operator.wash_point_id
  if (!wpId) {
    return NextResponse.json({ error: 'No wash point linked to your account' }, { status: 400 })
  }

  const supabase = getSupabaseAdmin()
  const { data, error } = await supabase
    .from('wash_point_base_prices')
    .select('*')
    .eq('wash_point_id', wpId)
    .maybeSingle()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // Return structured object the operator app expects
  const row = data || {}
  return NextResponse.json({
    base: {
      wash: {
        saloon:    row.wash_saloon    ?? null,
        suv:       row.wash_suv       ?? null,
        pickup:    row.wash_pickup    ?? null,
        hatchback: row.wash_hatchback ?? null,
      },
      interior: {
        saloon:    row.interior_saloon    ?? null,
        suv:       row.interior_suv       ?? null,
        pickup:    row.interior_pickup    ?? null,
        hatchback: row.interior_hatchback ?? null,
      },
    }
  })
}

export async function POST(request) {
  const result = await requireOperator()
  if (result.error) {
    return NextResponse.json({ error: result.error }, { status: result.status })
  }

  const wpId = result.operator.wash_point_id
  if (!wpId) {
    return NextResponse.json({ error: 'No wash point linked to your account' }, { status: 400 })
  }

  const body = await request.json()
  const { wash, interior } = body

  if (!wash || !interior) {
    return NextResponse.json({ error: 'wash and interior price objects required' }, { status: 400 })
  }

  const supabase = getSupabaseAdmin()

  // Upsert — one row per wash point, replace on conflict
  const { data, error } = await supabase
    .from('wash_point_base_prices')
    .upsert({
      wash_point_id:      wpId,
      wash_saloon:        wash.saloon    || null,
      wash_suv:           wash.suv       || null,
      wash_pickup:        wash.pickup    || null,
      wash_hatchback:     wash.hatchback || null,
      interior_saloon:    interior.saloon    || null,
      interior_suv:       interior.suv       || null,
      interior_pickup:    interior.pickup    || null,
      interior_hatchback: interior.hatchback || null,
      updated_at:         new Date().toISOString(),
    }, {
      onConflict: 'wash_point_id',
    })
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true, data })
}

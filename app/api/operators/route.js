import { NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabase'
import { getSession } from '@/lib/session'
import { hashOperatorPassword } from '@/lib/operatorPassword'
import { normalizeCommissionTier } from '@/lib/commission'

export async function POST(request) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (session.role !== 'admin') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { name, email, password, wash_point, wash_point_id, commission_tier, mpesa_phone } = await request.json()
  if (!name || !email || !password || !wash_point) {
    return NextResponse.json({ error: 'All fields required.' }, { status: 400 })
  }

  const supabase = getSupabaseAdmin()

  let resolvedWashPointId = wash_point_id || null
  if (!resolvedWashPointId && wash_point) {
    const { data: wp } = await supabase.from('wash_points').select('id').eq('name', wash_point).maybeSingle()
    if (wp) resolvedWashPointId = wp.id
  }

  // Check for duplicate email
  const { data: existing } = await supabase
    .from('operators')
    .select('email')
    .eq('email', email.toLowerCase())
    .maybeSingle()

  if (existing) {
    return NextResponse.json({ error: 'An operator with this email already exists.' }, { status: 400 })
  }

  const hashedPassword = hashOperatorPassword(password)
  const insertRow = {
    name,
    email: email.toLowerCase(),
    password: hashedPassword,
    wash_point,
  }
  if (resolvedWashPointId) insertRow.wash_point_id = resolvedWashPointId
  if (commission_tier != null) insertRow.commission_tier = normalizeCommissionTier(commission_tier)
  if (mpesa_phone) insertRow.mpesa_phone = String(mpesa_phone).trim()

  let { data, error } = await supabase.from('operators').insert(insertRow).select().single()

  if (
    error?.message?.includes('wash_point_id') ||
    error?.message?.includes('commission_tier') ||
    error?.message?.includes('mpesa_phone')
  ) {
    delete insertRow.wash_point_id
    delete insertRow.commission_tier
    delete insertRow.mpesa_phone
    const retry = await supabase.from('operators').insert(insertRow).select().single()
    data = retry.data
    error = retry.error
  }

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ operator: data })
}

export async function PATCH(request) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (session.role !== 'admin') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { id, password, wash_point, wash_point_id, commission_tier, mpesa_phone } = await request.json()
  if (!id) {
    return NextResponse.json({ error: 'Operator id required.' }, { status: 400 })
  }
  if (!password && !wash_point && commission_tier == null && mpesa_phone === undefined) {
    return NextResponse.json({
      error: 'Provide a new password, wash point, commission tier, or M-Pesa phone to update.',
    }, { status: 400 })
  }

  const supabase = getSupabaseAdmin()
  const updates = {}

  if (password) {
    if (String(password).length < 6) {
      return NextResponse.json({ error: 'Password must be at least 6 characters.' }, { status: 400 })
    }
    updates.password = hashOperatorPassword(password)
  }

  if (wash_point) {
    updates.wash_point = wash_point
    let resolvedWashPointId = wash_point_id || null
    if (!resolvedWashPointId) {
      const { data: wp } = await supabase
        .from('wash_points')
        .select('id')
        .eq('name', wash_point)
        .maybeSingle()
      if (wp) resolvedWashPointId = wp.id
    }
    if (resolvedWashPointId) updates.wash_point_id = resolvedWashPointId
  }

  if (commission_tier != null) {
    updates.commission_tier = normalizeCommissionTier(commission_tier)
  }

  if (mpesa_phone !== undefined) {
    updates.mpesa_phone = String(mpesa_phone || '').trim() || null
  }

  let { data, error } = await supabase
    .from('operators')
    .update(updates)
    .eq('id', id)
    .select()
    .single()

  if (error?.message?.includes('wash_point_id') && updates.wash_point_id) {
    delete updates.wash_point_id
    const retry = await supabase.from('operators').update(updates).eq('id', id).select().single()
    data = retry.data
    error = retry.error
  }
  if (error?.message?.includes('commission_tier') && updates.commission_tier != null) {
    delete updates.commission_tier
    const retry = await supabase.from('operators').update(updates).eq('id', id).select().single()
    data = retry.data
    error = retry.error
  }
  if (error?.message?.includes('mpesa_phone') && updates.mpesa_phone !== undefined) {
    delete updates.mpesa_phone
    const retry = await supabase.from('operators').update(updates).eq('id', id).select().single()
    data = retry.data
    error = retry.error
  }

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ success: true, operator: data })
}

export async function DELETE(request) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (session.role !== 'admin') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { id } = await request.json()
  if (!id) return NextResponse.json({ error: 'ID required.' }, { status: 400 })

  const supabase = getSupabaseAdmin()
  const { error } = await supabase.from('operators').delete().eq('id', id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ success: true })
}

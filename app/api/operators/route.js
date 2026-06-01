import { NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabase'
import { getSession } from '@/lib/session'
import { hashOperatorPassword } from '@/lib/operatorPassword'

export async function POST(request) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { name, email, password, wash_point, wash_point_id } = await request.json()
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

  let { data, error } = await supabase.from('operators').insert(insertRow).select().single()

  if (error?.message?.includes('wash_point_id')) {
    delete insertRow.wash_point_id
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

  const { id, password } = await request.json()
  if (!id || !password) {
    return NextResponse.json({ error: 'Operator id and new password required.' }, { status: 400 })
  }

  const supabase = getSupabaseAdmin()
  const hashedPassword = hashOperatorPassword(password)
  const { error } = await supabase
    .from('operators')
    .update({ password: hashedPassword })
    .eq('id', id)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ success: true })
}

export async function DELETE(request) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await request.json()
  if (!id) return NextResponse.json({ error: 'ID required.' }, { status: 400 })

  const supabase = getSupabaseAdmin()
  const { error } = await supabase.from('operators').delete().eq('id', id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ success: true })
}

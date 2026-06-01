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
    const { data: wp } = await supabase.from('wash_points').select('id').eq('name', wash_point).single()
    if (wp) resolvedWashPointId = wp.id
  }

  // Check for duplicate email in profiles and operators
  const { data: existing } = await supabase
    .from('operators')
    .select('email')
    .eq('email', email.toLowerCase())
    .single()

  if (existing) {
    return NextResponse.json({ error: 'An operator with this email already exists.' }, { status: 400 })
  }

  // Hash the password server-side before storing
  const hashedPassword = hashOperatorPassword(password)

  const { data, error } = await supabase
    .from('operators')
    .insert({
      name,
      email: email.toLowerCase(),
      password: hashedPassword,
      wash_point,
      wash_point_id: resolvedWashPointId,
    })
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ operator: data })
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

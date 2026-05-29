import { NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabase'
import { getSession } from '@/lib/session'
import { hash } from 'crypto'

export async function POST(request) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { name, email, password, wash_point } = await request.json()
  if (!name || !email || !password || !wash_point) {
    return NextResponse.json({ error: 'All fields required.' }, { status: 400 })
  }

  const supabase = getSupabaseAdmin()

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
  const hashedPassword = hash('sha256', password + process.env.SESSION_SECRET)

  const { data, error } = await supabase
    .from('operators')
    .insert({ name, email: email.toLowerCase(), password: hashedPassword, wash_point })
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

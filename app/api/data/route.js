import { NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabase'
import { getSession } from '@/lib/session'

export async function GET() {
  const session = await getSession()
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  if (session.role !== 'admin') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const supabase = getSupabaseAdmin()

  const [
    { data: operators },
    { data: subscribers },
    { data: bookings },
    { data: washPoints }
  ] = await Promise.all([
    supabase.from('operators').select('*').order('created_at', { ascending: false }),
    supabase.from('profiles').select('*').order('created_at', { ascending: false }),
    supabase.from('bookings').select('*'),
    supabase.from('wash_points').select('*').order('name')
  ])

  return NextResponse.json({
    operators: operators || [],
    subscribers: subscribers || [],
    bookings: bookings || [],
    washPoints: washPoints || []
  })
}

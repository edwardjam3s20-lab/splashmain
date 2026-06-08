// app/api/loyalty/transactions/route.js
// GET — paginated point_ledger for the loyalty hub screen
// Query params: ?limit=20&offset=0

import { NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabase'
import { getSession } from '@/lib/session'

export async function GET(request) {
  const session = await getSession()
  if (!session) {
    return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })
  }

  const email  = session.email
  const { searchParams } = new URL(request.url)
  const limit  = Math.min(parseInt(searchParams.get('limit')  || '20'), 50)
  const offset = parseInt(searchParams.get('offset') || '0')

  const supabase = getSupabaseAdmin()

  const { data, error, count } = await supabase
    .from('point_ledger')
    .select('id, delta, reason, status, created_at', { count: 'exact' })
    .eq('user_email', email)
    .in('status', ['confirmed', 'escrowed'])
    .order('created_at', { ascending: false })
    .range(offset, offset + limit - 1)

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({
    transactions: data || [],
    total:        count || 0,
    limit,
    offset,
  })
}

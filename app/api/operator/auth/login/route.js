import { NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabase'
import { checkRateLimit, resetRateLimit } from '@/lib/rateLimit'
import { verifyOperatorPassword } from '@/lib/operatorPassword'
import {
  createOperatorSession,
  setOperatorSessionCookie,
  publicOperator,
} from '@/lib/operatorSession'

export async function POST(request) {
  const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown'
  const limit = checkRateLimit(`op:${ip}`)
  if (!limit.allowed) {
    return NextResponse.json(
      { error: `Too many attempts. Try again in ${limit.retryAfter}s.` },
      { status: 429 }
    )
  }

  const { email, password } = await request.json()
  if (!email || !password) {
    return NextResponse.json({ error: 'Email and password required.' }, { status: 400 })
  }

  const supabase = getSupabaseAdmin()
  const { data: op, error } = await supabase
    .from('operators')
    .select('id,name,email,password,wash_point,wash_point_id,status')
    .eq('email', email.toLowerCase())
    .single()

  if (error || !op || !verifyOperatorPassword(password, op.password)) {
    return NextResponse.json({ error: 'Invalid credentials.' }, { status: 401 })
  }

  resetRateLimit(`op:${ip}`)

  const token = await createOperatorSession({
    operatorId: op.id,
    email: op.email,
    name: op.name,
    wash_point: op.wash_point,
    wash_point_id: op.wash_point_id ?? null,
  })

  const res = NextResponse.json({ operator: publicOperator(op) })
  setOperatorSessionCookie(res, token)
  return res
}

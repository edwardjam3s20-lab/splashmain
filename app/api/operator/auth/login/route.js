import { NextResponse } from 'next/server'
import { checkRateLimit, resetRateLimit } from '@/lib/rateLimit'
import {
  verifyOperatorPassword,
  hashOperatorPassword,
  isPlaintextPassword,
} from '@/lib/operatorPassword'
import { loadOperatorByEmail } from '@/lib/loadOperator'
import { getSupabaseAdmin } from '@/lib/supabase'
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
  const normalizedEmail = String(email || '').toLowerCase().trim()
  const normalizedPassword = String(password || '').trim()

  if (!normalizedEmail || !normalizedPassword) {
    return NextResponse.json({ error: 'Email and password required.' }, { status: 400 })
  }

  const { op, error: loadError } = await loadOperatorByEmail(normalizedEmail)
  if (loadError) {
    console.error('[operator login] load error:', loadError.message)
    return NextResponse.json({ error: 'Could not sign in. Try again.' }, { status: 500 })
  }
  if (!op) {
    const supabase = getSupabaseAdmin()
    const { data: profile } = await supabase
      .from('profiles')
      .select('email')
      .eq('email', normalizedEmail)
      .maybeSingle()

    if (profile) {
      return NextResponse.json({
        error:
          'This email is for the customer app, not the operator console. Ask admin to add you as an operator (or use a different operator email).',
      }, { status: 401 })
    }

    return NextResponse.json({
      error: 'No operator account for this email. Ask admin to add you under Operators.',
    }, { status: 401 })
  }

  if (!verifyOperatorPassword(normalizedPassword, op.password)) {
    const supabase = getSupabaseAdmin()
    const { data: profile } = await supabase
      .from('profiles')
      .select('password')
      .eq('email', normalizedEmail)
      .maybeSingle()

    if (profile?.password === normalizedPassword) {
      return NextResponse.json({
        error:
          'That is your customer app password. Operator login uses a separate password — ask admin to click “Reset password” on your operator card.',
      }, { status: 401 })
    }

    return NextResponse.json({
      error:
        'Wrong operator password. In Admin → Operators → “Reset password”, set a new one, then try again.',
    }, { status: 401 })
  }

  if (isPlaintextPassword(op.password)) {
    const supabase = getSupabaseAdmin()
    await supabase
      .from('operators')
      .update({ password: hashOperatorPassword(normalizedPassword) })
      .eq('id', op.id)
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

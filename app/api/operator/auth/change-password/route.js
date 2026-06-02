import { NextResponse } from 'next/server'
import { checkRateLimit } from '@/lib/rateLimit'
import { requireOperator } from '@/lib/requireOperator'
import { verifyOperatorPassword, hashOperatorPassword } from '@/lib/operatorPassword'
import { getSupabaseAdmin } from '@/lib/supabase'

export async function POST(request) {
  const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown'
  const limit = checkRateLimit(`op-pw:${ip}`)
  if (!limit.allowed) {
    return NextResponse.json(
      { error: `Too many attempts. Try again in ${limit.retryAfter}s.` },
      { status: 429 }
    )
  }

  const auth = await requireOperator()
  if (auth.error) {
    return NextResponse.json({ error: auth.error }, { status: auth.status })
  }

  const { currentPassword, newPassword } = await request.json()
  const current = String(currentPassword || '').trim()
  const next = String(newPassword || '').trim()

  if (!current || !next) {
    return NextResponse.json({ error: 'Current and new password are required.' }, { status: 400 })
  }
  if (next.length < 6) {
    return NextResponse.json({ error: 'New password must be at least 6 characters.' }, { status: 400 })
  }
  if (current === next) {
    return NextResponse.json({ error: 'Choose a different password than your current one.' }, { status: 400 })
  }

  const op = auth.operator
  if (!verifyOperatorPassword(current, op.password)) {
    return NextResponse.json({ error: 'Current password is incorrect.' }, { status: 401 })
  }

  const supabase = getSupabaseAdmin()
  const { error } = await supabase
    .from('operators')
    .update({ password: hashOperatorPassword(next) })
    .eq('id', op.id)

  if (error) {
    console.error('[operator change-password]', error.message)
    return NextResponse.json({ error: 'Could not update password.' }, { status: 500 })
  }

  return NextResponse.json({ success: true })
}

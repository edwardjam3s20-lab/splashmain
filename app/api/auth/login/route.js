import { NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabase'
import { checkRateLimit } from '@/lib/rateLimit'

export async function POST(request) {
  // Rate limiting
  const ip = request.headers.get('x-forwarded-for') || 'unknown'
  const limit = checkRateLimit(ip)
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

  // Authenticate with Supabase Auth
  const { data: authData, error: authError } = await supabase.auth.signInWithPassword({
    email, password
  })

  if (authError || !authData?.session) {
    return NextResponse.json({ error: 'Incorrect email or password.' }, { status: 401 })
  }

  const pendingToken = authData.session.access_token

  // Always send an email 2FA code — no TOTP setup needed
  return NextResponse.json({
    pendingToken,
    email
  })
}

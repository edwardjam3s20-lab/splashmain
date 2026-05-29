import { NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabase'
import { verifyToken } from '@/lib/totp'
import { createSession, setSessionCookie } from '@/lib/session'
import { resetRateLimit } from '@/lib/rateLimit'

export async function POST(request) {
  const { email, pendingToken, code } = await request.json()

  if (!email || !pendingToken || !code) {
    return NextResponse.json({ error: 'Missing required fields.' }, { status: 400 })
  }

  const supabase = getSupabaseAdmin()

  // Verify the pending token is valid
  const { data: userData, error } = await supabase.auth.getUser(pendingToken)
  if (error || !userData?.user || userData.user.email !== email) {
    return NextResponse.json({ error: 'Invalid session. Please log in again.' }, { status: 401 })
  }

  // Fetch secret server-side — never sent to browser
  const { data: tfaRow, error: tfaError } = await supabase
    .from('admin_2fa')
    .select('secret')
    .eq('email', email)
    .single()

  if (tfaError || !tfaRow) {
    return NextResponse.json({ error: '2FA not set up for this account.' }, { status: 400 })
  }

  const valid = verifyToken(code, tfaRow.secret)
  if (!valid) {
    return NextResponse.json({ error: 'Incorrect code. Check your authenticator app.' }, { status: 400 })
  }

  // Clear rate limit on success
  const ip = request.headers.get('x-forwarded-for') || 'unknown'
  resetRateLimit(ip)

  // Create session cookie
  const sessionToken = await createSession({ email, accessToken: pendingToken })
  const res = NextResponse.json({ success: true })
  setSessionCookie(res, sessionToken)
  return res
}

import { NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabase'
import { createSession, setSessionCookie } from '@/lib/session'
import { resetRateLimit } from '@/lib/rateLimit'

export async function POST(request) {
  const { email, pendingToken, code } = await request.json()

  if (!email || !pendingToken || !code) {
    return NextResponse.json({ error: 'Missing required fields.' }, { status: 400 })
  }

  const supabase = getSupabaseAdmin()

  // Verify the pending token
  const { data: userData, error } = await supabase.auth.getUser(pendingToken)
  if (error || !userData?.user || userData.user.email !== email) {
    return NextResponse.json({ error: 'Invalid session. Please log in again.' }, { status: 401 })
  }

  // Fetch the stored code
  const { data: tfaRow } = await supabase
    .from('admin_2fa')
    .select('code, code_expires_at')
    .eq('email', email)
    .single()

  if (!tfaRow || !tfaRow.code) {
    return NextResponse.json({ error: 'No code found. Please request a new one.' }, { status: 400 })
  }

  // Check expiry
  if (new Date() > new Date(tfaRow.code_expires_at)) {
    return NextResponse.json({ error: 'Code expired. Please log in again to get a new code.' }, { status: 400 })
  }

  // Check code match
  if (code.trim() !== tfaRow.code) {
    return NextResponse.json({ error: 'Incorrect code. Please try again.' }, { status: 400 })
  }

  // Clear the used code
  await supabase
    .from('admin_2fa')
    .update({ code: null, code_expires_at: null })
    .eq('email', email)

  // Clear rate limit and create session
  const ip = request.headers.get('x-forwarded-for') || 'unknown'
  resetRateLimit(ip)

  const sessionToken = await createSession({ email, accessToken: pendingToken })
  const res = NextResponse.json({ success: true })
  setSessionCookie(res, sessionToken)
  return res
}

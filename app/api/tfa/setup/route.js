import { NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabase'
import { generateSecret, getOtpAuthUrl, verifyToken } from '@/lib/totp'
import { createSession, setSessionCookie } from '@/lib/session'
import QRCode from 'qrcode'

export async function POST(request) {
  const { action, email, pendingToken, code, secret } = await request.json()

  if (!email || !pendingToken) {
    return NextResponse.json({ error: 'Invalid request.' }, { status: 400 })
  }

  // Verify the pending token is valid with Supabase
  const supabase = getSupabaseAdmin()
  const { data: userData, error } = await supabase.auth.getUser(pendingToken)
  if (error || !userData?.user || userData.user.email !== email) {
    return NextResponse.json({ error: 'Invalid session. Please log in again.' }, { status: 401 })
  }

  if (action === 'generate') {
    // Generate a new secret and QR code
    const newSecret = generateSecret()
    const otpUrl = getOtpAuthUrl(email, newSecret)
    const qrDataUrl = await QRCode.toDataURL(otpUrl)
    return NextResponse.json({ secret: newSecret, qrDataUrl })
  }

  if (action === 'confirm') {
    // Verify the code against the secret
    if (!code || !secret) {
      return NextResponse.json({ error: 'Code and secret required.' }, { status: 400 })
    }
    const valid = verifyToken(code, secret)
    if (!valid) {
      return NextResponse.json({ error: 'Incorrect code. Try again.' }, { status: 400 })
    }

    // Save secret to Supabase server-side
    const { error: saveError } = await supabase
      .from('admin_2fa')
      .upsert({ email, secret }, { onConflict: 'email' })

    if (saveError) {
      return NextResponse.json({ error: 'Failed to save 2FA secret.' }, { status: 500 })
    }

    // Create session cookie
    const sessionToken = await createSession({ email, accessToken: pendingToken })
    const res = NextResponse.json({ success: true })
    setSessionCookie(res, sessionToken)
    return res
  }

  return NextResponse.json({ error: 'Unknown action.' }, { status: 400 })
}

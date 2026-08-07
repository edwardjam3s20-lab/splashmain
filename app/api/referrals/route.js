// app/api/referrals/route.js
// GET — the current user's referral code, plus how many people they've
// referred (email-verified, i.e. bonus already paid) and points earned
// from referrals. Powers the "Refer a Friend" sheet in the customer app.

import { NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabase'
import { getSession } from '@/lib/session'
import { REFERRAL_BONUS_POINTS } from '@/lib/referralCode'

const CUSTOMER_APP_ORIGINS = new Set([
  'http://localhost:5173',
  'https://splashpass-react.vercel.app',
  'https://splashpass.site',
  'https://www.splashpass.site',
  'https://app.splashpass.site',
])

function corsHeaders(origin) {
  const allowOrigin = CUSTOMER_APP_ORIGINS.has(origin) ? origin : ''
  return {
    'Access-Control-Allow-Origin': allowOrigin,
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Credentials': 'true',
    'Vary': 'Origin',
    'Cache-Control': 'no-store',
  }
}

export async function OPTIONS(request) {
  const origin = request.headers.get('origin') || ''
  return new NextResponse(null, { status: 200, headers: corsHeaders(origin) })
}

export async function GET(request) {
  const origin = request.headers.get('origin') || ''

  const session = await getSession()
  if (!session) {
    return NextResponse.json({ error: 'Unauthorised' }, { status: 401, headers: corsHeaders(origin) })
  }

  const supabase = getSupabaseAdmin()

  const { data: profile, error: profileError } = await supabase
    .from('profiles')
    .select('referral_code')
    .eq('email', session.email)
    .single()

  if (profileError || !profile?.referral_code) {
    // Older accounts created before this migration ran will have a null
    // referral_code until the backfill in 010_referrals.sql is applied.
    return NextResponse.json(
      { error: 'Referral code not available yet. Try again shortly.' },
      { status: 404, headers: corsHeaders(origin) }
    )
  }

  const { count: referralCount } = await supabase
    .from('profiles')
    .select('id', { count: 'exact', head: true })
    .eq('referred_by_code', profile.referral_code)
    .eq('referral_bonus_awarded', true)

  return NextResponse.json({
    referral_code:   profile.referral_code,
    referral_count:  referralCount || 0,
    points_earned:   (referralCount || 0) * REFERRAL_BONUS_POINTS,
    bonus_per_referral: REFERRAL_BONUS_POINTS,
  }, { headers: corsHeaders(origin) })
}

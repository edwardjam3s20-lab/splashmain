// app/api/loyalty/status/route.js
// GET — returns tier, points balance, next tier threshold,
//        tier discount %, and active redemptions for the current user

import { NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabase'
import { getSession } from '@/lib/session'

const ALLOWED_ORIGIN = process.env.CUSTOMER_APP_ORIGIN || 'https://splashpass-react-poc.vercel.app'

function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': ALLOWED_ORIGIN,
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Credentials': 'true',
  }
}

export async function OPTIONS() {
  return new NextResponse(null, { status: 200, headers: corsHeaders() })
}

const TIERS = [
  { name: 'Bronze',   min: 0,    max: 499,  discount_addon: 0,  discount_premium: 0  },
  { name: 'Silver',   min: 500,  max: 1499, discount_addon: 5,  discount_premium: 0  },
  { name: 'Gold',     min: 1500, max: 3999, discount_addon: 10, discount_premium: 10 },
  { name: 'Platinum', min: 4000, max: null, discount_addon: 15, discount_premium: 15 },
]

function getTierInfo(points) {
  const tier = TIERS.find(t => points >= t.min && (t.max === null || points <= t.max))
    || TIERS[0]
  const next = TIERS[TIERS.indexOf(tier) + 1] || null
  return {
    tier:              tier.name,
    discount_addon:    tier.discount_addon,
    discount_premium:  tier.discount_premium,
    next_tier:         next ? next.name : null,
    next_tier_at:      next ? next.min  : null,
    points_to_next:    next ? Math.max(0, next.min - points) : 0,
  }
}

export async function GET() {
  const session = await getSession()
  if (!session) {
    return NextResponse.json({ error: 'Unauthorised' }, { status: 401, headers: corsHeaders() })
  }

  const email = session.email
  const supabase = getSupabaseAdmin()

  const { data: profile, error: profileError } = await supabase
    .from('profiles')
    .select('loyalty_points, loyalty_tier, name')
    .eq('email', email)
    .single()

  if (profileError) {
    return NextResponse.json({ error: profileError.message }, { status: 500, headers: corsHeaders() })
  }

  const points   = profile.loyalty_points || 0
  const tierInfo = getTierInfo(points)

  const { data: redemptions } = await supabase
    .from('redemptions')
    .select('id, redemption_type, points_spent, expires_at, metadata, created_at')
    .eq('user_email', email)
    .eq('status', 'active')
    .order('created_at', { ascending: false })

  return NextResponse.json({
    points,
    tier:             tierInfo.tier,
    discount_addon:   tierInfo.discount_addon,
    discount_premium: tierInfo.discount_premium,
    next_tier:        tierInfo.next_tier,
    next_tier_at:     tierInfo.next_tier_at,
    points_to_next:   tierInfo.points_to_next,
    active_redemptions: redemptions || [],
  }, { headers: corsHeaders() })
}

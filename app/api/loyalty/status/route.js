// app/api/loyalty/status/route.js
// GET — returns tier, points balance, next tier threshold,
//        tier discount %, and active redemptions for the current user

import { NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabase'
import { getSession } from '@/lib/session'

// SECURITY/BUGFIX: this used to be a single hardcoded string
// (CUSTOMER_APP_ORIGIN || the old splashpass-react.vercel.app URL), so it
// always echoed back one fixed value regardless of which origin actually
// made the request. Once the customer app moved to app.splashpass.site,
// every request from there got a mismatched Access-Control-Allow-Origin
// and the browser blocked it. Mirrors the OPERATOR_REACT_ORIGINS allowlist
// pattern in middleware.js and the fix already applied in
// api/auth/login/route.js: check the request's Origin against a known
// set, and only echo it back if it's on the list.
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
    // Multiple origins share this route, so the response MUST vary by
    // Origin -- otherwise a CDN/edge cache can serve one origin's
    // response back to a different origin.
    'Vary': 'Origin',
    'Cache-Control': 'no-store',
  }
}

export async function OPTIONS(request) {
  const origin = request.headers.get('origin') || ''

  return new NextResponse(null, { status: 200, headers: corsHeaders(origin) })
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

export async function GET(request) {
  const origin = request.headers.get('origin') || ''

  const session = await getSession()
  if (!session) {
    return NextResponse.json({ error: 'Unauthorised' }, { status: 401, headers: corsHeaders(origin) })
  }

  const email = session.email
  const supabase = getSupabaseAdmin()

  const { data: profile, error: profileError } = await supabase
    .from('profiles')
    .select('loyalty_points, loyalty_tier, name')
    .eq('email', email)
    .single()

  if (profileError) {
    return NextResponse.json({ error: profileError.message }, { status: 500, headers: corsHeaders(origin) })
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
  }, { headers: corsHeaders(origin) })
}

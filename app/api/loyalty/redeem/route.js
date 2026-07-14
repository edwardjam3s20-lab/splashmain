// app/api/loyalty/redeem/route.js
// POST — spend points for a Track 2 privilege, OR convert points to wallet cash
// Body: { redemption_type, booking_id? }

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
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
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

const TIERS = ['Bronze', 'Silver', 'Gold', 'Platinum']

// Catalogue — must match loyalty programme spec exactly
const CATALOGUE = {
  priority_slot: {
    label:        'Priority slot — single booking',
    cost:         150,
    tier_required: null,
    expires_days: 14,
    metadata:     {},
  },
  priority_month: {
    label:        'Priority queue — 30 days',
    cost:         400,
    tier_required: 'Silver',
    expires_days: 30,
    metadata:     {},
  },
  cancellation_window: {
    label:        'Extended cancellation window',
    cost:         300,
    tier_required: null,
    expires_days: null,
    metadata:     { bookings_remaining: 3 },
  },
  early_access: {
    label:        'Early access — 7 days',
    cost:         500,
    tier_required: 'Silver',
    expires_days: 30,
    metadata:     { advance_days: 7 },
  },
  partner_voucher: {
    label:        'Partner voucher',
    cost:         800,
    tier_required: 'Gold',
    expires_days: 30,
    metadata:     {},
  },
  platinum_concierge: {
    label:        'Platinum early access + concierge slot',
    cost:         1200,
    tier_required: 'Platinum',
    expires_days: 30,
    metadata:     { advance_days: 14 },
  },
}

// Points-to-cash rate: 10 points = KSh 1. Handled as a distinct code path
// below (not a CATALOGUE entry) because, unlike every other redemption,
// this one needs a variable, customer-chosen amount rather than a fixed
// cost/perk — and because it must write to wallets/wallet_transactions in
// the same atomic step as deducting points, not just create a redemptions
// row.
const POINTS_PER_KSH = 10

export async function POST(request) {
  const origin = request.headers.get('origin') || ''

  const session = await getSession()
  if (!session) {
    return NextResponse.json({ error: 'Unauthorised' }, { status: 401, headers: corsHeaders(origin) })
  }

  const email = session.email
  const body = await request.json()
  const { redemption_type, booking_id } = body

  const supabase = getSupabaseAdmin()

  // ── Cash conversion path ──
  if (redemption_type === 'wallet_cash') {
    const pointsToSpend = parseInt(body.points, 10)
    if (!pointsToSpend || pointsToSpend <= 0) {
      return NextResponse.json({ error: 'points must be a positive number' }, { status: 400, headers: corsHeaders(origin) })
    }
    if (pointsToSpend % POINTS_PER_KSH !== 0) {
      return NextResponse.json(
        { error: `Points must be a multiple of ${POINTS_PER_KSH} (${POINTS_PER_KSH} pts = KSh 1).` },
        { status: 400, headers: corsHeaders(origin) }
      )
    }

    const { data: profile, error: profileError } = await supabase
      .from('profiles')
      .select('loyalty_points')
      .eq('email', email)
      .single()

    if (profileError) {
      return NextResponse.json({ error: profileError.message }, { status: 500, headers: corsHeaders(origin) })
    }

    const points = profile.loyalty_points || 0
    if (points < pointsToSpend) {
      return NextResponse.json(
        { error: `Not enough points. Need ${pointsToSpend}, have ${points}.` },
        { status: 400, headers: corsHeaders(origin) }
      )
    }

    const kshAmount = pointsToSpend / POINTS_PER_KSH

    // Deduct points
    const { error: deductError } = await supabase
      .from('profiles')
      .update({ loyalty_points: points - pointsToSpend })
      .eq('email', email)

    if (deductError) {
      return NextResponse.json({ error: deductError.message }, { status: 500, headers: corsHeaders(origin) })
    }

    await supabase.from('point_ledger').insert({
      user_email: email,
      delta: -pointsToSpend,
      reason: 'redemption_wallet_cash',
      status: 'confirmed',
    })

    // Credit the wallet. Uses the same increment_wallet_balance RPC the
    // M-Pesa top-up callback uses (see wallet.sql) rather than a plain
    // update, so a points-conversion and an in-flight top-up landing at
    // the same moment can't race and silently drop one of them.
    const { data: newBalance, error: walletError } = await supabase.rpc('increment_wallet_balance', {
      p_email: email,
      p_amount: kshAmount,
    })

    if (walletError) {
      // Points were already deducted above — this is a genuine partial-
      // failure state. Refund the points rather than leave the customer
      // having paid points for nothing.
      await supabase.from('profiles').update({ loyalty_points: points }).eq('email', email)
      await supabase.from('point_ledger').insert({
        user_email: email,
        delta: pointsToSpend,
        reason: 'wallet_cash_refund',
        status: 'confirmed',
      })
      return NextResponse.json({ error: 'Could not credit wallet. Points refunded.' }, { status: 500, headers: corsHeaders(origin) })
    }

    await supabase.from('wallet_transactions').insert({
      user_email: email,
      amount: kshAmount,
      type: 'points_conversion',
      status: 'completed',
      points_spent: pointsToSpend,
    })

    return NextResponse.json({
      ok: true,
      label: `Converted to KSh ${kshAmount}`,
      points_spent: pointsToSpend,
      points_remaining: points - pointsToSpend,
      wallet_balance: newBalance,
    }, { headers: corsHeaders(origin) })
  }

  // ── Existing perk-redemption path ──
  const item = CATALOGUE[redemption_type]
  if (!item) {
    return NextResponse.json({ error: 'Invalid redemption type' }, { status: 400, headers: corsHeaders(origin) })
  }

  const { data: profile, error: profileError } = await supabase
    .from('profiles')
    .select('loyalty_points, loyalty_tier')
    .eq('email', email)
    .single()

  if (profileError) {
    return NextResponse.json({ error: profileError.message }, { status: 500, headers: corsHeaders(origin) })
  }

  const points = profile.loyalty_points || 0
  const tier   = profile.loyalty_tier   || 'Bronze'

  if (points < item.cost) {
    return NextResponse.json({
      error: `Not enough points. Need ${item.cost}, have ${points}.`
    }, { status: 400, headers: corsHeaders(origin) })
  }

  if (item.tier_required) {
    const userRank = TIERS.indexOf(tier)
    const reqRank  = TIERS.indexOf(item.tier_required)
    if (userRank < reqRank) {
      return NextResponse.json({
        error: `${item.tier_required} tier required for this redemption.`
      }, { status: 403, headers: corsHeaders(origin) })
    }
  }

  const { data: freeze } = await supabase
    .from('velocity_flags')
    .select('id')
    .eq('user_email', email)
    .eq('resolved', false)
    .gt('frozen_until', new Date().toISOString())
    .maybeSingle()

  if (freeze) {
    return NextResponse.json({
      error: 'Account is under review. Redemptions are paused.'
    }, { status: 403, headers: corsHeaders(origin) })
  }

  const { error: deductError } = await supabase
    .from('profiles')
    .update({ loyalty_points: points - item.cost })
    .eq('email', email)

  if (deductError) {
    return NextResponse.json({ error: deductError.message }, { status: 500, headers: corsHeaders(origin) })
  }

  await supabase
    .from('point_ledger')
    .insert({
      user_email: email,
      delta:      -item.cost,
      reason:     'redemption_' + redemption_type,
      status:     'confirmed',
    })

  const expiresAt = item.expires_days
    ? new Date(Date.now() + item.expires_days * 86400000).toISOString()
    : null

  const { data: redemption, error: redemptionError } = await supabase
    .from('redemptions')
    .insert({
      user_email:      email,
      redemption_type,
      points_spent:    item.cost,
      status:          'active',
      booking_id:      booking_id || null,
      expires_at:      expiresAt,
      metadata:        item.metadata,
    })
    .select()
    .single()

  if (redemptionError) {
    return NextResponse.json({ error: redemptionError.message }, { status: 500, headers: corsHeaders(origin) })
  }

  return NextResponse.json({
    ok:              true,
    redemption,
    points_spent:    item.cost,
    points_remaining: points - item.cost,
    label:           item.label,
  }, { headers: corsHeaders(origin) })
}

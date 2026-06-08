// app/api/loyalty/redeem/route.js
// POST — spend points for a Track 2 privilege
// Body: { redemption_type, booking_id? }

import { NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabase'
import { getSession } from '@/lib/session'

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
    expires_days: null,           // applied as 3-booking allowance
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

export async function POST(request) {
  const session = await getSession()
  if (!session) {
    return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })
  }

  const email = session.email
  const { redemption_type, booking_id } = await request.json()

  // Validate redemption type
  const item = CATALOGUE[redemption_type]
  if (!item) {
    return NextResponse.json({ error: 'Invalid redemption type' }, { status: 400 })
  }

  const supabase = getSupabaseAdmin()

  // Fetch profile — points, tier, last wash (activity check)
  const { data: profile, error: profileError } = await supabase
    .from('profiles')
    .select('loyalty_points, loyalty_tier')
    .eq('email', email)
    .single()

  if (profileError) {
    return NextResponse.json({ error: profileError.message }, { status: 500 })
  }

  const points = profile.loyalty_points || 0
  const tier   = profile.loyalty_tier   || 'Bronze'

  // Check sufficient points
  if (points < item.cost) {
    return NextResponse.json({
      error: `Not enough points. Need ${item.cost}, have ${points}.`
    }, { status: 400 })
  }

  // Check tier requirement
  if (item.tier_required) {
    const userRank = TIERS.indexOf(tier)
    const reqRank  = TIERS.indexOf(item.tier_required)
    if (userRank < reqRank) {
      return NextResponse.json({
        error: `${item.tier_required} tier required for this redemption.`
      }, { status: 403 })
    }
  }

  // Check velocity freeze — no redemptions during earning freeze
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
    }, { status: 403 })
  }

  // Deduct points from profile
  const { error: deductError } = await supabase
    .from('profiles')
    .update({ loyalty_points: points - item.cost })
    .eq('email', email)

  if (deductError) {
    return NextResponse.json({ error: deductError.message }, { status: 500 })
  }

  // Write spend to point_ledger
  await supabase
    .from('point_ledger')
    .insert({
      user_email: email,
      delta:      -item.cost,
      reason:     'redemption_' + redemption_type,
      status:     'confirmed',
    })

  // Create redemption record
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
    return NextResponse.json({ error: redemptionError.message }, { status: 500 })
  }

  return NextResponse.json({
    ok:              true,
    redemption,
    points_spent:    item.cost,
    points_remaining: points - item.cost,
    label:           item.label,
  })
}

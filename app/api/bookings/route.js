import { NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabase'
import { getSession } from '@/lib/session'
import { sendPushToOperator } from '@/lib/push'

// Fields the client still supplies as-is — none of these affect money, and
// all describe a specific choice (which car, which slot) rather than a
// value that could be forged for gain. `location` and `service_name` are
// used only as lookup keys below, not written through directly — the
// canonical name from the matched DB row is what actually gets stored.
const REQUIRED_FIELDS = [
  'date', 'time', 'location',
  'car_plate', 'car_type', 'car_make', 'car_model', 'service_name',
  'booking_code',
]

// FREEMIUM MODEL (replaces the old 30-day-trial + 30 KSh booking fee +
// per-wash commission model): 14 days free from account creation, then a
// hard paywall — no bookings at all without an active subscription. No
// booking fee, no commission, ever; operator keeps 100% of wash_price
// (see lib/commission.js / public/splashpass-commission.js, both zeroed
// to match). Platform revenue is subscription-only from here on.
const TRIAL_DAYS = 14

const COMMISSION_TIERS = {
  1: { operatorRate: 1 },
  2: { operatorRate: 1 },
}

function normaliseTier(tier) {
  return Number(tier) === 2 ? 2 : 1
}

// Mirrors public/splashpass-commission.js's splitWashPrice — reimplemented
// server-side rather than imported, since this route can't reach that
// browser-global script. Keep the two in sync if the rates ever change.
function splitWashPrice(washPrice, tier) {
  const t = normaliseTier(tier)
  const rate = COMMISSION_TIERS[t].operatorRate
  const price = Math.round(Number(washPrice) || 0)
  const operatorAmount = Math.round(price * rate)
  return { tier: t, operatorAmount, platformAmount: price - operatorAmount }
}

// Mirrors src/lib/access.ts's isOnTrial/getTrialDaysLeft in the customer
// app — reimplemented server-side because access must never depend on a
// client-reported trial/subscription state.
function isOnTrial(profile) {
  if (!profile?.created_at) return false
  const created = new Date(profile.created_at).getTime()
  const daysLeft = Math.ceil((created + TRIAL_DAYS * 86400000 - Date.now()) / 86400000)
  const status = profile.sub_status
  return daysLeft > 0 && (!status || status === 'trial' || status === 'pending')
}

function isSubscribed(profile) {
  return profile?.sub_status === 'active'
}

// Unlike the operator routes elsewhere in this project, this one is called
// directly from the customer app's browser, on a different origin (the
// customer app and splashmain are separate Vercel deployments) — so,
// unlike requireOperator()-gated routes that only ever see server-to-server
// or same-origin calls, this genuinely needs CORS headers or every request
// from the customer app's domain gets silently blocked by the browser.
//
// SECURITY: 'Access-Control-Allow-Origin': '*' was previously paired with
// no session check at all, so ANY origin could POST a booking as any
// user_email with any price. It's now paired with a required session AND
// credentials — '*' can't be combined with credentialed requests per the
// CORS spec anyway, so this is tightened to the real customer app origin.
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

export async function POST(request) {
  const origin = request.headers.get('origin') || ''

  const session = await getSession()
  if (!session?.email) {
    return NextResponse.json({ error: 'Unauthorised' }, { status: 401, headers: corsHeaders(origin) })
  }

  const body = await request.json().catch(() => null)
  if (!body) {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400, headers: corsHeaders(origin) })
  }

  const missing = REQUIRED_FIELDS.filter((f) => body[f] === undefined || body[f] === null || body[f] === '')
  if (missing.length) {
    return NextResponse.json(
      { error: `Missing required fields: ${missing.join(', ')}` },
      { status: 400, headers: corsHeaders(origin) }
    )
  }

  const supabase = getSupabaseAdmin()

  // Identity: always the session's own email/name, never the client's
  // claimed values — this alone closes the "create a booking as anyone"
  // impersonation gap. user_phone is informational (used for SMS) and low
  // risk either way, so the client-provided value is still used, but it's
  // logged against the session's email regardless.
  const { data: profile, error: profileError } = await supabase
    .from('profiles')
    .select('name, phone, sub_status, created_at')
    .eq('email', session.email)
    .maybeSingle()

  if (profileError || !profile) {
    return NextResponse.json({ error: 'Could not load your profile' }, { status: 500, headers: corsHeaders(origin) })
  }

  const onTrial = isOnTrial(profile)
  if (!onTrial && !isSubscribed(profile)) {
    return NextResponse.json(
      { error: 'Your free trial has ended. Subscribe to keep booking.', code: 'SUBSCRIPTION_REQUIRED' },
      { status: 402, headers: corsHeaders(origin) }
    )
  }

  // Price: always derived from the actual wash point + service rows, never
  // from the client's wash_price/app_fee/total_amount/operator_amount/
  // splash_commission/commission_tier fields — those five numbers were
  // previously taken verbatim from the request body, which meant a
  // modified request could set total_amount to almost nothing while
  // wash_price still looked legitimate, or inflate/deflate the commission
  // split.
  const { data: washPoint, error: wpError } = await supabase
    .from('wash_points')
    .select('id, name, commission_tier')
    .eq('name', body.location)
    .maybeSingle()

  if (wpError || !washPoint) {
    return NextResponse.json({ error: 'Wash point not found' }, { status: 400, headers: corsHeaders(origin) })
  }

  // wash_points has no status column — open/paused lives on the operator
  // (one operator per wash point, possibly logged in on multiple devices,
  // but a single status row per wash point either way). Matches how the
  // customer app's own fetchOperatorStatuses() already reads this.
  const { data: operatorRow } = await supabase
    .from('operators')
    .select('status')
    .eq('wash_point', washPoint.name)
    .maybeSingle()

  if (operatorRow?.status === 'paused') {
    return NextResponse.json({ error: 'This wash point is not currently accepting bookings' }, { status: 409, headers: corsHeaders(origin) })
  }

  const { data: service, error: svcError } = await supabase
    .from('wash_point_extras')
    .select('id, name, price')
    .eq('wash_point_id', washPoint.id)
    .eq('name', body.service_name)
    .maybeSingle()

  if (svcError || !service) {
    return NextResponse.json({ error: 'Service not found at this wash point' }, { status: 400, headers: corsHeaders(origin) })
  }

  const washPrice = Number(service.price)
  const appFee = 0 // no booking fee under the freemium model
  const totalAmount = washPrice + appFee
  const split = splitWashPrice(washPrice, washPoint.commission_tier)

  const { data: booking, error } = await supabase
    .from('bookings')
    .insert({
      user_email: session.email,
      user_name: profile.name,
      user_phone: profile.phone ?? body.user_phone ?? null,
      date: body.date,
      time: body.time,
      location: washPoint.name,
      status: 'pending',
      car_plate: body.car_plate,
      car_type: body.car_type,
      car_make: body.car_make,
      car_model: body.car_model,
      service_name: service.name,
      wash_price: washPrice,
      app_fee: appFee,
      total_amount: totalAmount,
      operator_amount: split.operatorAmount,
      splash_commission: split.platformAmount,
      commission_tier: split.tier,
      booking_type: onTrial ? 'trial' : 'subscription',
      booking_code: body.booking_code,
    })
    .select()
    .single()

  if (error) {
    if (error.code === '23505') {
      return NextResponse.json(
        { error: 'That booking code is already taken — please retry.' },
        { status: 409, headers: corsHeaders(origin) }
      )
    }
    return NextResponse.json({ error: error.message }, { status: 500, headers: corsHeaders(origin) })
  }

  // Find the operator(s) for this wash point and push-notify them. This
  // mirrors the same location-string match the operator app's own bookings
  // route already uses (operators.wash_point = bookings.location) — kept
  // consistent rather than inventing a second way to do this lookup.
  const { data: operators } = await supabase
    .from('operators')
    .select('id')
    .eq('wash_point', washPoint.name)

  if (operators?.length) {
    await Promise.allSettled(
      operators.map((op) =>
        sendPushToOperator(op.id, {
          title: 'New booking request',
          body: `${profile.name} wants a ${service.name} at ${body.time} today.`,
          bookingId: booking.id,
          url: `/app/queue?booking=${booking.id}`,
        })
      )
    )
  }
  // No operator found for this wash point, or none have push enabled —
  // not an error condition. The booking still exists and the customer's
  // realtime subscription + the SMS already sent client-side cover the
  // case where the operator only ever checks the app manually.

  return NextResponse.json({ booking }, { headers: corsHeaders(origin) })
}

// app/api/wallet/pay-booking/route.js
// POST — pay for an accepted booking directly from wallet balance
// Body: { bookingId, amount }

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

export async function POST(request) {
  const origin = request.headers.get('origin') || ''

  const session = await getSession()
  if (!session) {
    return NextResponse.json({ error: 'Unauthorised' }, { status: 401, headers: corsHeaders(origin) })
  }

  const body = await request.json().catch(() => null)
  const bookingId = body?.bookingId
  if (!bookingId) {
    return NextResponse.json({ error: 'bookingId is required' }, { status: 400, headers: corsHeaders(origin) })
  }

  const supabase = getSupabaseAdmin()

  // Fetch the booking and verify it both belongs to this session's user
  // AND is actually payable right now. The client-supplied `amount` in
  // the request body is NOT trusted for the actual charge — the booking's
  // own total_amount (set at creation time, server-side) is the only
  // figure ever used to debit the wallet. Trusting a client-supplied
  // amount here would let a modified request pay any amount it likes for
  // any booking.
  const { data: booking, error: fetchError } = await supabase
    .from('bookings')
    .select('id, user_email, status, total_amount')
    .eq('id', bookingId)
    .single()

  if (fetchError || !booking) {
    return NextResponse.json({ error: 'Booking not found' }, { status: 404, headers: corsHeaders(origin) })
  }

  if (booking.user_email?.trim().toLowerCase() !== session.email?.trim().toLowerCase()) {
    return NextResponse.json({ error: 'This booking does not belong to you' }, { status: 403, headers: corsHeaders(origin) })
  }

  if (booking.status !== 'accepted') {
    return NextResponse.json(
      { error: `Cannot pay for a booking with status "${booking.status}". It must be accepted first.` },
      { status: 409, headers: corsHeaders(origin) }
    )
  }

  // Atomic, balance-checked decrement — see wallet.sql. Raises (rather
  // than silently returning null) if the balance is insufficient, which
  // surfaces here as a Postgres error caught below.
  const { data: newBalance, error: walletError } = await supabase.rpc('decrement_wallet_balance', {
    p_email: session.email,
    p_amount: booking.total_amount,
  })

  if (walletError) {
    return NextResponse.json(
      { error: 'Insufficient wallet balance.' },
      { status: 400, headers: corsHeaders(origin) }
    )
  }

  const { data: updatedBooking, error: updateError } = await supabase
    .from('bookings')
    .update({ status: 'confirmed', payment_status: 'paid' })
    .eq('id', bookingId)
    .select()
    .single()

  if (updateError) {
    // Booking update failed after the wallet was already debited — refund
    // immediately rather than leave the customer charged for nothing.
    await supabase.rpc('increment_wallet_balance', { p_email: session.email, p_amount: booking.total_amount })
    return NextResponse.json({ error: 'Could not confirm booking. Wallet refunded.' }, { status: 500, headers: corsHeaders(origin) })
  }

  await supabase.from('wallet_transactions').insert({
    user_email: session.email,
    amount: -booking.total_amount,
    type: 'booking_payment',
    status: 'completed',
    booking_id: bookingId,
  })

  return NextResponse.json(
    { ok: true, balance: newBalance, booking: updatedBooking },
    { headers: corsHeaders(origin) }
  )
}

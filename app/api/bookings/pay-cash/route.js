// app/api/bookings/pay-cash/route.js
// POST — confirm an accepted booking as "pay at the wash point, in cash"
// Body: { bookingId }
//
// No money moves through this endpoint at all -- there's no STK push, no
// wallet debit. Selecting Cash simply confirms the booking (same terminal
// state as a successful M-Pesa/wallet payment) on the understanding that
// the customer pays the operator directly on arrival. Only available when
// the wash point's organization is cash-eligible (see
// lib/cashEligibility.js) -- gated server-side here regardless of what
// the client showed, since the client-side check in MpesaBookingScreen is
// a display convenience, not the actual security boundary.

import { NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabase'
import { getSession } from '@/lib/session'
import { isWashPointCashEligible } from '@/lib/cashEligibility'

// Same reasoning as wallet/pay-booking/route.js: a dynamic import inside a
// try/catch, not a static top-of-file import, so a broken notification
// module can only ever fail to notify -- never take this endpoint down.
async function safeNotifyBookingConfirmed(booking) {
  try {
    const { notifyBookingConfirmed } = await import('@/lib/notifyBookingConfirmed')
    await notifyBookingConfirmed(booking)
  } catch (e) {
    console.error('safeNotifyBookingConfirmed: notification module failed to load or run:', e.message)
  }
}

// Same allowlist as wallet/pay-booking/route.js and app/api/customer/bookings/route.js.
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

  const { data: booking, error: fetchError } = await supabase
    .from('bookings')
    .select('id, user_email, status, location')
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

  const cashEligible = await isWashPointCashEligible(supabase, booking.location)
  if (!cashEligible) {
    return NextResponse.json(
      { error: 'Cash payment is not available for this wash point.' },
      { status: 403, headers: corsHeaders(origin) }
    )
  }

  const { data: updatedBooking, error: updateError } = await supabase
    .from('bookings')
    .update({ status: 'confirmed', payment_status: 'cash' })
    .eq('id', bookingId)
    .select()
    .single()

  if (updateError) {
    return NextResponse.json({ error: 'Could not confirm booking.' }, { status: 500, headers: corsHeaders(origin) })
  }

  // Fire after the write succeeds -- never worth blocking or failing a
  // completed confirmation over an email/push hiccup.
  await safeNotifyBookingConfirmed(updatedBooking)

  return NextResponse.json(
    { ok: true, booking: updatedBooking },
    { headers: corsHeaders(origin) }
  )
}

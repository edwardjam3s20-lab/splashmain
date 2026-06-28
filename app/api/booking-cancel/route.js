import { NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabase'

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
}

export async function OPTIONS() {
  return new NextResponse(null, { status: 200, headers: CORS_HEADERS })
}

/**
 * Customer-initiated cancellation. There's no Supabase Auth session for
 * customers (see the project's customer app — login is a custom RPC, not
 * supabase.auth), so this can't be secured with an RLS policy alone. This
 * endpoint instead verifies booking.user_email matches the email the
 * request claims before writing with the admin client — the same trust
 * model the rest of this app already uses for customer identity (e.g. the
 * customer app's getBookingsByEmail). It is NOT full session security: a
 * request that knows someone else's email could still impersonate them
 * here, same as it already could for booking lookups elsewhere in this
 * app. Closing that gap properly means adding real customer sessions
 * app-wide — flagging it here rather than pretending this one endpoint
 * solves it.
 */
export async function POST(request) {
  const body = await request.json().catch(() => null)
  const bookingId = body?.bookingId
  const email = body?.email?.trim().toLowerCase()

  if (!bookingId || !email) {
    return NextResponse.json({ error: 'bookingId and email are required' }, { status: 400, headers: CORS_HEADERS })
  }

  const supabase = getSupabaseAdmin()

  const { data: booking, error: fetchError } = await supabase
    .from('bookings')
    .select('id, user_email, status')
    .eq('id', bookingId)
    .single()

  if (fetchError || !booking) {
    return NextResponse.json({ error: 'Booking not found' }, { status: 404, headers: CORS_HEADERS })
  }

  if (booking.user_email?.trim().toLowerCase() !== email) {
    return NextResponse.json(
      { error: 'This booking does not belong to that account' },
      { status: 403, headers: CORS_HEADERS }
    )
  }

  if (booking.status !== 'pending') {
    return NextResponse.json(
      { error: `Cannot cancel a booking with status "${booking.status}". Only pending requests can be cancelled.` },
      { status: 409, headers: CORS_HEADERS }
    )
  }

  const { data, error } = await supabase
    .from('bookings')
    .update({ status: 'cancelled' })
    .eq('id', bookingId)
    .select()
    .single()

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500, headers: CORS_HEADERS })
  }

  return NextResponse.json({ booking: data }, { headers: CORS_HEADERS })
}

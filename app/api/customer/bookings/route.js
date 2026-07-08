// app/api/customer/bookings/route.js
// GET — the current session's own bookings. With no query params, returns
// the full list (replaces getBookingsByEmail). With ?id=<bookingId>,
// returns that one booking IF it belongs to the session's own email
// (replaces getBookingById and getBookingPaymentStatus — the latter can
// just read .payment_status off the returned booking).
//
// SECURITY: this is what closes the other half of the read-side IDOR —
// getBookingsByEmail/getBookingById previously hit Supabase directly with
// the anon key, filtered only by whatever email/id the client passed, with
// no check that the caller actually owned that booking. Every real call
// site already only ever asks for its own bookings, so scoping to the
// session changes nothing for legitimate use.

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

export async function GET(request) {
  const session = await getSession()
  if (!session?.email) {
    return NextResponse.json({ error: 'Unauthorised' }, { status: 401, headers: corsHeaders() })
  }

  const supabase = getSupabaseAdmin()
  const id = request.nextUrl.searchParams.get('id')

  if (id) {
    const { data: booking, error } = await supabase
      .from('bookings')
      .select('*')
      .eq('id', id)
      .maybeSingle()

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500, headers: corsHeaders() })
    }
    if (!booking || booking.user_email?.trim().toLowerCase() !== session.email.trim().toLowerCase()) {
      // Same 404 whether the booking doesn't exist or belongs to someone
      // else — a distinct "forbidden" response would let a caller confirm
      // which booking IDs exist for other people just by probing.
      return NextResponse.json({ error: 'Booking not found' }, { status: 404, headers: corsHeaders() })
    }
    return NextResponse.json({ booking }, { headers: corsHeaders() })
  }

  const { data: bookings, error } = await supabase
    .from('bookings')
    .select('*')
    .eq('user_email', session.email)
    .order('created_at', { ascending: false })

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500, headers: corsHeaders() })
  }

  return NextResponse.json({ bookings: bookings ?? [] }, { headers: corsHeaders() })
}

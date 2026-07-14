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

export async function GET(request) {
  const origin = request.headers.get('origin') || ''

  const session = await getSession()
  if (!session?.email) {
    return NextResponse.json({ error: 'Unauthorised' }, { status: 401, headers: corsHeaders(origin) })
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
      return NextResponse.json({ error: error.message }, { status: 500, headers: corsHeaders(origin) })
    }
    if (!booking || booking.user_email?.trim().toLowerCase() !== session.email.trim().toLowerCase()) {
      // Same 404 whether the booking doesn't exist or belongs to someone
      // else — a distinct "forbidden" response would let a caller confirm
      // which booking IDs exist for other people just by probing.
      return NextResponse.json({ error: 'Booking not found' }, { status: 404, headers: corsHeaders(origin) })
    }
    return NextResponse.json({ booking }, { headers: corsHeaders(origin) })
  }

  const { data: bookings, error } = await supabase
    .from('bookings')
    .select('*')
    .eq('user_email', session.email)
    .order('created_at', { ascending: false })

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500, headers: corsHeaders(origin) })
  }

  return NextResponse.json({ bookings: bookings ?? [] }, { headers: corsHeaders(origin) })
}

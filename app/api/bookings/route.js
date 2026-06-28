import { NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabase'
import { sendPushToOperator } from '@/lib/push'

const REQUIRED_FIELDS = [
  'user_email', 'user_name', 'date', 'time', 'location',
  'car_plate', 'car_type', 'car_make', 'car_model', 'service_name',
  'wash_price', 'app_fee', 'total_amount', 'operator_amount',
  'splash_commission', 'commission_tier', 'booking_type', 'booking_code',
]

// Unlike the operator routes elsewhere in this project, this one is called
// directly from the customer app's browser, on a different origin (the
// customer app and splashmain are separate Vercel deployments) — so,
// unlike requireOperator()-gated routes that only ever see server-to-server
// or same-origin calls, this genuinely needs CORS headers or every request
// from the customer app's domain gets silently blocked by the browser.
const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
}

export async function OPTIONS() {
  return new NextResponse(null, { status: 200, headers: CORS_HEADERS })
}

export async function POST(request) {
  const body = await request.json().catch(() => null)
  if (!body) {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400, headers: CORS_HEADERS })
  }

  const missing = REQUIRED_FIELDS.filter((f) => body[f] === undefined || body[f] === null || body[f] === '')
  if (missing.length) {
    return NextResponse.json(
      { error: `Missing required fields: ${missing.join(', ')}` },
      { status: 400, headers: CORS_HEADERS }
    )
  }

  const supabase = getSupabaseAdmin()

  const { data: booking, error } = await supabase
    .from('bookings')
    .insert({
      user_email: body.user_email,
      user_name: body.user_name,
      user_phone: body.user_phone ?? null,
      date: body.date,
      time: body.time,
      location: body.location,
      status: 'pending',
      car_plate: body.car_plate,
      car_type: body.car_type,
      car_make: body.car_make,
      car_model: body.car_model,
      service_name: body.service_name,
      wash_price: body.wash_price,
      app_fee: body.app_fee,
      total_amount: body.total_amount,
      operator_amount: body.operator_amount,
      splash_commission: body.splash_commission,
      commission_tier: body.commission_tier,
      booking_type: body.booking_type,
      booking_code: body.booking_code,
    })
    .select()
    .single()

  if (error) {
    if (error.code === '23505') {
      return NextResponse.json(
        { error: 'That booking code is already taken — please retry.' },
        { status: 409, headers: CORS_HEADERS }
      )
    }
    return NextResponse.json({ error: error.message }, { status: 500, headers: CORS_HEADERS })
  }

  // Find the operator(s) for this wash point and push-notify them. This
  // mirrors the same location-string match the operator app's own bookings
  // route already uses (operators.wash_point = bookings.location) — kept
  // consistent rather than inventing a second way to do this lookup.
  const { data: operators } = await supabase
    .from('operators')
    .select('id')
    .eq('wash_point', body.location)

  if (operators?.length) {
    await Promise.allSettled(
      operators.map((op) =>
        sendPushToOperator(op.id, {
          title: 'New booking request',
          body: `${body.user_name} wants a ${body.service_name} at ${body.time} today.`,
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

  return NextResponse.json({ booking }, { headers: CORS_HEADERS })
}

// app/api/paystack/verify/route.js
// POST — called by the frontend right after the Paystack popup reports a
// successful charge. The popup's own "success" callback is NOT proof of
// payment (it's client-side JS — trivially fakeable), so this route is
// the one place that actually confirms money moved, using the SECRET key
// server-side, before touching the database.
//
// Trust model: rather than reading a session cookie (I don't have
// visibility into this repo's lib/session.js from where this was
// drafted, so I didn't want to guess at its exact export shape), this
// route trusts the *combination* of: a reference string that must belong
// to a real, successful, KES transaction (verified against Paystack's
// API, which only Paystack and this server — via the secret key — can
// authoritatively answer), for the exact expected amount (looked up
// server-side by planId, not trusted from the client), matching the
// email Paystack has on file for that specific transaction. An attacker
// would need an already-successful real payment's reference to exploit
// this, at which point the "exploit" is just... a real payment.
//
// If you'd rather tie this to the logged-in session instead (tighter,
// and prevents someone activating a plan under a different email than
// their own account), swap the `email` param below for whatever
// lib/session.js already exposes for reading the current user from
// `request.cookies` — the same thing app/api/customer/profile/route.js
// uses.

import { NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabase'

// Mirrors src/lib/plans.ts on the frontend. Deliberately duplicated
// rather than trusted from the client — the amount actually charged is
// checked against THIS list, not whatever the browser claims the plan
// costs.
const PLAN_PRICES = {
  mini:       { name: 'Mini',       price: 199,  car_limit: 1 },
  individual: { name: 'Individual', price: 499,  car_limit: 1 },
  duo:        { name: 'Duo',        price: 999,  car_limit: 2 },
  family:     { name: 'Family',     price: 1999, car_limit: 5 },
}

export async function POST(request) {
  let body
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid request body.' }, { status: 400 })
  }

  const { reference, planId, email } = body || {}
  if (!reference || !planId || !email) {
    return NextResponse.json({ error: 'Missing reference, planId, or email.' }, { status: 400 })
  }

  const plan = PLAN_PRICES[planId]
  if (!plan) {
    return NextResponse.json({ error: 'Unknown plan.' }, { status: 400 })
  }

  if (!process.env.PAYSTACK_SECRET_KEY) {
    return NextResponse.json({ error: 'Card payments are not configured on the server yet.' }, { status: 500 })
  }

  // Ask Paystack directly what actually happened with this reference —
  // this is the only step in this route that can't be spoofed by the
  // client.
  const verifyRes = await fetch(`https://api.paystack.co/transaction/verify/${encodeURIComponent(reference)}`, {
    headers: { Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}` },
  })

  if (!verifyRes.ok) {
    return NextResponse.json({ error: 'Could not verify payment with Paystack.' }, { status: 502 })
  }

  const verifyData = await verifyRes.json()
  const tx = verifyData?.data

  if (!verifyData?.status || !tx || tx.status !== 'success') {
    return NextResponse.json({ error: 'Payment was not successful.' }, { status: 402 })
  }

  if (tx.currency !== 'KES') {
    return NextResponse.json({ error: 'Unexpected currency on transaction.' }, { status: 402 })
  }

  const expectedAmount = plan.price * 100 // Paystack reports amount in the lowest subunit
  if (tx.amount !== expectedAmount) {
    return NextResponse.json({ error: 'Amount paid does not match the selected plan.' }, { status: 402 })
  }

  const txEmail = (tx.customer?.email || '').toLowerCase().trim()
  if (txEmail !== email.toLowerCase().trim()) {
    return NextResponse.json({ error: 'Payment email does not match account email.' }, { status: 402 })
  }

  // NOTE: no idempotency check here (e.g. "has this reference already
  // been applied before?"). Worth adding — either a unique constraint on
  // a `paystack_reference` column, or a small `processed_references`
  // table — so a retried/duplicated client request can't reapply the
  // same payment twice. Flagging rather than guessing at your preferred
  // approach/schema.

  const supabase = getSupabaseAdmin()
  const { data: updated, error: updateError } = await supabase
    .from('profiles')
    .update({
      sub_plan: planId,
      sub_plan_name: plan.name,
      sub_car_limit: plan.car_limit,
      sub_status: 'active',
    })
    .eq('email', email.toLowerCase().trim())
    .select()
    .maybeSingle()

  if (updateError || !updated) {
    return NextResponse.json({ error: 'Payment verified, but could not update your account. Contact support.' }, { status: 500 })
  }

  delete updated.password

  return NextResponse.json({ profile: updated })
}

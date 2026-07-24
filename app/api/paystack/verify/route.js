// app/api/paystack/verify/route.js
// POST — called by the frontend right after the Paystack popup reports a
// successful charge. The popup's own "success" callback is NOT proof of
// payment (it's client-side JS — trivially fakeable), so this route is
// one of two places (the other is the webhook) that actually confirms
// money moved, using the SECRET key server-side, before touching the
// database.
//
// This route's trust model: the reference must belong to a real,
// successful, KES transaction (verified against Paystack's API, which
// only Paystack and this server can authoritatively answer), for the
// exact expected amount (looked up server-side by planId), matching the
// email Paystack has on file for that transaction.

import { NextResponse } from 'next/server'
import { applyPaystackPayment } from '@/lib/paystack/applyPayment'

export async function POST(request) {
  let body
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid request body.' }, { status: 400 })
  }

  const { reference, planId, email, accountType: rawAccountType } = body || {}
  if (!reference || !planId || !email) {
    return NextResponse.json({ error: 'Missing reference, planId, or email.' }, { status: 400 })
  }

  // Defaults to 'customer' so the existing customer app (which has never
  // sent this field) keeps working unchanged. Anything other than the
  // two known values is rejected rather than silently coerced, since this
  // string picks which table (profiles vs operators) gets written to.
  const accountType = rawAccountType === 'operator' ? 'operator' : 'customer'
  if (rawAccountType && rawAccountType !== 'customer' && rawAccountType !== 'operator') {
    return NextResponse.json({ error: `Invalid accountType: ${rawAccountType}` }, { status: 400 })
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

  const txEmail = (tx.customer?.email || '').toLowerCase().trim()
  if (txEmail !== email.toLowerCase().trim()) {
    return NextResponse.json({ error: 'Payment email does not match account email.' }, { status: 402 })
  }

  // Plan/amount/currency validation and the actual profile update now
  // live in applyPaystackPayment, shared with the webhook route, so the
  // two entry points can't drift apart on what a successful payment
  // actually does.
  const result = await applyPaystackPayment({
    reference,
    planId,
    email,
    amountSubunit: tx.amount,
    currency: tx.currency,
    source: 'client_verify',
    accountType,
  })

  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status })
  }

  return NextResponse.json(accountType === 'operator' ? { operator: result.operator } : { profile: result.profile })
}

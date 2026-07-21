// app/api/paystack/webhook/route.js
// POST — Paystack calls this server-to-server on every transaction
// event, independent of whether the customer's browser/app is even
// still open. This is the path that catches "customer paid, then closed
// the tab before the popup's success callback fired" — the client-
// triggered /api/paystack/verify route alone can't see those.
//
// Authentication here is the HMAC signature Paystack sends in the
// x-paystack-signature header, computed over the RAW request body using
// the secret key. This has to run against the raw bytes, before
// JSON.parse, or the signature won't match — hence request.text()
// instead of request.json().
//
// Set this route's full URL as the "Live Webhook URL" in Paystack's
// dashboard (Settings > API Keys & Webhooks) once it's deployed.

import { NextResponse } from 'next/server'
import crypto from 'crypto'
import { applyPaystackPayment } from '@/lib/paystack/applyPayment'
import { PLAN_PRICES } from '@/lib/paystack/plans'

export async function POST(request) {
  const secret = process.env.PAYSTACK_SECRET_KEY
  if (!secret) {
    return NextResponse.json({ error: 'Not configured.' }, { status: 500 })
  }

  const rawBody = await request.text()
  const signature = request.headers.get('x-paystack-signature') || ''
  const expectedSignature = crypto.createHmac('sha512', secret).update(rawBody).digest('hex')

  // Constant-time comparison so a plain === can't leak timing info about
  // how much of the signature matched.
  const sigBuf = Buffer.from(signature, 'utf8')
  const expBuf = Buffer.from(expectedSignature, 'utf8')
  const signatureValid = sigBuf.length === expBuf.length && crypto.timingSafeEqual(sigBuf, expBuf)

  if (!signatureValid) {
    return NextResponse.json({ error: 'Invalid signature.' }, { status: 401 })
  }

  let event
  try {
    event = JSON.parse(rawBody)
  } catch {
    return NextResponse.json({ error: 'Invalid body.' }, { status: 400 })
  }

  // Only charge.success actually means money moved. Paystack sends other
  // event types too (refunds, transfers, subscription events) — ignore
  // those, but still return 200 so Paystack doesn't keep retrying an
  // event this route was never going to act on.
  if (event?.event !== 'charge.success') {
    return NextResponse.json({ received: true })
  }

  const tx = event.data || {}
  const { reference, amount, currency, customer, metadata } = tx

  if (!reference || tx.status !== 'success') {
    return NextResponse.json({ received: true })
  }

  const email = (customer?.email || '').toLowerCase().trim()
  if (!email) {
    console.error(`Paystack webhook: charge.success with no customer email, ref ${reference}`)
    return NextResponse.json({ received: true })
  }

  // planId should come from metadata set when the transaction was
  // initialized — make sure the checkout screen passes
  // metadata: { planId } into payWithPaystackCard(). Falling back to a
  // reverse price lookup only because plan prices are all unique right
  // now (199/499/999/1999); if two plans ever share a price, this
  // fallback stops being reliable and metadata.planId becomes required.
  let planId = metadata?.planId
  if (!planId || !PLAN_PRICES[planId]) {
    planId = Object.keys(PLAN_PRICES).find((id) => PLAN_PRICES[id].price * 100 === amount)
  }

  if (!planId) {
    console.error(`Paystack webhook: could not determine plan for ref ${reference}, amount ${amount}`)
    return NextResponse.json({ received: true })
  }

  const result = await applyPaystackPayment({
    reference,
    planId,
    email,
    amountSubunit: amount,
    currency,
    source: 'webhook',
  })

  if (!result.ok) {
    // Something on our side failed (most likely DB), not that the data
    // itself is bad — return 500 so Paystack retries the webhook rather
    // than silently dropping a real payment.
    console.error(`Paystack webhook: applyPaystackPayment failed for ref ${reference}: ${result.error}`)
    return NextResponse.json({ error: result.error }, { status: result.status })
  }

  return NextResponse.json({ received: true })
}

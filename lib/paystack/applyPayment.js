// lib/paystack/applyPayment.js
//
// Shared by both the client-triggered verify route and the Paystack
// webhook. Both routes authenticate a transaction their own way (verify
// route: calls Paystack's verify API with the reference; webhook:
// checks the HMAC signature on the event body) — but once a route has
// established "this is a real, successful, KES payment," what happens
// next is identical, so it lives here once instead of twice.
//
// Idempotency: the unique constraint on paystack_transactions.reference
// is the actual guarantee, not application logic. If two callers (e.g.
// the webhook and a client retry) race each other for the same
// reference, the loser's insert fails, and it treats that as "already
// applied" rather than an error — the profile update never runs twice.

import { getSupabaseAdmin } from '@/lib/supabase'
import { PLAN_PRICES } from './plans'

export async function applyPaystackPayment({ reference, planId, email, amountSubunit, currency, source }) {
  const plan = PLAN_PRICES[planId]
  if (!plan) {
    return { ok: false, status: 400, error: `Unknown plan: ${planId}` }
  }

  if (currency !== 'KES') {
    return { ok: false, status: 402, error: `Unexpected currency: ${currency}` }
  }

  const expectedAmount = plan.price * 100 // Paystack amounts are in the lowest subunit
  if (amountSubunit !== expectedAmount) {
    return { ok: false, status: 402, error: `Amount ${amountSubunit} does not match plan ${planId} (expected ${expectedAmount})` }
  }

  const normalizedEmail = email.toLowerCase().trim()
  const supabase = getSupabaseAdmin()

  // Claim the reference BEFORE touching the profile. This insert is the
  // idempotency check — if it fails on the unique constraint, this exact
  // payment has already been recorded (by this route on a retry, or by
  // the other route getting there first), so it's a no-op, not a retry
  // of the profile update.
  const { error: insertError } = await supabase
    .from('paystack_transactions')
    .insert({
      reference,
      email: normalizedEmail,
      plan_id: planId,
      amount: amountSubunit,
      currency,
      source,
    })

  if (insertError) {
    if (insertError.code === '23505') {
      // unique_violation — already processed. Return the profile as it
      // stands rather than treating this as a failure; the caller (e.g.
      // a client that retried after a network blip) should still see a
      // success response.
      const { data: existing } = await supabase
        .from('profiles')
        .select()
        .eq('email', normalizedEmail)
        .maybeSingle()
      if (existing) delete existing.password
      return { ok: true, alreadyProcessed: true, profile: existing || null }
    }
    return { ok: false, status: 500, error: 'Could not record transaction.' }
  }

  const { data: updated, error: updateError } = await supabase
    .from('profiles')
    .update({
      sub_plan: planId,
      sub_plan_name: plan.name,
      sub_car_limit: plan.car_limit,
      sub_status: 'active',
    })
    .eq('email', normalizedEmail)
    .select()
    .maybeSingle()

  if (updateError || !updated) {
    // The reference is already claimed at this point, so a client retry
    // would land in the "already processed" branch above and return a
    // stale profile — flagging this as needing manual reconciliation
    // rather than guessing at a retry/backfill strategy.
    return { ok: false, status: 500, error: 'Payment recorded, but could not update the account. Needs manual reconciliation.' }
  }

  delete updated.password
  return { ok: true, alreadyProcessed: false, profile: updated }
}

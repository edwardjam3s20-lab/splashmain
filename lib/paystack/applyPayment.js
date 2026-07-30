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
import { PLAN_PRICES, OPERATOR_PLAN_PRICES, ORG_PLAN_PRICES } from './plans'

// Orgs aren't keyed by an `email` column the way profiles/operators are —
// the paying identity is the org_user who owns the org (organization_users
// .email), not organizations.business_email (which can be a different,
// public-facing address, or absent entirely). Resolve owner-email ->
// organization_id via organization_members the same way
// lib/requireOrgMember.js's security-boundary comment describes: never
// trust anything but a fresh DB lookup for this link.
async function resolveOrgIdByOwnerEmail(supabase, email) {
  const { data: user } = await supabase
    .from('organization_users')
    .select('id')
    .eq('email', email)
    .maybeSingle()
  if (!user) return null

  const { data: membership } = await supabase
    .from('organization_members')
    .select('organization_id')
    .eq('user_id', user.id)
    .eq('role', 'owner')
    .is('removed_at', null)
    .maybeSingle()

  return membership?.organization_id || null
}

// accountType picks which plan table, which account table ('profiles' vs
// 'operators' vs 'organizations'), and which update shape applies.
// Defaults to 'customer' so every existing caller (verify route, webhook,
// before this param existed) keeps behaving exactly as before without
// being touched.
export async function applyPaystackPayment({ reference, planId, email, amountSubunit, currency, source, accountType = 'customer' }) {
  const isOperator = accountType === 'operator'
  const isOrg = accountType === 'org'
  const plans = isOrg ? ORG_PLAN_PRICES : isOperator ? OPERATOR_PLAN_PRICES : PLAN_PRICES
  const table = isOrg ? 'organizations' : isOperator ? 'operators' : 'profiles'
  const resultKey = isOrg ? 'organization' : isOperator ? 'operator' : 'profile'

  const plan = plans[planId]
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

  // For orgs, resolve the organization_id up front — every branch below
  // (idempotent-replay lookup and the actual update) needs it, and
  // resolving it once here rather than in each branch keeps the two
  // owner-email lookups from drifting out of sync with each other.
  let orgId = null
  if (isOrg) {
    orgId = await resolveOrgIdByOwnerEmail(supabase, normalizedEmail)
    if (!orgId) {
      return { ok: false, status: 404, error: 'No organization found for this account.' }
    }
  }

  // Claim the reference BEFORE touching the account row. This insert is
  // the idempotency check — if it fails on the unique constraint, this
  // exact payment has already been recorded (by this route on a retry, or
  // by the other route getting there first), so it's a no-op, not a retry
  // of the account update.
  const { error: insertError } = await supabase
    .from('paystack_transactions')
    .insert({
      reference,
      email: normalizedEmail,
      plan_id: planId,
      amount: amountSubunit,
      currency,
      source,
      account_type: accountType,
    })

  if (insertError) {
    if (insertError.code === '23505') {
      // unique_violation — already processed. Return the account row as
      // it stands rather than treating this as a failure; the caller
      // (e.g. a client that retried after a network blip) should still
      // see a success response.
      const { data: existing } = isOrg
        ? await supabase.from('organizations').select().eq('id', orgId).maybeSingle()
        : await supabase.from(table).select().eq('email', normalizedEmail).maybeSingle()
      if (existing) delete existing.password
      return { ok: true, alreadyProcessed: true, [resultKey]: existing || null }
    }
    return { ok: false, status: 500, error: 'Could not record transaction.' }
  }

  const updateFields = isOperator || isOrg
    ? { sub_plan: planId, sub_status: 'active' }
    : { sub_plan: planId, sub_plan_name: plan.name, sub_car_limit: plan.car_limit, sub_status: 'active' }

  const { data: updated, error: updateError } = isOrg
    ? await supabase.from('organizations').update(updateFields).eq('id', orgId).select().maybeSingle()
    : await supabase.from(table).update(updateFields).eq('email', normalizedEmail).select().maybeSingle()

  if (updateError || !updated) {
    // The reference is already claimed at this point, so a client retry
    // would land in the "already processed" branch above and return a
    // stale row — flagging this as needing manual reconciliation rather
    // than guessing at a retry/backfill strategy.
    return { ok: false, status: 500, error: 'Payment recorded, but could not update the account. Needs manual reconciliation.' }
  }

  delete updated.password
  return { ok: true, alreadyProcessed: false, [resultKey]: updated }
}

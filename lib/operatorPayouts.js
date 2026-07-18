import { enrichBookingCommission } from './commission'

// Mirrors OperatorPaymentsTab's isEarnedBooking() in
// app/admin/splashpass-admin-intelligence.jsx — a booking only counts
// toward what an operator is owed once it's actually been paid for /
// completed, not just booked.
function isEarnedBooking(b) {
  return (
    b.payment_status === 'paid' ||
    b.payment_status === 'completed' ||
    b.status === 'completed'
  )
}

// Mirrors paidByOp in the same file — only payments that actually landed
// (or were manually recorded as landed) count as "already paid". A
// 'pending'/'submitted' row is deliberately excluded here: that money isn't
// confirmed sent yet, so it shouldn't reduce the owed figure. Concurrent
// double-spend while a payout is in flight is handled separately by the
// idempotency guard in operator-payments/route.js, not by this exclusion.
function isSettledPayment(p) {
  return !p.status || ['completed', 'success', 'manual'].includes(p.status)
}

/**
 * Computes what an operator is actually owed right now, server-side, from
 * real booking + payment records — the same computation the admin
 * dashboard does client-side for display, but here it's the source of
 * truth used to validate a payout request rather than just a number shown
 * in a form.
 *
 * Matching is by wash_point NAME, matching the existing frontend logic
 * (bookings.location === operators.wash_point) rather than operator_id,
 * since that's the join the rest of the app already relies on.
 *
 * @param {object} supabase - service-role Supabase client
 * @param {string} washPoint
 * @param {number|null} operatorId - optional, used only to look up the
 *   operator's commission tier override
 * @returns {Promise<{ owed: number, earned: number, paid: number, bookingCount: number }>}
 */
export async function computeOperatorOwed(supabase, washPoint, operatorId) {
  let tierOverride = null
  if (operatorId) {
    const { data: op } = await supabase
      .from('operators')
      .select('commission_tier')
      .eq('id', operatorId)
      .maybeSingle()
    if (op?.commission_tier != null) tierOverride = op.commission_tier
  }

  const { data: bookings, error: bookingsError } = await supabase
    .from('bookings')
    .select('location, payment_status, status, wash_price, amount, commission_tier, operator_amount, splash_commission')
    .eq('location', washPoint)

  if (bookingsError) {
    throw new Error('Could not load bookings for owed calculation: ' + bookingsError.message)
  }

  const earned = (bookings || [])
    .filter(isEarnedBooking)
    .reduce((sum, b) => {
      const enriched = enrichBookingCommission(b, b.commission_tier ?? tierOverride ?? 1)
      return sum + (enriched.operator_amount || 0)
    }, 0)

  const { data: payments, error: paymentsError } = await supabase
    .from('operator_payments')
    .select('amount, status')
    .eq('wash_point', washPoint)

  if (paymentsError) {
    throw new Error('Could not load prior payments for owed calculation: ' + paymentsError.message)
  }

  const paid = (payments || [])
    .filter(isSettledPayment)
    .reduce((sum, p) => sum + (p.amount || 0), 0)

  return {
    owed: earned - paid,
    earned,
    paid,
    bookingCount: (bookings || []).filter(isEarnedBooking).length,
  }
}

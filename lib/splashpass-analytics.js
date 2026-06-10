/**
 * splashpass-analytics.js
 * -------------------------
 * Central place for all SplashPass PostHog events.
 * Import { analytics } wherever you need to fire an event.
 *
 * Usage:
 *   import { analytics } from '@/lib/splashpass-analytics'
 *   analytics.bookingConfirmed({ bookingId: '123', amount: 500, operatorId: 'op_1' })
 */

import posthog from 'posthog-js'

// ─── Identity ────────────────────────────────────────────────────────────────

/**
 * Call after Supabase auth resolves — identifies the user across sessions.
 * @param {string} userId  - Supabase user UUID
 * @param {object} traits  - { email, phone, role: 'customer' | 'operator' | 'admin' }
 */
export function identifyUser(userId, traits = {}) {
  if (!userId) return
  posthog.identify(userId, {
    email: traits.email || null,
    phone: traits.phone || null,
    role: traits.role || 'customer',
    platform: 'splashpass',
  })
}

/** Call on sign out to disassociate the session */
export function resetIdentity() {
  posthog.reset()
}

// ─── Analytics event map ─────────────────────────────────────────────────────

export const analytics = {

  // ── Auth ──────────────────────────────────────────────────────────────────

  signedUp({ method = 'phone' } = {}) {
    posthog.capture('signed_up', { method })
  },

  loggedIn({ method = 'phone' } = {}) {
    posthog.capture('logged_in', { method })
  },

  loggedOut() {
    posthog.capture('logged_out')
    resetIdentity()
  },

  // ── Booking funnel ────────────────────────────────────────────────────────

  searchPerformed({ query, location, resultsCount }) {
    posthog.capture('splash_search', { query, location, results_count: resultsCount })
  },

  operatorViewed({ operatorId, operatorName }) {
    posthog.capture('operator_viewed', { operator_id: operatorId, operator_name: operatorName })
  },

  serviceSelected({ operatorId, serviceName, price }) {
    posthog.capture('service_selected', {
      operator_id: operatorId,
      service_name: serviceName,
      price,
    })
  },

  checkoutStarted({ totalAmount, loyaltyPointsAvailable, voucherApplied = false }) {
    posthog.capture('checkout_started', {
      total_amount: totalAmount,
      loyalty_points_available: loyaltyPointsAvailable,
      voucher_applied: voucherApplied,
    })
  },

  mpesaInitiated({ amount, phoneMasked }) {
    posthog.capture('mpesa_initiated', { amount, phone_masked: phoneMasked })
  },

  mpesaFailed({ errorCode, amount }) {
    posthog.capture('mpesa_failed', { error_code: errorCode, amount })
  },

  bookingConfirmed({ bookingId, operatorId, amount, washType }) {
    posthog.capture('booking_confirmed', {
      booking_id: bookingId,
      operator_id: operatorId,
      amount,
      wash_type: washType,
    })
  },

  bookingCancelled({ bookingId, reason }) {
    posthog.capture('booking_cancelled', { booking_id: bookingId, reason })
  },

  // ── Loyalty ───────────────────────────────────────────────────────────────

  pointsEarned({ userId, points, newTotal, tier }) {
    posthog.capture('points_earned', {
      user_id: userId,
      points,
      new_total: newTotal,
      tier,
    })
  },

  tierUpgraded({ userId, fromTier, toTier }) {
    posthog.capture('tier_upgraded', { user_id: userId, from_tier: fromTier, to_tier: toTier })
  },

  voucherRedeemed({ voucherCode, discountAmount, bookingId }) {
    posthog.capture('voucher_redeemed', {
      voucher_code: voucherCode,
      discount_amount: discountAmount,
      booking_id: bookingId,
    })
  },

  // ── Operator portal ───────────────────────────────────────────────────────

  operatorDashboardViewed({ operatorId }) {
    posthog.capture('operator_dashboard_viewed', { operator_id: operatorId })
  },

  operatorServiceSaved({ operatorId, serviceName, price, action }) {
    posthog.capture('operator_service_saved', {
      operator_id: operatorId,
      service_name: serviceName,
      price,
      action, // 'create' | 'update' | 'delete'
    })
  },

  operatorBookingCompleted({ bookingId, operatorId, amount }) {
    posthog.capture('operator_booking_completed', {
      booking_id: bookingId,
      operator_id: operatorId,
      amount,
    })
  },

  operatorEarningsViewed({ operatorId, period }) {
    posthog.capture('operator_earnings_viewed', { operator_id: operatorId, period })
  },

  operatorStatusChanged({ operatorId, newStatus }) {
    posthog.capture('operator_status_changed', { operator_id: operatorId, new_status: newStatus })
  },

  // ── Admin panel ───────────────────────────────────────────────────────────

  adminOperatorApproved({ operatorId }) {
    posthog.capture('admin_operator_approved', { operator_id: operatorId })
  },

  adminOperatorSuspended({ operatorId, reason }) {
    posthog.capture('admin_operator_suspended', { operator_id: operatorId, reason })
  },

  adminPayoutProcessed({ operatorId, amount }) {
    posthog.capture('admin_payout_processed', { operator_id: operatorId, amount })
  },

  adminReportExported({ reportType, period }) {
    posthog.capture('admin_report_exported', { report_type: reportType, period })
  },
}

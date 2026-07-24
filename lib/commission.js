/** @typedef {1 | 2} CommissionTier */

// FREEMIUM MODEL: platform revenue now comes entirely from customer +
// operator subscriptions (see TRIAL_DAYS / sub_status gating in
// app/api/bookings/route.js and lib/operatorAccess.js) — no per-wash
// commission. Both tiers zeroed rather than deleted, so every place that
// still reads commission_tier / operator_amount / splash_commission
// (admin dashboard, payout calculations, historical bookings) keeps
// working unchanged, just with 0 platform take on new bookings.
export const COMMISSION_TIERS = {
  1: { label: 'Tier 1', platformRate: 0, operatorRate: 1, platformLabel: '0%', operatorLabel: '100%' },
  2: { label: 'Tier 2', platformRate: 0, operatorRate: 1, platformLabel: '0%', operatorLabel: '100%' },
}

/**
 * @param {unknown} tier
 * @returns {1 | 2}
 */
export function normalizeCommissionTier(tier) {
  return Number(tier) === 2 ? 2 : 1
}

/**
 * Split wash price (excludes app booking fee) between platform and operator.
 * @param {number} washPrice
 * @param {unknown} tier
 */
export function splitWashPrice(washPrice, tier) {
  const t = normalizeCommissionTier(tier)
  const cfg = COMMISSION_TIERS[t]
  const price = Math.round(Number(washPrice) || 0)
  const operatorAmount = Math.round(price * cfg.operatorRate)
  const platformAmount = price - operatorAmount
  return {
    tier: t,
    washPrice: price,
    operatorAmount,
    platformAmount,
    operatorRate: cfg.operatorRate,
    platformRate: cfg.platformRate,
    operatorLabel: cfg.operatorLabel,
    platformLabel: cfg.platformLabel,
    tierLabel: cfg.label,
  }
}

/**
 * Resolve tier: operator override → wash point → default 1.
 */
export function resolveCommissionTier(operatorTier, washPointTier) {
  if (operatorTier != null && operatorTier !== '') {
    return normalizeCommissionTier(operatorTier)
  }
  if (washPointTier != null && washPointTier !== '') {
    return normalizeCommissionTier(washPointTier)
  }
  return 1
}

/**
 * Ensure booking has operator_amount / splash_commission from wash_price when missing.
 */
export function enrichBookingCommission(booking, tier) {
  if (!booking) return booking
  const washPrice = Number(booking.wash_price ?? booking.amount ?? 0)
  const resolvedTier = normalizeCommissionTier(
    booking.commission_tier ?? tier ?? 1
  )
  const split = splitWashPrice(washPrice, resolvedTier)
  const operatorAmount =
    booking.operator_amount != null && booking.operator_amount !== ''
      ? Math.round(Number(booking.operator_amount))
      : split.operatorAmount
  const platformAmount =
    booking.splash_commission != null && booking.splash_commission !== ''
      ? Math.round(Number(booking.splash_commission))
      : washPrice - operatorAmount

  return {
    ...booking,
    commission_tier: resolvedTier,
    operator_amount: operatorAmount,
    splash_commission: platformAmount,
  }
}

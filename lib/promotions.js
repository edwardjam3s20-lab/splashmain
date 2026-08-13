// lib/promotions.js
//
// Shared helper for finding and applying an active promotion. Used by
// app/api/bookings/route.js (server-side, authoritative -- the actual
// price customers pay) and the org-facing promotions CRUD routes.

/**
 * Finds the best-matching active promotion for a booking: a
 * service-specific promotion takes priority over a washpoint-wide one if
 * both exist. Only ONE promotion ever applies per booking -- no stacking.
 */
export async function findActivePromotion(supabase, washPointId, washPointExtraId) {
  const nowIso = new Date().toISOString()

  const { data: promos, error } = await supabase
    .from('promotions')
    .select('*')
    .eq('wash_point_id', washPointId)
    .eq('active', true)
    .lte('starts_at', nowIso)
    .or(`ends_at.is.null,ends_at.gt.${nowIso}`)

  if (error || !promos?.length) return null

  const serviceSpecific = promos.find((p) => p.wash_point_extra_id === washPointExtraId)
  if (serviceSpecific) return serviceSpecific

  return promos.find((p) => p.wash_point_extra_id === null) || null
}

/** Applies a promotion's discount to a price, floored at 0, rounded to the nearest shilling. */
export function applyPromotionDiscount(price, promotion) {
  if (!promotion) return price
  const raw = promotion.discount_type === 'percent'
    ? price * (1 - Number(promotion.discount_value) / 100)
    : price - Number(promotion.discount_value)
  return Math.max(0, Math.round(raw))
}

// lib/orgAccess.js
//
// Org-side equivalent of lib/operatorAccess.js. 14-day free trial from
// organizations.created_at, then a hard gate: trial expired + not
// subscribed blocks org-scoped access. Requires organizations.sub_status
// — see supabase/008_org_freemium.sql. Existing orgs migrated from the
// legacy operator model before that SQL ran were grandfathered to
// sub_status = 'active' by that same migration, so this only ever
// actually gates orgs created after it shipped.
//
// NOTE: this module currently only computes the trial/subscription
// state — it is intentionally NOT yet wired into requireOrgMember or
// any route as an enforcement check. That's a deliberate, separate step
// (see lib/requireOrgMember.js's own comment once that lands) so the
// plumbing (schema, payment activation, frontend trial banner) can be
// verified end-to-end before anyone can actually be locked out.

export const ORG_TRIAL_DAYS = 14

export function isOrgOnTrial(organization) {
  if (!organization?.created_at) return false
  const created = new Date(organization.created_at).getTime()
  const daysLeft = Math.ceil((created + ORG_TRIAL_DAYS * 86400000 - Date.now()) / 86400000)
  const status = organization.sub_status
  return daysLeft > 0 && (!status || status === 'trial' || status === 'pending')
}

export function isOrgSubscribed(organization) {
  return organization?.sub_status === 'active'
}

// True if the organization currently has access (trial or paid) — the
// single check any future gate (requireOrgMember, org login) should call.
export function orgHasAccess(organization) {
  return isOrgOnTrial(organization) || isOrgSubscribed(organization)
}

export function orgTrialDaysLeft(organization) {
  if (!organization?.created_at) return 0
  const created = new Date(organization.created_at).getTime()
  return Math.max(0, Math.ceil((created + ORG_TRIAL_DAYS * 86400000 - Date.now()) / 86400000))
}

// Business rule (confirmed explicitly, not inferred): during the 14-day
// trial or once subscribed, the org keeps 100% of the wash price — no
// platform commission. Once the trial elapses without subscribing, a 20%
// platform commission applies until they do. Deliberately reuses
// orgHasAccess() rather than re-deriving trial/subscribed state a second
// time — same logic that gates org login should be the same logic that
// decides the commission split, not two copies that could drift apart.
//
// Called from app/api/bookings/route.js at booking creation time, using
// whatever the org's status is AT THAT MOMENT. Like commission_tier for
// legacy bookings, this is captured once and never recomputed later — if
// an org subscribes after a booking was already created under the 20%
// rate, that booking keeps its original split. Only future bookings see
// the new rate.
export const ORG_UNSUBSCRIBED_PLATFORM_RATE = 0.20

export function computeOrgCommissionSplit(washPrice, organization) {
  const price = Math.round(Number(washPrice) || 0)
  const hasAccess = orgHasAccess(organization)
  const platformRate = hasAccess ? 0 : ORG_UNSUBSCRIBED_PLATFORM_RATE
  const operatorRate = 1 - platformRate
  const operatorAmount = Math.round(price * operatorRate)
  const platformAmount = price - operatorAmount
  return {
    // Not tier-based for orgs (that's a legacy-model concept) — 1 is a
    // harmless placeholder so this stays insertable into bookings.
    // commission_tier if that column is NOT NULL; the real split is
    // captured in operator_amount/splash_commission below, which is what
    // every downstream reader (enrichBookingCommission,
    // computeOperatorOwed, the org dashboard) actually trusts.
    tier: 1,
    washPrice: price,
    operatorAmount,
    platformAmount,
    operatorRate,
    platformRate,
    operatorLabel: `${Math.round(operatorRate * 100)}%`,
    platformLabel: `${Math.round(platformRate * 100)}%`,
    tierLabel: hasAccess ? 'Trial/Subscribed' : 'Unsubscribed',
  }
}

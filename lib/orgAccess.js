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

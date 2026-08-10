// lib/cashEligibility.js
//
// Whether a wash point is currently eligible to accept cash payments: the
// organization that owns it must currently have access -- trial or paid
// subscription, see lib/orgAccess.js's orgHasAccess(). Deliberately the
// SAME threshold that already gives an org 0% platform commission on
// app-mediated (M-Pesa/wallet) payments (computeOrgCommissionSplit). An
// org below that threshold is exactly the case the 20% unsubscribed
// commission exists to capture -- letting them take cash directly would
// just be a way around it, since cash never touches the platform at all.
//
// Wash points with no organization_id (predating the organization model)
// are never cash-eligible -- there's no subscription concept to check for
// them.
//
// Used from two places, deliberately kept as one shared function rather
// than two copies: app/api/customer/bookings/route.js (so the client can
// decide whether to show the Cash option at all) and
// app/api/bookings/pay-cash/route.js (which re-derives this itself rather
// than trusting whatever the client showed, since the client-side check
// is a display convenience, not the actual security boundary).

import { orgHasAccess } from './orgAccess.js'

export async function isWashPointCashEligible(supabase, washPointName) {
  if (!washPointName) return false

  const { data: washPoint } = await supabase
    .from('wash_points')
    .select('organization_id')
    .eq('name', washPointName)
    .maybeSingle()

  if (!washPoint?.organization_id) return false

  const { data: organization } = await supabase
    .from('organizations')
    .select('sub_status, created_at')
    .eq('id', washPoint.organization_id)
    .maybeSingle()

  if (!organization) return false

  return orgHasAccess(organization)
}

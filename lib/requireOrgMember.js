// lib/requireOrgMember.js
// Resolves org membership + role for a SPECIFIC organization, fresh from
// organization_members on every call. This is the enforcement point the
// SaaS spec describes as the security boundary:
//   Authenticated User -> organization_members -> organization_id ->
//   authorized organization resources.
//
// Never trust an organization_id or role carried in a client-supplied
// token or request body for authorization decisions — the caller passes
// the organization_id they're claiming access to, and this verifies it
// server-side against the DB before anything downstream trusts it. Every
// future org-scoped route (washpoints, staff, payouts, settings) should
// call this rather than re-deriving membership itself.
//
// SUBSCRIPTION GATE: added last, deliberately, after every other piece of
// the freemium build (schema, payment activation via Paystack/M-Pesa,
// org/auth/me exposing sub_status + trial_days_left, the frontend trial
// banner and OrgSubscribeScreen) had already shipped and been exercised.
// This is THE single choke point every org-scoped route already flows
// through, same role requireOperator+operatorHasAccess play for the
// legacy operator app — mirrors that gate exactly (org-wide rather than
// per-account: an unpaid org blocks every member, owner included, not
// just the owner), and reuses lib/orgAccess.js's orgHasAccess check, not
// a re-derived version of the same trial math.
import { requireOrgUser } from '@/lib/requireOrgUser'
import { getSupabaseAdmin } from '@/lib/supabase'
import { orgHasAccess } from '@/lib/orgAccess'

/**
 * @param {string} organizationId
 * @param {string[]|null} allowedRoles - e.g. ['owner'] or ['owner','manager']. null = any active role.
 */
export async function requireOrgMember(organizationId, allowedRoles = null) {
  const auth = await requireOrgUser()
  if (auth.error) return auth
  if (!organizationId) return { error: 'organization_id required', status: 400 }

  const supabase = getSupabaseAdmin()

  const { data: member, error: memberError } = await supabase
    .from('organization_members')
    .select('id, organization_id, user_id, role, status')
    .eq('organization_id', organizationId)
    .eq('user_id', auth.user.id)
    .is('removed_at', null)
    .maybeSingle()

  if (memberError) return { error: 'Could not verify membership', status: 500 }
  if (!member || member.status !== 'active') {
    return { error: 'Not a member of this organization', status: 403 }
  }
  if (allowedRoles && !allowedRoles.includes(member.role)) {
    return { error: 'Insufficient permissions', status: 403 }
  }

  const { data: organization, error: orgError } = await supabase
    .from('organizations')
    .select('*')
    .eq('id', organizationId)
    .maybeSingle()

  if (orgError || !organization) return { error: 'Organization not found', status: 404 }
  if (organization.suspended_at) return { error: 'Organization is suspended', status: 403 }

  // organization.created_at is always present (see migration note in
  // lib/orgAccess.js), so this — unlike the operator gate's "only once
  // the column migration has actually run" guard — is unconditional from
  // the moment 008_org_freemium.sql ships.
  if (!orgHasAccess(organization)) {
    return {
      error: 'Your 14-day free trial has ended. The organization owner needs to subscribe to keep using SplashPass.',
      code: 'SUBSCRIPTION_REQUIRED',
      status: 402,
    }
  }

  return { user: auth.user, member, organization }
}

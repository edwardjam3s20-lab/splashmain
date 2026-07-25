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
import { requireOrgUser } from '@/lib/requireOrgUser'
import { getSupabaseAdmin } from '@/lib/supabase'

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

  return { user: auth.user, member, organization }
}

// lib/requireWashpointMember.js
// Resolves org + role (via requireOrgMember) AND verifies the acting
// member can act at a SPECIFIC washpoint. Owners can act at any washpoint
// in their org; manager/attendant only at washpoints they're explicitly
// assigned to via washpoint_members.
//
// This is the org-model equivalent of the legacy operator model's
// implicit "one operator, one wash_point" pinning (requireOperator() +
// op.wash_point) -- but correct for staff who can be assigned to more
// than one location, which the old model never had to handle.
import { requireOrgMember } from '@/lib/requireOrgMember'
import { getSupabaseAdmin } from '@/lib/supabase'

export async function requireWashpointMember(organizationId, washpointId, allowedRoles = null) {
  const auth = await requireOrgMember(organizationId, allowedRoles)
  if (auth.error) return auth
  if (!washpointId) return { error: 'washpoint_id required', status: 400 }

  const supabase = getSupabaseAdmin()
  const { data: washpoint, error: wpError } = await supabase
    .from('wash_points')
    .select('*')
    .eq('id', washpointId)
    .eq('organization_id', organizationId)
    .maybeSingle()

  if (wpError) return { error: 'Could not verify washpoint', status: 500 }
  if (!washpoint) return { error: 'Washpoint not found in this organization', status: 404 }

  if (auth.member.role !== 'owner') {
    const { data: assignment } = await supabase
      .from('washpoint_members')
      .select('id')
      .eq('organization_member_id', auth.member.id)
      .eq('washpoint_id', washpointId)
      .maybeSingle()
    if (!assignment) {
      return { error: 'You are not assigned to this washpoint', status: 403 }
    }
  }

  return { ...auth, washpoint }
}

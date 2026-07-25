// lib/requireOrgUser.js
// Resolves the authenticated organization_users row from the session
// cookie. This is the "am I logged in at all" check — it does NOT resolve
// an organization or role. Use this for account-level routes (profile,
// business creation before an org exists). For anything scoped to a
// specific organization, use requireOrgMember() instead, which calls this
// first and then checks organization_members.
import { getOrgSession } from '@/lib/orgSession'
import { getSupabaseAdmin } from '@/lib/supabase'

export async function requireOrgUser() {
  const session = await getOrgSession()
  if (!session?.userId || session.pending) return { error: 'Unauthorized', status: 401 }

  const supabase = getSupabaseAdmin()
  const { data: user, error } = await supabase
    .from('organization_users')
    .select('id, email, phone, full_name, email_verified_at, phone_verified_at, created_at')
    .eq('id', session.userId)
    .maybeSingle()

  if (error) return { error: 'Could not load account', status: 500 }
  if (!user) return { error: 'Account not found', status: 401 }

  return { user }
}

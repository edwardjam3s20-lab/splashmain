// app/api/org/washpoints/[id]/route.js
// PATCH — edit a washpoint's details (name, area, phone, hours,
// description) and/or toggle active/inactive. Owner-only, same reasoning
// as POST in the sibling route: "Create/edit/remove washpoints" is
// explicitly Owner scope in the spec, narrower than a Manager's "Manage
// assigned washpoints".
//
// Body: any subset of { name, area, phone, opens_at, closes_at,
//        description, active }

import { NextResponse } from 'next/server'
import { requireOrgMember } from '@/lib/requireOrgMember'
import { getSupabaseAdmin } from '@/lib/supabase'
import { orgCorsHeaders } from '@/lib/orgCors'

const EDITABLE_FIELDS = ['name', 'area', 'phone', 'opens_at', 'closes_at', 'description', 'active']

export async function OPTIONS(request) {
  const origin = request.headers.get('origin') || ''
  return new NextResponse(null, { status: 200, headers: orgCorsHeaders(origin) })
}

export async function PATCH(request, { params }) {
  const origin = request.headers.get('origin') || ''
  const body = await request.json().catch(() => ({}))
  const { organization_id: organizationId } = body || {}

  const auth = await requireOrgMember(organizationId, ['owner'])
  if (auth.error) {
    return NextResponse.json({ error: auth.error }, { status: auth.status, headers: orgCorsHeaders(origin) })
  }

  const supabase = getSupabaseAdmin()

  // Confirm this washpoint actually belongs to the organization the caller
  // authenticated against — never trust the [id] alone.
  const { data: existing, error: fetchError } = await supabase
    .from('wash_points')
    .select('id')
    .eq('id', params.id)
    .eq('organization_id', organizationId)
    .maybeSingle()

  if (fetchError) return NextResponse.json({ error: 'Could not load washpoint.' }, { status: 500, headers: orgCorsHeaders(origin) })
  if (!existing) return NextResponse.json({ error: 'Washpoint not found in this organization.' }, { status: 404, headers: orgCorsHeaders(origin) })

  const updates = {}
  for (const field of EDITABLE_FIELDS) {
    if (body[field] === undefined) continue
    if (field === 'name' || field === 'area') {
      const value = String(body[field] || '').trim()
      if (!value) {
        return NextResponse.json({ error: `${field} cannot be empty.` }, { status: 400, headers: orgCorsHeaders(origin) })
      }
      updates[field] = value
    } else if (field === 'active') {
      updates.active = Boolean(body.active)
    } else {
      updates[field] = body[field] || null
    }
  }

  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: 'No changes provided.' }, { status: 400, headers: orgCorsHeaders(origin) })
  }

  const { data: washpoint, error: updateError } = await supabase
    .from('wash_points')
    .update(updates)
    .eq('id', params.id)
    .select()
    .single()

  if (updateError) {
    console.error('[org washpoints PATCH] update error:', updateError.message)
    return NextResponse.json({ error: 'Could not update washpoint.' }, { status: 500, headers: orgCorsHeaders(origin) })
  }

  await supabase.from('audit_logs').insert({
    organization_id: organizationId,
    actor_user_id: auth.user.id,
    actor_type: 'organization_user',
    action: 'washpoint.updated',
    target_type: 'washpoint',
    target_id: params.id,
    metadata: { fields: Object.keys(updates) },
  })

  return NextResponse.json({ ok: true, washpoint }, { headers: orgCorsHeaders(origin) })
}

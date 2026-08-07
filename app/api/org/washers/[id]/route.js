// app/api/org/washers/[id]/route.js
// PATCH — edit a washer's name/role. DELETE — remove one. Owner/manager
// only, same scope as POST in the sibling route (attendants can use the
// roster to assign, not manage who's on it).
//
// Body (both): { organization_id, washpoint_id } required for auth, since
// requireWashpointMember needs both to resolve role + washpoint scope.

import { NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabase'
import { requireWashpointMember } from '@/lib/requireWashpointMember'
import { orgCorsHeaders } from '@/lib/orgCors'

export async function OPTIONS(request) {
  const origin = request.headers.get('origin') || ''
  return new NextResponse(null, { status: 200, headers: orgCorsHeaders(origin) })
}

// Same ownership check as the legacy route -- confirms this washer
// actually belongs to the washpoint requireWashpointMember just verified
// the caller can act at, not just any washpoint in any organization.
async function assertOwnsWasher(supabase, washpointId, id) {
  const { data, error } = await supabase
    .from('wash_point_staff')
    .select('id, wash_point_id')
    .eq('id', id)
    .maybeSingle()
  if (error || !data) return false
  return String(data.wash_point_id) === String(washpointId)
}

export async function PATCH(request, { params }) {
  const origin = request.headers.get('origin') || ''
  const body = await request.json().catch(() => ({}))
  const { organization_id: organizationId, washpoint_id: washpointId, name, role } = body || {}

  const auth = await requireWashpointMember(organizationId, washpointId, ['owner', 'manager'])
  if (auth.error) {
    return NextResponse.json({ error: auth.error }, { status: auth.status, headers: orgCorsHeaders(origin) })
  }

  const supabase = getSupabaseAdmin()
  const owns = await assertOwnsWasher(supabase, washpointId, params.id)
  if (!owns) {
    return NextResponse.json({ error: 'Washer not found' }, { status: 404, headers: orgCorsHeaders(origin) })
  }

  const updates = {}
  if (name !== undefined) {
    const value = String(name).trim()
    if (!value) return NextResponse.json({ error: 'Name cannot be empty.' }, { status: 400, headers: orgCorsHeaders(origin) })
    updates.name = value
  }
  if (role !== undefined) updates.role = role || null

  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: 'No changes provided.' }, { status: 400, headers: orgCorsHeaders(origin) })
  }

  const { data, error } = await supabase
    .from('wash_point_staff')
    .update(updates)
    .eq('id', params.id)
    .select()
    .single()

  if (error) {
    console.error('[org washers PATCH] error:', error.message)
    return NextResponse.json({ error: error.message }, { status: 500, headers: orgCorsHeaders(origin) })
  }

  return NextResponse.json({ ok: true, washer: data }, { headers: orgCorsHeaders(origin) })
}

export async function DELETE(request, { params }) {
  const origin = request.headers.get('origin') || ''
  const body = await request.json().catch(() => ({}))
  const { organization_id: organizationId, washpoint_id: washpointId } = body || {}

  const auth = await requireWashpointMember(organizationId, washpointId, ['owner', 'manager'])
  if (auth.error) {
    return NextResponse.json({ error: auth.error }, { status: auth.status, headers: orgCorsHeaders(origin) })
  }

  const supabase = getSupabaseAdmin()
  const owns = await assertOwnsWasher(supabase, washpointId, params.id)
  if (!owns) {
    return NextResponse.json({ error: 'Washer not found' }, { status: 404, headers: orgCorsHeaders(origin) })
  }

  const { error } = await supabase.from('wash_point_staff').delete().eq('id', params.id)
  if (error) {
    console.error('[org washers DELETE] error:', error.message)
    return NextResponse.json({ error: error.message }, { status: 500, headers: orgCorsHeaders(origin) })
  }

  return NextResponse.json({ ok: true }, { headers: orgCorsHeaders(origin) })
}

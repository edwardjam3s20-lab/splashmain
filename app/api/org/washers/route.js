// app/api/org/washers/route.js
// GET  — list washers (wash_point_staff) at a washpoint. Any active role.
// POST — add a washer. Owner/manager only -- attendants can use the
// roster to assign, not manage who's on it.
//
// Query/body param: washpoint_id (organization_id required for auth too)

import { NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabase'
import { requireWashpointMember } from '@/lib/requireWashpointMember'
import { orgCorsHeaders } from '@/lib/orgCors'

export async function OPTIONS(request) {
  const origin = request.headers.get('origin') || ''
  return new NextResponse(null, { status: 200, headers: orgCorsHeaders(origin) })
}

export async function GET(request) {
  const origin = request.headers.get('origin') || ''
  const { searchParams } = new URL(request.url)
  const organizationId = searchParams.get('organization_id')
  const washpointId = searchParams.get('washpoint_id')

  const auth = await requireWashpointMember(organizationId, washpointId)
  if (auth.error) {
    return NextResponse.json({ error: auth.error }, { status: auth.status, headers: orgCorsHeaders(origin) })
  }

  const supabase = getSupabaseAdmin()
  const { data, error } = await supabase
    .from('wash_point_staff')
    .select('*')
    .eq('wash_point_id', washpointId)
    .order('name')

  if (error) {
    console.error('[org washers GET] error:', error.message)
    return NextResponse.json({ error: error.message }, { status: 500, headers: orgCorsHeaders(origin) })
  }

  return NextResponse.json({ washers: data || [] }, { headers: orgCorsHeaders(origin) })
}

export async function POST(request) {
  const origin = request.headers.get('origin') || ''
  const body = await request.json().catch(() => ({}))
  const { organization_id: organizationId, washpoint_id: washpointId, name, role } = body || {}

  const auth = await requireWashpointMember(organizationId, washpointId, ['owner', 'manager'])
  if (auth.error) {
    return NextResponse.json({ error: auth.error }, { status: auth.status, headers: orgCorsHeaders(origin) })
  }
  if (!name || !String(name).trim()) {
    return NextResponse.json({ error: 'Washer name is required.' }, { status: 400, headers: orgCorsHeaders(origin) })
  }

  const supabase = getSupabaseAdmin()
  const { data, error } = await supabase
    .from('wash_point_staff')
    .insert({ wash_point_id: washpointId, name: String(name).trim(), role: role || null })
    .select()
    .single()

  if (error) {
    console.error('[org washers POST] error:', error.message)
    return NextResponse.json({ error: error.message }, { status: 500, headers: orgCorsHeaders(origin) })
  }

  return NextResponse.json({ ok: true, washer: data }, { headers: orgCorsHeaders(origin) })
}

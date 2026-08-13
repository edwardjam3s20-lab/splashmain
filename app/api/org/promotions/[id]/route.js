// app/api/org/promotions/[id]/route.js
// PATCH  — edit a promotion (including toggling `active`)
// DELETE — remove a promotion entirely

import { NextResponse } from 'next/server'
import { requireOrgMember } from '@/lib/requireOrgMember'
import { getSupabaseAdmin } from '@/lib/supabase'
import { orgCorsHeaders } from '@/lib/orgCors'

const EDITABLE_FIELDS = ['title', 'description', 'discount_type', 'discount_value', 'starts_at', 'ends_at', 'active']

export async function OPTIONS(request) {
  const origin = request.headers.get('origin') || ''
  return new NextResponse(null, { status: 200, headers: orgCorsHeaders(origin) })
}

async function loadOwnedPromotion(supabase, promotionId, organizationId) {
  return supabase
    .from('promotions')
    .select('*')
    .eq('id', promotionId)
    .eq('organization_id', organizationId)
    .maybeSingle()
}

export async function PATCH(request, { params }) {
  const origin = request.headers.get('origin') || ''
  const body = await request.json().catch(() => ({}))
  const { organization_id: organizationId } = body || {}

  const auth = await requireOrgMember(organizationId, ['owner', 'manager'])
  if (auth.error) {
    return NextResponse.json({ error: auth.error }, { status: auth.status, headers: orgCorsHeaders(origin) })
  }

  const supabase = getSupabaseAdmin()
  const { data: existing, error: fetchError } = await loadOwnedPromotion(supabase, params.id, organizationId)
  if (fetchError) return NextResponse.json({ error: 'Could not load promotion.' }, { status: 500, headers: orgCorsHeaders(origin) })
  if (!existing) return NextResponse.json({ error: 'Promotion not found in this organization.' }, { status: 404, headers: orgCorsHeaders(origin) })

  const updates = {}
  for (const field of EDITABLE_FIELDS) {
    if (!(field in body)) continue
    if (field === 'title') {
      if (!body.title?.trim()) return NextResponse.json({ error: 'title cannot be empty.' }, { status: 400, headers: orgCorsHeaders(origin) })
      updates.title = body.title.trim()
    } else if (field === 'discount_type') {
      if (!['percent', 'fixed'].includes(body.discount_type)) {
        return NextResponse.json({ error: 'discount_type must be "percent" or "fixed".' }, { status: 400, headers: orgCorsHeaders(origin) })
      }
      updates.discount_type = body.discount_type
    } else if (field === 'discount_value') {
      const value = Number(body.discount_value)
      const type = body.discount_type || existing.discount_type
      if (!Number.isFinite(value) || value <= 0 || (type === 'percent' && value > 100)) {
        return NextResponse.json({ error: 'Invalid discount_value.' }, { status: 400, headers: orgCorsHeaders(origin) })
      }
      updates.discount_value = value
    } else if (field === 'active') {
      updates.active = Boolean(body.active)
    } else {
      updates[field] = body[field] ?? null
    }
  }

  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: 'No valid fields to update.' }, { status: 400, headers: orgCorsHeaders(origin) })
  }

  const { data: updated, error: updateError } = await supabase
    .from('promotions')
    .update(updates)
    .eq('id', params.id)
    .select()
    .single()

  if (updateError) {
    console.error('[org promotions] update error:', updateError.message)
    return NextResponse.json({ error: 'Could not update promotion.' }, { status: 500, headers: orgCorsHeaders(origin) })
  }

  await supabase.from('audit_logs').insert({
    organization_id: organizationId,
    actor_user_id: auth.user.id,
    actor_type: 'organization_user',
    action: 'promotion.updated',
    target_type: 'promotion',
    target_id: params.id,
    metadata: updates,
  })

  return NextResponse.json({ ok: true, promotion: updated }, { headers: orgCorsHeaders(origin) })
}

export async function DELETE(request, { params }) {
  const origin = request.headers.get('origin') || ''
  const body = await request.json().catch(() => ({}))
  const { organization_id: organizationId } = body || {}

  const auth = await requireOrgMember(organizationId, ['owner', 'manager'])
  if (auth.error) {
    return NextResponse.json({ error: auth.error }, { status: auth.status, headers: orgCorsHeaders(origin) })
  }

  const supabase = getSupabaseAdmin()
  const { data: existing, error: fetchError } = await loadOwnedPromotion(supabase, params.id, organizationId)
  if (fetchError) return NextResponse.json({ error: 'Could not load promotion.' }, { status: 500, headers: orgCorsHeaders(origin) })
  if (!existing) return NextResponse.json({ error: 'Promotion not found in this organization.' }, { status: 404, headers: orgCorsHeaders(origin) })

  const { error: deleteError } = await supabase.from('promotions').delete().eq('id', params.id)
  if (deleteError) {
    console.error('[org promotions] delete error:', deleteError.message)
    return NextResponse.json({ error: 'Could not delete promotion.' }, { status: 500, headers: orgCorsHeaders(origin) })
  }

  await supabase.from('audit_logs').insert({
    organization_id: organizationId,
    actor_user_id: auth.user.id,
    actor_type: 'organization_user',
    action: 'promotion.deleted',
    target_type: 'promotion',
    target_id: params.id,
    metadata: { title: existing.title },
  })

  return NextResponse.json({ ok: true }, { headers: orgCorsHeaders(origin) })
}

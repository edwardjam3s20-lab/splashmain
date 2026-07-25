// app/api/org/business/route.js
// POST — Step 2+3 of onboarding: create the organization, make the caller
// its Owner, and write the first organization_verifications submission.
// Requires a verified organization_users account; does NOT require an
// existing organization — this is what creates one.
//
// Body: { name, businessType, registrationNumber, kraPin, businessPhone,
//         businessEmail, address, lat, lng }

import { NextResponse } from 'next/server'
import { requireOrgUser } from '@/lib/requireOrgUser'
import { getSupabaseAdmin } from '@/lib/supabase'
import { orgCorsHeaders } from '@/lib/orgCors'

const BUSINESS_TYPES = new Set(['sole_proprietor', 'partnership', 'registered_company', 'other'])

export async function OPTIONS(request) {
  const origin = request.headers.get('origin') || ''
  return new NextResponse(null, { status: 200, headers: orgCorsHeaders(origin) })
}

export async function POST(request) {
  const origin = request.headers.get('origin') || ''

  const auth = await requireOrgUser()
  if (auth.error) {
    return NextResponse.json(
      { error: auth.error },
      { status: auth.status, headers: orgCorsHeaders(origin) }
    )
  }

  if (!auth.user.email_verified_at) {
    return NextResponse.json(
      { error: 'Verify your email before continuing.' },
      { status: 403, headers: orgCorsHeaders(origin) }
    )
  }

  const body = await request.json().catch(() => ({}))
  const {
    name, businessType, registrationNumber, kraPin,
    businessPhone, businessEmail, address, lat, lng,
  } = body || {}

  if (!name || !String(name).trim()) {
    return NextResponse.json(
      { error: 'Business name is required.' },
      { status: 400, headers: orgCorsHeaders(origin) }
    )
  }
  const cleanType = BUSINESS_TYPES.has(businessType) ? businessType : 'sole_proprietor'

  const supabase = getSupabaseAdmin()

  // One owner account can't create a second organization through this
  // route — additional locations belong inside a single organization as
  // more washpoints, not as separate organizations. (The same person CAN
  // still be invited as staff into someone else's org — this only blocks
  // creating a second org of their own.)
  const { data: alreadyOwns } = await supabase
    .from('organization_members')
    .select('organization_id')
    .eq('user_id', auth.user.id)
    .eq('role', 'owner')
    .is('removed_at', null)
    .maybeSingle()

  if (alreadyOwns) {
    return NextResponse.json(
      { error: 'You already own an organization.', organization_id: alreadyOwns.organization_id },
      { status: 409, headers: orgCorsHeaders(origin) }
    )
  }

  const { data: organization, error: orgError } = await supabase
    .from('organizations')
    .insert({
      name: String(name).trim(),
      business_type: cleanType,
      registration_number: registrationNumber || null,
      kra_pin: kraPin || null,
      business_phone: businessPhone || null,
      business_email: businessEmail || null,
      address: address || null,
      lat: typeof lat === 'number' ? lat : null,
      lng: typeof lng === 'number' ? lng : null,
      verification_status: 'submitted',
    })
    .select()
    .single()

  if (orgError || !organization) {
    console.error('[org business] organization insert error:', orgError?.message)
    return NextResponse.json(
      { error: 'Could not create organization.' },
      { status: 500, headers: orgCorsHeaders(origin) }
    )
  }

  const { error: memberError } = await supabase.from('organization_members').insert({
    organization_id: organization.id,
    user_id: auth.user.id,
    role: 'owner',
    status: 'active',
  })

  if (memberError) {
    // Roll back the orphaned organization row rather than leaving one with
    // no owner — nothing could ever manage it.
    console.error('[org business] owner membership insert error:', memberError.message)
    await supabase.from('organizations').delete().eq('id', organization.id)
    return NextResponse.json(
      { error: 'Could not create organization.' },
      { status: 500, headers: orgCorsHeaders(origin) }
    )
  }

  const { error: verificationError } = await supabase.from('organization_verifications').insert({
    organization_id: organization.id,
    submitted_data: {
      name: organization.name,
      business_type: cleanType,
      registration_number: registrationNumber || null,
      kra_pin: kraPin || null,
      business_phone: businessPhone || null,
      business_email: businessEmail || null,
      address: address || null,
    },
    status: 'submitted',
  })

  if (verificationError) {
    // Non-fatal: the organization and ownership are real either way — an
    // admin can still see it in `organizations`, and submission can retry.
    console.error('[org business] verification record failed:', verificationError.message)
  }

  await supabase.from('audit_logs').insert({
    organization_id: organization.id,
    actor_user_id: auth.user.id,
    actor_type: 'organization_user',
    action: 'organization.created',
    target_type: 'organization',
    target_id: organization.id,
    metadata: { business_type: cleanType },
  })

  return NextResponse.json(
    { ok: true, organization },
    { headers: orgCorsHeaders(origin) }
  )
}

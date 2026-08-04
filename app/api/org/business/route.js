// app/api/org/business/route.js
// GET  — the caller's own organization (if they own one) plus the latest
//        review note, for prefilling the resubmission form so a rejected/
//        action_required owner doesn't retype everything from scratch.
// POST — Step 2+3 of onboarding: create the organization the first time,
//        or RESUBMIT if the caller already owns one that's
//        action_required/rejected (fixed and sending it back for review).
//        Any other existing-org state (submitted/under_review/verified/
//        suspended) still 409s -- this route isn't a general "edit my
//        business" endpoint, just first-submission and fix-and-resend.
//
// Body: { name, businessType, registrationNumber, kraPin, businessPhone,
//         businessEmail, address, lat, lng }

import { NextResponse } from 'next/server'
import { requireOrgUser } from '@/lib/requireOrgUser'
import { getSupabaseAdmin } from '@/lib/supabase'
import { orgCorsHeaders } from '@/lib/orgCors'
import { notifyAdminOrgSubmission } from '@/lib/notifyAdminOrgSubmission'

const BUSINESS_TYPES = new Set(['sole_proprietor', 'partnership', 'registered_company', 'other'])
const RESUBMIT_FROM = new Set(['action_required', 'rejected'])

export async function OPTIONS(request) {
  const origin = request.headers.get('origin') || ''
  return new NextResponse(null, { status: 200, headers: orgCorsHeaders(origin) })
}

export async function GET(request) {
  const origin = request.headers.get('origin') || ''

  const auth = await requireOrgUser()
  if (auth.error) {
    return NextResponse.json({ error: auth.error }, { status: auth.status, headers: orgCorsHeaders(origin) })
  }

  const supabase = getSupabaseAdmin()
  const { data: membership } = await supabase
    .from('organization_members')
    .select('organization_id')
    .eq('user_id', auth.user.id)
    .eq('role', 'owner')
    .is('removed_at', null)
    .maybeSingle()

  if (!membership) {
    return NextResponse.json({ organization: null, latest_review: null }, { headers: orgCorsHeaders(origin) })
  }

  const { data: organization } = await supabase
    .from('organizations')
    .select('*')
    .eq('id', membership.organization_id)
    .maybeSingle()

  const { data: latestReview } = await supabase
    .from('organization_verifications')
    .select('status, notes, reviewed_by, reviewed_at')
    .eq('organization_id', membership.organization_id)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  return NextResponse.json({ organization, latest_review: latestReview || null }, { headers: orgCorsHeaders(origin) })
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

  const submittedData = {
    name: String(name).trim(),
    business_type: cleanType,
    registration_number: registrationNumber || null,
    kra_pin: kraPin || null,
    business_phone: businessPhone || null,
    business_email: businessEmail || null,
    address: address || null,
  }

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
    const { data: existingOrg } = await supabase
      .from('organizations')
      .select('id, verification_status')
      .eq('id', alreadyOwns.organization_id)
      .maybeSingle()

    if (!existingOrg || !RESUBMIT_FROM.has(existingOrg.verification_status)) {
      return NextResponse.json(
        { error: 'You already own an organization.', organization_id: alreadyOwns.organization_id },
        { status: 409, headers: orgCorsHeaders(origin) }
      )
    }

    // Resubmission: same organization row, updated details, back to
    // 'submitted' for another review pass -- not a new organization, and
    // not a new owner membership (that already exists and is untouched).
    const { data: updatedOrg, error: updateError } = await supabase
      .from('organizations')
      .update({
        name: submittedData.name,
        business_type: submittedData.business_type,
        registration_number: submittedData.registration_number,
        kra_pin: submittedData.kra_pin,
        business_phone: submittedData.business_phone,
        business_email: submittedData.business_email,
        address: submittedData.address,
        lat: typeof lat === 'number' ? lat : null,
        lng: typeof lng === 'number' ? lng : null,
        verification_status: 'submitted',
        updated_at: new Date().toISOString(),
      })
      .eq('id', existingOrg.id)
      .select()
      .single()

    if (updateError || !updatedOrg) {
      console.error('[org business] resubmit update error:', updateError?.message)
      return NextResponse.json({ error: 'Could not resubmit your business details.' }, { status: 500, headers: orgCorsHeaders(origin) })
    }

    const { error: verificationError } = await supabase.from('organization_verifications').insert({
      organization_id: existingOrg.id,
      submitted_data: submittedData,
      status: 'submitted',
    })
    if (verificationError) {
      console.error('[org business] resubmit verification record failed:', verificationError.message)
    }

    await supabase.from('audit_logs').insert({
      organization_id: existingOrg.id,
      actor_user_id: auth.user.id,
      actor_type: 'organization_user',
      action: 'organization.resubmitted',
      target_type: 'organization',
      target_id: existingOrg.id,
      metadata: { from_status: existingOrg.verification_status },
    })

    // Fire-and-forget: a failed notification email must never block the
    // owner's resubmission response, which is why this isn't awaited into
    // the response path with error handling of its own -- see
    // notifyAdminOrgSubmission's internal try/catch-equivalent.
    notifyAdminOrgSubmission({ organization: updatedOrg, isResubmission: true }).catch((err) => {
      console.error('[org business] resubmit admin notification failed:', err?.message)
    })

    return NextResponse.json({ ok: true, organization: updatedOrg, resubmitted: true }, { headers: orgCorsHeaders(origin) })
  }

  const { data: organization, error: orgError } = await supabase
    .from('organizations')
    .insert({
      ...submittedData,
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
    submitted_data: submittedData,
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

  // Fire-and-forget, same reasoning as the resubmission branch above.
  notifyAdminOrgSubmission({ organization, isResubmission: false }).catch((err) => {
    console.error('[org business] admin notification failed:', err?.message)
  })

  return NextResponse.json(
    { ok: true, organization },
    { headers: orgCorsHeaders(origin) }
  )
}

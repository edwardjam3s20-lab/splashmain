// lib/notifyOrgVerificationUpdate.js
// Emails the organization's owner whenever an admin takes a review action
// (approve / request_changes / reject / suspend / restore). The onboarding
// frontend's STATUS_COPY already promises "we'll email you" / "check your
// email for details" for nearly every one of these outcomes -- nothing
// previously sent anything, so that promise was false for every status
// except the ones the owner just happened to notice by refreshing the
// onboarding-complete screen themselves.
//
// Sends to organizations.business_email if present, but organization_users
// (the actual login account) is the reliable source -- business_email is
// an optional field on the application, the login email always exists and
// is verified. Falls back to the owner's login email, and only uses
// business_email as a display nicety if the owner's own email is somehow
// unavailable.
//
// Non-fatal by design, same reasoning as notifyAdminOrgSubmission.js.

import { Resend } from 'resend'
import { getSupabaseAdmin } from './supabase'

const resend = new Resend(process.env.RESEND_API_KEY)

const COPY = {
  approve: {
    subject: (name) => `${name} is verified — you're live on SplashPass`,
    heading: "You're live",
    body: 'Your business is verified and your washpoint is ready to accept SplashPass customers.',
  },
  request_changes: {
    subject: (name) => `Action needed on your SplashPass application for ${name}`,
    heading: 'Action required',
    body: 'We need a bit more information before we can verify your business:',
  },
  reject: {
    subject: (name) => `Update on your SplashPass application for ${name}`,
    heading: 'Application not approved',
    body: "Your business application wasn't approved this time:",
  },
  suspend: {
    subject: (name) => `Your SplashPass account for ${name} has been suspended`,
    heading: 'Account suspended',
    body: 'Your organization has been suspended:',
  },
  restore: {
    subject: (name) => `${name} is verified again on SplashPass`,
    heading: "You're live again",
    body: 'Your organization has been restored and your washpoint(s) are accepting SplashPass customers again.',
  },
}

export async function notifyOrgVerificationUpdate({ organization, action, notes }) {
  const copy = COPY[action]
  if (!copy) return // unknown action -- nothing to send, caller already validated it

  const supabase = getSupabaseAdmin()

  const { data: ownerMembership } = await supabase
    .from('organization_members')
    .select('user_id')
    .eq('organization_id', organization.id)
    .eq('role', 'owner')
    .is('removed_at', null)
    .maybeSingle()

  let toEmail = organization.business_email || null
  if (ownerMembership?.user_id) {
    const { data: owner } = await supabase
      .from('organization_users')
      .select('email')
      .eq('id', ownerMembership.user_id)
      .maybeSingle()
    if (owner?.email) toEmail = owner.email
  }

  if (!toEmail) {
    console.warn(`[notifyOrgVerificationUpdate] no email found for organization ${organization.id} — skipping.`)
    return
  }

  const { error: emailError } = await resend.emails.send({
    from: 'SplashPass <noreply@splashpass.site>',
    to: toEmail,
    subject: copy.subject(organization.name),
    html: `
      <div style="font-family:sans-serif;max-width:520px;margin:0 auto;padding:32px;background:#0f1d30;border-radius:16px;">
        <div style="font-size:24px;font-weight:800;color:#f0f4f8;margin-bottom:4px;">${copy.heading}</div>
        <div style="font-size:14px;color:#7a90a8;margin-bottom:20px;">${organization.name}</div>
        <p style="font-size:14px;color:#f0f4f8;line-height:1.6;">${copy.body}</p>
        ${notes ? `
          <div style="margin-top:12px;padding:14px 16px;background:#182840;border-radius:10px;border-left:3px solid #f5a623;">
            <p style="font-size:13px;color:#f0f4f8;line-height:1.6;margin:0;">${notes}</p>
          </div>
        ` : ''}
        <div style="margin-top:24px;font-size:13px;color:#7a90a8;">Log into your SplashPass Business dashboard for details.</div>
      </div>
    `,
  })

  if (emailError) {
    console.error('[notifyOrgVerificationUpdate] send failed:', emailError.message)
  }
}

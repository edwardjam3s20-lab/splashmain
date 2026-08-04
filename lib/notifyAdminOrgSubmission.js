// lib/notifyAdminOrgSubmission.js
// Sends an admin-facing email whenever an organization is submitted or
// resubmitted for verification review. Nothing previously notified admin
// of this at all -- organizations.verification_status just changed to
// 'submitted' silently, so the only way to find a new application was to
// happen to open the admin panel and check.
//
// Non-fatal by design: a failed/misconfigured email must never block the
// owner's onboarding response. Callers should fire-and-log, not await a
// throw. Requires ADMIN_NOTIFICATION_EMAIL to be set -- if it isn't, this
// no-ops with a console.warn rather than crashing the calling route (same
// reasoning as the RESEND_API_KEY dependent routes elsewhere: a missing
// secret shouldn't 500 an unrelated user-facing flow).

import { Resend } from 'resend'

const resend = new Resend(process.env.RESEND_API_KEY)

export async function notifyAdminOrgSubmission({ organization, isResubmission }) {
  const adminEmail = process.env.ADMIN_NOTIFICATION_EMAIL
  if (!adminEmail) {
    console.warn('[notifyAdminOrgSubmission] ADMIN_NOTIFICATION_EMAIL not set — skipping admin notification email.')
    return
  }

  const heading = isResubmission ? 'Organization resubmitted for review' : 'New organization submitted for review'
  const panelUrl = process.env.ADMIN_PANEL_URL || null

  const rows = [
    ['Business name', organization.name],
    ['Business type', organization.business_type],
    ['Registration number', organization.registration_number || '—'],
    ['KRA PIN', organization.kra_pin || '—'],
    ['Business phone', organization.business_phone || '—'],
    ['Business email', organization.business_email || '—'],
    ['Address', organization.address || '—'],
  ]

  const { error: emailError } = await resend.emails.send({
    from: 'SplashPass <noreply@splashpass.site>',
    to: adminEmail,
    subject: `${heading}: ${organization.name}`,
    html: `
      <div style="font-family:sans-serif;max-width:520px;margin:0 auto;padding:32px;background:#0f1d30;border-radius:16px;">
        <div style="font-size:24px;font-weight:800;color:#f0f4f8;margin-bottom:4px;">${heading}</div>
        <div style="font-size:14px;color:#7a90a8;margin-bottom:24px;">Awaiting review in the admin panel.</div>
        <table style="width:100%;border-collapse:collapse;">
          ${rows.map(([label, value]) => `
            <tr>
              <td style="padding:6px 0;color:#7a90a8;font-size:13px;vertical-align:top;width:40%;">${label}</td>
              <td style="padding:6px 0;color:#f0f4f8;font-size:13px;">${value}</td>
            </tr>
          `).join('')}
        </table>
        ${panelUrl ? `
          <a href="${panelUrl}" style="display:inline-block;margin-top:24px;padding:12px 20px;background:#f5a623;color:#0f1d30;font-weight:700;font-size:14px;text-decoration:none;border-radius:8px;">
            Review in admin panel
          </a>
        ` : `
          <div style="margin-top:24px;font-size:13px;color:#7a90a8;">Log into the admin panel to review this submission.</div>
        `}
      </div>
    `,
  })

  if (emailError) {
    console.error('[notifyAdminOrgSubmission] send failed:', emailError.message)
  }
}

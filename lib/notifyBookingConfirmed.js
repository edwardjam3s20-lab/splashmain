import { Resend } from 'resend'
import QRCode from 'qrcode'
import { getSupabaseAdmin } from './supabase'
import { sendPushToOperator } from './push'

const resend = new Resend(process.env.RESEND_API_KEY)

/**
 * Fires once a booking has actually been paid for and its status flips to
 * 'confirmed' -- the same moment the customer app's own QR pass unlocks
 * (see canViewPass in splashpass-react-poc's BookingsScreen.tsx:
 * status === 'confirmed'). Two notifications go out:
 *
 *  - Customer: an email carrying the same QR payload the in-app pass uses
 *    ({ id: booking.id }), so it scans identically to QRScreen.tsx.
 *  - Wash point operator(s): a push notification on the existing channel
 *    (sendPushToOperator, same as the "New booking request" push fired at
 *    creation time in app/api/bookings/route.js) plus an email, confirming
 *    the booking is paid and scheduled. This is deliberately a second,
 *    distinct notification from that earlier one -- the first only meant a
 *    request had come in; this one means it's locked in.
 *
 * Both notifications are best-effort: nothing in here is allowed to throw
 * back into the caller. A failed email/push must never roll back, or even
 * be visible to the customer as an error on, a payment that already
 * succeeded. Every failure is caught and logged, not raised.
 */
export async function notifyBookingConfirmed(booking) {
  await Promise.allSettled([
    emailCustomerConfirmation(booking),
    notifyOperatorsBookingConfirmed(booking),
  ])
}

// Mirrors QRScreen.tsx's qrData exactly -- the operator's scanner only ever
// reads `id`, so the emailed code must stay identical to the in-app one
// rather than inventing a second payload shape.
async function buildQrDataUrl(booking) {
  const qrData = JSON.stringify({ id: booking.id })
  return QRCode.toDataURL(qrData, {
    width: 240,
    margin: 1,
    // Solid white background rather than QRScreen's transparent one --
    // several email clients (Outlook in particular) flatten transparent
    // PNGs onto an unpredictable background, which can wreck contrast on
    // a QR code enough to make it unscannable.
    color: { dark: '#0A1628', light: '#FFFFFF' },
  })
}

async function emailCustomerConfirmation(booking) {
  if (!booking.user_email) return
  try {
    const qrDataUrl = await buildQrDataUrl(booking)
    const carInfo = `${booking.car_make ?? ''} ${booking.car_model ?? ''}`.trim()

    const { error } = await resend.emails.send({
      from: 'SplashPass <noreply@splashpass.site>',
      to: booking.user_email,
      subject: `Booking confirmed — ${booking.location}`,
      html: `
        <div style="font-family:sans-serif;max-width:480px;margin:0 auto;padding:32px;background:#0f1d30;border-radius:16px;">
          <div style="font-size:24px;font-weight:800;color:#f0f4f8;margin-bottom:4px;">SplashPass</div>
          <div style="font-size:15px;color:#f0f4f8;margin-bottom:24px;">Your booking is confirmed and paid.</div>

          <div style="background:#ffffff;border-radius:16px;padding:24px;text-align:center;margin-bottom:24px;">
            <img src="${qrDataUrl}" width="200" height="200" alt="Booking QR code" style="display:block;margin:0 auto 12px;" />
            <div style="font-size:20px;font-weight:800;letter-spacing:3px;color:#0A1628;">${booking.booking_code ?? ''}</div>
            <div style="font-size:11px;color:#6E6E73;">Booking Code — show this at the wash point</div>
          </div>

          <div style="background:#1e3050;border-radius:12px;padding:16px;font-size:13px;color:#f0f4f8;line-height:1.8;">
            <div><strong>Location:</strong> ${booking.location}</div>
            <div><strong>Service:</strong> ${booking.service_name ?? '—'}</div>
            <div><strong>Date &amp; time:</strong> ${booking.date} · ${booking.time}</div>
            <div><strong>Vehicle:</strong> ${carInfo || '—'} · ${booking.car_plate ?? '—'}</div>
            <div><strong>Amount paid:</strong> KSh ${Number(booking.total_amount ?? 0).toLocaleString()}</div>
          </div>

          <div style="font-size:12px;color:#7a90a8;line-height:1.6;margin-top:20px;">
            Show this email or your in-app pass to the wash attendant on arrival.
          </div>
        </div>
      `,
    })
    if (error) console.error('notifyBookingConfirmed: customer email failed:', error.message || error)
  } catch (e) {
    console.error('notifyBookingConfirmed: customer email failed:', e.message)
  }
}

// Two sources of "who runs this wash point," used together rather than
// either replacing the other:
//
//  - Organization-owned wash points (the current, active model -- e.g.
//    Splashpass Bamburi): the owner logs in via organization_users, not a
//    standalone operator account. wash_points.organization_id ->
//    organization_members (role='owner') -> organization_users.email is
//    the exact same lookup lib/notifyOrgVerificationUpdate.js already uses
//    for onboarding-status emails, kept identical here for consistency.
//
//  - Legacy standalone operators (operators.wash_point = a plain string
//    match): kept as a second, additive path in case any wash point still
//    predates the organization model and has no wash_points.organization_id
//    at all. Also the only source for push notifications -- push_subscriptions
//    is keyed by operator_id, and there's no organization-user equivalent.
//
// Confirmed via the operators table being completely empty (0 rows) in
// production while Bamburi bookings were still actively being accepted:
// the plain operators-table lookup alone can silently match nothing for
// every wash point, org-owned or not, and nothing said so until the
// warning below was added.
async function notifyOperatorsBookingConfirmed(booking) {
  const supabase = getSupabaseAdmin()

  const emails = new Set()
  const pushOperatorIds = []

  const { data: washPoint, error: washPointError } = await supabase
    .from('wash_points')
    .select('id, organization_id')
    .eq('name', booking.location)
    .maybeSingle()

  if (washPointError) {
    console.error('notifyOperatorsBookingConfirmed: wash_points lookup failed:', washPointError.message)
  } else if (washPoint?.organization_id) {
    const { data: ownerMembership, error: memberError } = await supabase
      .from('organization_members')
      .select('user_id')
      .eq('organization_id', washPoint.organization_id)
      .eq('role', 'owner')
      .is('removed_at', null)
      .maybeSingle()

    if (memberError) {
      console.error('notifyOperatorsBookingConfirmed: organization_members lookup failed:', memberError.message)
    } else if (ownerMembership?.user_id) {
      const { data: owner, error: ownerError } = await supabase
        .from('organization_users')
        .select('email')
        .eq('id', ownerMembership.user_id)
        .maybeSingle()

      if (ownerError) {
        console.error('notifyOperatorsBookingConfirmed: organization_users lookup failed:', ownerError.message)
      } else if (owner?.email) {
        emails.add(owner.email)
      }
    }
  }

  const { data: legacyOperators, error: legacyError } = await supabase
    .from('operators')
    .select('id, email')
    .eq('wash_point', booking.location)

  if (legacyError) {
    console.error('notifyOperatorsBookingConfirmed: legacy operators lookup failed:', legacyError.message)
  } else if (legacyOperators?.length) {
    for (const op of legacyOperators) {
      if (op.email) emails.add(op.email)
      pushOperatorIds.push(op.id)
    }
  }

  if (!emails.size && !pushOperatorIds.length) {
    console.warn(`notifyOperatorsBookingConfirmed: no organization owner or legacy operator found for wash_point = "${booking.location}" (booking ${booking.id})`)
    return
  }

  const pushBody = `${booking.user_name || 'A customer'} confirmed and paid for ${booking.service_name || 'a wash'} on ${booking.date} at ${booking.time}. Scheduled.`

  const tasks = [
    ...pushOperatorIds.map((id) =>
      sendPushToOperator(id, {
        title: 'Booking confirmed',
        body: pushBody,
        bookingId: booking.id,
        url: `/app/queue?booking=${booking.id}`,
      })
    ),
    ...[...emails].map((email) => emailOperatorConfirmation(email, booking)),
  ]

  const results = await Promise.allSettled(tasks)

  // allSettled swallows rejections by design (so one bad send can't stop
  // the rest) -- but that also means a failure here would otherwise never
  // show up anywhere. Surface anything that failed after the fact.
  for (const r of results) {
    if (r.status === 'rejected') {
      console.error('notifyOperatorsBookingConfirmed: a send failed:', r.reason?.message || r.reason)
    }
  }
}

async function emailOperatorConfirmation(operatorEmail, booking) {
  try {
    const carInfo = `${booking.car_make ?? ''} ${booking.car_model ?? ''}`.trim()
    const { error } = await resend.emails.send({
      from: 'SplashPass <noreply@splashpass.site>',
      to: operatorEmail,
      subject: `Booking confirmed — ${booking.date} at ${booking.time}`,
      html: `
        <div style="font-family:sans-serif;max-width:480px;margin:0 auto;padding:32px;background:#0f1d30;border-radius:16px;">
          <div style="font-size:24px;font-weight:800;color:#f0f4f8;margin-bottom:4px;">SplashPass</div>
          <div style="font-size:15px;color:#f0f4f8;margin-bottom:24px;">
            ${booking.user_name || 'A customer'} has successfully booked and paid. This booking is scheduled.
          </div>
          <div style="background:#1e3050;border-radius:12px;padding:16px;font-size:13px;color:#f0f4f8;line-height:1.8;">
            <div><strong>Customer:</strong> ${booking.user_name ?? '—'}</div>
            <div><strong>Service:</strong> ${booking.service_name ?? '—'}</div>
            <div><strong>Date &amp; time:</strong> ${booking.date} · ${booking.time}</div>
            <div><strong>Vehicle:</strong> ${carInfo || '—'} · ${booking.car_plate ?? '—'}</div>
            <div><strong>Booking code:</strong> ${booking.booking_code ?? '—'}</div>
          </div>
        </div>
      `,
    })
    if (error) console.error('notifyBookingConfirmed: operator email failed:', error.message || error)
  } catch (e) {
    console.error('notifyBookingConfirmed: operator email failed:', e.message)
  }
}

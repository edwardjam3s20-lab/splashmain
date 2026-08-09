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

// Same location-string match the rest of the codebase already uses for
// operator lookup (app/api/bookings/route.js's push-on-creation, the
// operator route's getBookingForOperator, etc.) -- kept consistent rather
// than introducing a second way to resolve "which operator(s) own this
// wash point."
async function notifyOperatorsBookingConfirmed(booking) {
  const supabase = getSupabaseAdmin()
  const { data: operators, error } = await supabase
    .from('operators')
    .select('id, email')
    .eq('wash_point', booking.location)

  if (error || !operators?.length) return

  const pushBody = `${booking.user_name || 'A customer'} confirmed and paid for ${booking.service_name || 'a wash'} on ${booking.date} at ${booking.time}. Scheduled.`

  await Promise.allSettled(
    operators.flatMap((op) => [
      sendPushToOperator(op.id, {
        title: 'Booking confirmed',
        body: pushBody,
        bookingId: booking.id,
        url: `/app/queue?booking=${booking.id}`,
      }),
      op.email ? emailOperatorConfirmation(op.email, booking) : null,
    ].filter(Boolean))
  )
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

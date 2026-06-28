import webpush from 'web-push'
import { getSupabaseAdmin } from './supabase'

// VAPID_PRIVATE_KEY must never be exposed to the client — it's the
// signing key proving pushes genuinely come from this server. Set both
// as env vars; VAPID_SUBJECT should be a mailto: or https: URL per the
// Web Push spec (push services use it as an operator contact point).
webpush.setVapidDetails(
  process.env.VAPID_SUBJECT || 'mailto:support@splashpass.site',
  process.env.VAPID_PUBLIC_KEY,
  process.env.VAPID_PRIVATE_KEY
)

/**
 * Sends a push notification to every subscription belonging to the given
 * operator. Failures are isolated per-subscription — one dead endpoint
 * (e.g. the operator uninstalled the PWA, or the subscription expired)
 * should never block delivery to the operator's other devices, and
 * should never throw back into the caller (a push failing is not a
 * reason to fail the booking creation that triggered it).
 *
 * Expired/invalid subscriptions (HTTP 404/410 from the push service) are
 * deleted automatically — keeping push_subscriptions from silently
 * accumulating dead rows that error on every future send.
 */
export async function sendPushToOperator(operatorId, payload) {
  const supabase = getSupabaseAdmin()
  const { data: subs, error } = await supabase
    .from('push_subscriptions')
    .select('id, endpoint, keys')
    .eq('operator_id', operatorId)

  if (error || !subs?.length) return

  const body = JSON.stringify(payload)

  await Promise.allSettled(
    subs.map(async (sub) => {
      try {
        await webpush.sendNotification(
          { endpoint: sub.endpoint, keys: sub.keys },
          body
        )
      } catch (e) {
        if (e.statusCode === 404 || e.statusCode === 410) {
          await supabase.from('push_subscriptions').delete().eq('id', sub.id)
        } else {
          console.error('Push send failed:', sub.endpoint, e.statusCode, e.message)
        }
      }
    })
  )
}

// SECURITY: Safaricom does not sign or authenticate B2C callback requests
// in any way — no shared secret, no signature header. The only mitigation
// available is checking that the request actually originated from one of
// Safaricom's Daraja servers, since without this check, anyone who obtains
// (or guesses) a ConversationID can POST a fabricated "success" or
// "failure" result and flip a real payout's status.
//
// This list is community-sourced from Safaricom's Daraja documentation,
// not published by Safaricom as a guaranteed, stable set — Daraja gives no
// formal commitment that these IPs won't change. Two safety measures follow
// from that:
//   1. MPESA_CALLBACK_IP_ALLOWLIST env var lets the list be extended/fixed
//      without a code deploy, in case a real callback ever gets rejected.
//   2. Every rejection is logged with the IP that was actually seen, so a
//      false-positive block (a genuine Safaricom callback from an IP not on
//      this list) is immediately visible in Vercel logs rather than
//      silently stranding a payout in 'submitted' forever.

const DEFAULT_SAFARICOM_IPS = [
  '196.201.214.200',
  '196.201.214.206',
  '196.201.213.114',
  '196.201.214.207',
  '196.201.214.208',
  '196.201.213.44',
  '196.201.212.127',
  '196.201.212.138',
  '196.201.212.129',
  '196.201.212.136',
  '196.201.212.74',
  '196.201.212.69',
]

function getAllowlist() {
  const extra = (process.env.MPESA_CALLBACK_IP_ALLOWLIST || '')
    .split(',')
    .map((ip) => ip.trim())
    .filter(Boolean)
  return new Set([...DEFAULT_SAFARICOM_IPS, ...extra])
}

// Vercel's edge network sets x-forwarded-for from the actual TCP
// connection — a client can't override it by sending their own header, so
// the leftmost value is the real originating IP.
function getClientIp(request) {
  const xff = request.headers.get('x-forwarded-for') || ''
  return xff.split(',')[0].trim()
}

/**
 * Returns true if the request appears to come from a known Safaricom
 * Daraja server. Logs the source IP on every rejection.
 */
export function isFromSafaricom(request, routeLabel) {
  const ip = getClientIp(request)
  const allowed = getAllowlist().has(ip)
  if (!allowed) {
    console.error(`[mpesa-callback] REJECTED ${routeLabel} — request from non-Safaricom IP:`, ip || '(none)')
  }
  return allowed
}

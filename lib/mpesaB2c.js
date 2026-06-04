const SANDBOX_BASE = 'https://sandbox.safaricom.co.ke'
const LIVE_BASE = 'https://api.safaricom.co.ke'

function env(name, fallback = '') {
  return process.env[name] || fallback
}

function getMpesaBaseUrl() {
  const mode = env('MPESA_ENV', env('DARAJA_ENV', 'sandbox')).toLowerCase()
  return mode === 'production' || mode === 'live' ? LIVE_BASE : SANDBOX_BASE
}

function getCredential(name, altName) {
  return env(name, env(altName))
}

export function normalizeMpesaPhone(phone) {
  let value = String(phone || '').replace(/\s+/g, '').replace(/^\+/, '')
  if (value.startsWith('07') || value.startsWith('01')) value = `254${value.slice(1)}`
  if (value.startsWith('7') || value.startsWith('1')) value = `254${value}`
  if (!/^254(?:7|1)\d{8}$/.test(value)) return null
  return value
}

export function getPublicCallbackBase(request) {
  const configured = env('NEXT_PUBLIC_APP_URL') || env('APP_URL')
  if (configured) return configured.replace(/\/$/, '')
  const proto = request.headers.get('x-forwarded-proto') || 'https'
  const host = request.headers.get('x-forwarded-host') || request.headers.get('host')
  return `${proto}://${host}`
}

async function getAccessToken() {
  const consumerKey = getCredential('MPESA_CONSUMER_KEY', 'DARAJA_CONSUMER_KEY')
  const consumerSecret = getCredential('MPESA_CONSUMER_SECRET', 'DARAJA_CONSUMER_SECRET')
  if (!consumerKey || !consumerSecret) {
    throw new Error('M-Pesa consumer key/secret are not configured.')
  }

  const credentials = Buffer.from(`${consumerKey}:${consumerSecret}`).toString('base64')
  const res = await fetch(`${getMpesaBaseUrl()}/oauth/v1/generate?grant_type=client_credentials`, {
    headers: { Authorization: `Basic ${credentials}` },
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok || !data.access_token) {
    throw new Error(data.errorMessage || data.error || 'Could not get M-Pesa access token.')
  }
  return data.access_token
}

export async function initiateB2CPayment({
  amount,
  phone,
  paymentId,
  remarks,
  request,
}) {
  const normalPhone = normalizeMpesaPhone(phone)
  if (!normalPhone) throw new Error('Enter a valid Kenyan M-Pesa phone number.')

  const shortcode = getCredential('MPESA_B2C_SHORTCODE', 'MPESA_SHORTCODE')
  const initiatorName = getCredential('MPESA_B2C_INITIATOR_NAME', 'MPESA_INITIATOR_NAME')
  const securityCredential = getCredential('MPESA_B2C_SECURITY_CREDENTIAL', 'MPESA_SECURITY_CREDENTIAL')
  if (!shortcode || !initiatorName || !securityCredential) {
    throw new Error('M-Pesa B2C shortcode, initiator name, or security credential is not configured.')
  }

  const callbackBase = getPublicCallbackBase(request)
  const resultUrl = env('MPESA_B2C_RESULT_URL') || `${callbackBase}/api/mpesa/b2c/result`
  const timeoutUrl = env('MPESA_B2C_TIMEOUT_URL') || `${callbackBase}/api/mpesa/b2c/timeout`
  const token = await getAccessToken()

  const payload = {
    InitiatorName: initiatorName,
    SecurityCredential: securityCredential,
    CommandID: env('MPESA_B2C_COMMAND_ID', 'BusinessPayment'),
    Amount: Math.round(Number(amount)),
    PartyA: shortcode,
    PartyB: normalPhone,
    Remarks: remarks || `SplashPass operator payout ${paymentId}`,
    QueueTimeOutURL: timeoutUrl,
    ResultURL: resultUrl,
    Occasion: `payout_${String(paymentId).slice(-8)}`,
  }

  console.log('[B2C] env:', env('MPESA_ENV', 'sandbox'), '| shortcode:', shortcode, '| initiator:', initiatorName)
  console.log('[B2C] payload (no cred):', JSON.stringify({ ...payload, SecurityCredential: '[REDACTED]' }))

  const res = await fetch(`${getMpesaBaseUrl()}/mpesa/b2c/v3/paymentrequest`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  })

  const data = await res.json().catch(() => ({}))
  console.log('[B2C] response status:', res.status, '| body:', JSON.stringify(data))

  if (!res.ok || data.ResponseCode !== '0') {
    throw new Error(data.errorMessage || data.ResponseDescription || data.error || 'M-Pesa B2C payout request failed.')
  }

  return {
    phone: normalPhone,
    response: data,
    conversationId: data.ConversationID || null,
    originatorConversationId: data.OriginatorConversationID || null,
    responseCode: data.ResponseCode || null,
    responseDescription: data.ResponseDescription || null,
  }
}

// pages/api/mpesa-query.js
//
// STK Push Query — takes a CheckoutRequestID (the one returned by
// mpesa-stk.js and logged after every push) and asks Safaricom directly
// what actually happened to that transaction after the customer entered
// their PIN. Use this to get the real ResultCode/ResultDesc instead of
// guessing from symptoms — e.g. 1032 (cancelled by user), 1037
// (timeout/no response), 2001 (wrong PIN), 1 (insufficient funds), or a
// shortcode/config-specific failure if the transaction type doesn't
// match how the shortcode is provisioned.
//
// Same env vars as mpesa-stk.js — no new config needed.
//
// Call it like:
//   GET /api/mpesa-query?checkoutRequestId=ws_CO_...
// or
//   POST /api/mpesa-query  { "checkoutRequestId": "ws_CO_..." }

const CONSUMER_KEY = process.env.MPESA_CONSUMER_KEY;
const CONSUMER_SECRET = process.env.MPESA_CONSUMER_SECRET;
const SHORTCODE = process.env.MPESA_SHORTCODE;
const PASSKEY = process.env.MPESA_PASSKEY;
const MPESA_BASE = process.env.MPESA_BASE_URL;

async function getAccessToken() {
  const credentials = Buffer.from(CONSUMER_KEY + ':' + CONSUMER_SECRET).toString('base64');
  const res = await fetch(MPESA_BASE + '/oauth/v1/generate?grant_type=client_credentials', {
    headers: { 'Authorization': 'Basic ' + credentials }
  });
  const data = await res.json();
  if (!data.access_token) throw new Error('Failed to get access token');
  return data.access_token;
}

function getTimestamp() {
  const now = new Date();
  const pad = n => String(n).padStart(2, '0');
  return now.getFullYear().toString() +
    pad(now.getMonth() + 1) +
    pad(now.getDate()) +
    pad(now.getHours()) +
    pad(now.getMinutes()) +
    pad(now.getSeconds());
}

export default async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ message: 'Method not allowed' });
  }

  if (!CONSUMER_KEY || !CONSUMER_SECRET || !SHORTCODE || !PASSKEY || !MPESA_BASE) {
    console.error('M-Pesa env vars missing — check MPESA_CONSUMER_KEY/SECRET/SHORTCODE/PASSKEY/BASE_URL');
    return res.status(500).json({ message: 'Payments are not configured on the server.' });
  }

  const checkoutRequestId = req.method === 'GET'
    ? req.query.checkoutRequestId
    : (req.body || {}).checkoutRequestId;

  if (!checkoutRequestId) {
    return res.status(400).json({ message: 'checkoutRequestId is required' });
  }

  try {
    const token = await getAccessToken();
    const timestamp = getTimestamp();
    const password = Buffer.from(SHORTCODE + PASSKEY + timestamp).toString('base64');

    const queryRes = await fetch(MPESA_BASE + '/mpesa/stkpushquery/v1/query', {
      method: 'POST',
      headers: {
        'Authorization': 'Bearer ' + token,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        BusinessShortCode: SHORTCODE,
        Password: password,
        Timestamp: timestamp,
        CheckoutRequestID: checkoutRequestId
      })
    });

    const data = await queryRes.json();

    // Pass the raw Safaricom response straight through — ResultCode and
    // ResultDesc are exactly what we're after here. Note: Safaricom
    // returns an error (not a ResultCode) if you query before the
    // transaction has actually completed processing on their end — if
    // you see "The transaction is being processed", wait a few seconds
    // and query again.
    return res.status(200).json(data);

  } catch (e) {
    console.error('STK query error:', e.message);
    return res.status(500).json({ error: e.message });
  }
}

const CONSUMER_KEY = process.env.MPESA_CONSUMER_KEY;
const CONSUMER_SECRET = process.env.MPESA_CONSUMER_SECRET;
const PASSKEY = process.env.MPESA_PASSKEY;
const SHORTCODE = process.env.MPESA_SHORTCODE || '174379';
const CALLBACK_URL = process.env.MPESA_CALLBACK_URL || 'https://splashmain.vercel.app/api/mpesa-callback';
const MPESA_BASE = process.env.MPESA_BASE_URL || 'https://sandbox.safaricom.co.ke';

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
  // Allow CORS from your Vercel frontend
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ message: 'Method not allowed' });

  if (!CONSUMER_KEY || !CONSUMER_SECRET || !PASSKEY) {
    console.error('M-Pesa error: MPESA_CONSUMER_KEY, MPESA_CONSUMER_SECRET and MPESA_PASSKEY must be configured');
    return res.status(503).json({ message: 'Payment service is not configured' });
  }

  try {
    const { phone, amount } = req.body;

    if (!phone || !amount) {
      return res.status(400).json({ message: 'Phone and amount are required' });
    }

    // Normalise phone to 2547XXXXXXXX format
    let normalised = phone.replace(/\s+/g, '').replace(/^\+/, '');
    if (normalised.startsWith('07') || normalised.startsWith('01')) {
      normalised = '254' + normalised.slice(1);
    }

    const token = await getAccessToken();
    const timestamp = getTimestamp();
    const password = Buffer.from(SHORTCODE + PASSKEY + timestamp).toString('base64');

    const stkRes = await fetch(MPESA_BASE + '/mpesa/stkpush/v1/processrequest', {
      method: 'POST',
      headers: {
        'Authorization': 'Bearer ' + token,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        BusinessShortCode: SHORTCODE,
        Password: password,
        Timestamp: timestamp,
        TransactionType: 'CustomerPayBillOnline',
        Amount: amount,
        PartyA: normalised,
        PartyB: SHORTCODE,
        PhoneNumber: normalised,
        CallBackURL: CALLBACK_URL,
        AccountReference: 'SplashPass',
        TransactionDesc: 'SplashPass Subscription'
      })
    });

    const stkData = await stkRes.json();

    if (stkData.ResponseCode === '0') {
      return res.status(200).json({
        success: true,
        message: 'STK Push sent. Check your phone.',
        checkoutRequestID: stkData.CheckoutRequestID
      });
    } else {
      return res.status(400).json({
        success: false,
        message: stkData.errorMessage || stkData.ResponseDescription || 'STK Push failed'
      });
    }

  } catch (e) {
    console.error('STK error:', e.message);
    return res.status(500).json({ error: e.message });
  }
        }

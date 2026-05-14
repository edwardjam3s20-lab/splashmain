const AT_USERNAME = 'sandbox';
const AT_API_KEY = 'atsk_dcae60cae40ec969f1be2920e7176ab4fab2e4d3c118fc74ab075cc0113eeb077d3e60a0';
const AT_URL = 'https://api.sandbox.africastalking.com/version1/messaging';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ message: 'Method not allowed' });

  try {
    const { phone, message } = req.body;
    if (!phone || !message) return res.status(400).json({ message: 'Phone and message required' });

    // Normalise phone to +2547XXXXXXXX
    let normalised = phone.replace(/\s+/g, '');
    if (normalised.startsWith('07') || normalised.startsWith('01')) {
      normalised = '+254' + normalised.slice(1);
    } else if (normalised.startsWith('254')) {
      normalised = '+' + normalised;
    } else if (!normalised.startsWith('+')) {
      normalised = '+254' + normalised;
    }

    const params = new URLSearchParams();
    params.append('username', AT_USERNAME);
    params.append('to', normalised);
    params.append('message', message);
    params.append('from', 'SplashPass');

    const response = await fetch(AT_URL, {
      method: 'POST',
      headers: {
        'Accept': 'application/json',
        'Content-Type': 'application/x-www-form-urlencoded',
        'apiKey': AT_API_KEY
      },
      body: params.toString()
    });

    const data = await response.json();
    const recipient = data.SMSMessageData?.Recipients?.[0];

    if (recipient && recipient.statusCode === 101) {
      return res.status(200).json({ success: true, message: 'SMS sent' });
    } else {
      const errMsg = recipient?.status || 'SMS failed';
      return res.status(200).json({ success: false, message: errMsg });
    }
  } catch(e) {
    console.error('SMS error:', e.message);
    return res.status(500).json({ error: e.message });
  }
}

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ message: 'Method not allowed' });
  }

  if (!SUPABASE_URL || !SUPABASE_KEY) {
    console.error('Callback error: NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be configured');
    return res.status(503).json({ message: 'Supabase is not configured' });
  }

  try {
    const body = req.body;
    const result = body?.Body?.stkCallback;

    if (!result) {
      return res.status(400).json({ message: 'No callback data' });
    }

    const resultCode = result.ResultCode;

    if (resultCode !== 0) {
      console.log('Payment failed, ResultCode:', resultCode);
      return res.status(200).json({ message: 'Payment failed' });
    }

    const metadata = result.CallbackMetadata?.Item || [];
    const phoneItem = metadata.find(i => i.Name === 'PhoneNumber');
    const amountItem = metadata.find(i => i.Name === 'Amount');
    const phone = phoneItem?.Value?.toString() || '';
    const amount = amountItem?.Value || 0;

    console.log('Payment confirmed. Phone:', phone, 'Amount:', amount);

    // Normalise phone: 2547XXXXXXXX -> 07XXXXXXXX
    const normalised = phone.startsWith('254') ? '0' + phone.slice(3) : phone;
    const last9 = normalised.slice(-9);

    // Update sub_status in Supabase
    const response = await fetch(
      SUPABASE_URL + '/rest/v1/profiles?phone=ilike.*' + last9,
      {
        method: 'PATCH',
        headers: {
          'apikey': SUPABASE_KEY,
          'Authorization': 'Bearer ' + SUPABASE_KEY,
          'Content-Type': 'application/json',
          'Prefer': 'return=representation'
        },
        body: JSON.stringify({ sub_status: 'active' })
      }
    );

    if (!response.ok) {
      const err = await response.json();
      throw new Error(err.message || 'Supabase update failed');
    }

    return res.status(200).json({ message: 'Subscription activated successfully' });

  } catch (e) {
    console.error('Callback error:', e.message);
    return res.status(500).json({ error: e.message });
  }
}

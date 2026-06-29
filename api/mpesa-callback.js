const SUPABASE_URL = 'https://msdvyiqjoogafzyaoycg.supabase.co';
const SUPABASE_KEY = 'sb_publishable_N_g24aU7TLHLNeu72gnfeg_1d7OleFW';
// NOTE: SUPABASE_KEY above is a publishable/anon key, already present in
// the original file as-is — left exactly as it was. It's only sufficient
// for the original phone-match profile update below; the new wallet
// credit path needs the admin client (service role) since it calls a
// SECURITY DEFINER-equivalent RPC and writes to a table customers should
// never be able to touch directly. SUPABASE_SERVICE_ROLE_KEY must be set
// as an env var for the wallet-topup branch to work — it was not
// previously required by this file at all.
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

async function findPendingTransaction(checkoutRequestId) {
  if (!checkoutRequestId) return null
  try {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/pending_transactions?checkout_request_id=eq.${checkoutRequestId}&status=eq.pending`,
      {
        headers: {
          apikey: SUPABASE_SERVICE_KEY || SUPABASE_KEY,
          Authorization: `Bearer ${SUPABASE_SERVICE_KEY || SUPABASE_KEY}`,
        },
      }
    )
    if (!res.ok) return null
    const rows = await res.json()
    return rows?.[0] || null
  } catch (e) {
    console.error('findPendingTransaction error:', e.message)
    return null
  }
}

async function markPendingTransaction(checkoutRequestId, status) {
  try {
    await fetch(`${SUPABASE_URL}/rest/v1/pending_transactions?checkout_request_id=eq.${checkoutRequestId}`, {
      method: 'PATCH',
      headers: {
        apikey: SUPABASE_SERVICE_KEY || SUPABASE_KEY,
        Authorization: `Bearer ${SUPABASE_SERVICE_KEY || SUPABASE_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ status }),
    })
  } catch (e) {
    console.error('markPendingTransaction error:', e.message)
  }
}

// New path. Credits the wallet via the same atomic increment_wallet_balance
// RPC used by the points-conversion redemption route — same reasoning:
// a top-up callback and a wallet booking-payment spend could in principle
// land close together, and a plain read-then-write update isn't safe
// against that.
async function creditWallet(email, amount, mpesaReceipt) {
  if (!SUPABASE_SERVICE_KEY) {
    console.error('Wallet credit failed: SUPABASE_SERVICE_ROLE_KEY not configured')
    return false
  }
  try {
    const rpcRes = await fetch(`${SUPABASE_URL}/rest/v1/rpc/increment_wallet_balance`, {
      method: 'POST',
      headers: {
        apikey: SUPABASE_SERVICE_KEY,
        Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ p_email: email, p_amount: amount }),
    })
    if (!rpcRes.ok) {
      console.error('increment_wallet_balance failed:', await rpcRes.text())
      return false
    }

    await fetch(`${SUPABASE_URL}/rest/v1/wallet_transactions`, {
      method: 'POST',
      headers: {
        apikey: SUPABASE_SERVICE_KEY,
        Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
        'Content-Type': 'application/json',
        Prefer: 'return=minimal',
      },
      body: JSON.stringify({
        user_email: email,
        amount,
        type: 'topup',
        status: 'completed',
        mpesa_receipt: mpesaReceipt || null,
      }),
    })
    return true
  } catch (e) {
    console.error('creditWallet error:', e.message)
    return false
  }
}

// Original path, entirely unchanged from before this file was touched —
// existing subscription activations must keep working exactly as they
// did. Phone-match matching here is fragile (see code comments in the
// project notes) but that's a pre-existing characteristic, not something
// introduced or worsened by this change.
async function activateSubscriptionByPhone(phone) {
  const normalised = phone.startsWith('254') ? '0' + phone.slice(3) : phone;
  const last9 = normalised.slice(-9);

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
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ message: 'Method not allowed' });
  }

  try {
    const body = req.body;
    const result = body?.Body?.stkCallback;

    if (!result) {
      return res.status(400).json({ message: 'No callback data' });
    }

    const resultCode = result.ResultCode;
    const checkoutRequestId = result.CheckoutRequestID;

    if (resultCode !== 0) {
      console.log('Payment failed, ResultCode:', resultCode);
      if (checkoutRequestId) await markPendingTransaction(checkoutRequestId, 'failed')
      return res.status(200).json({ message: 'Payment failed' });
    }

    const metadata = result.CallbackMetadata?.Item || [];
    const phoneItem = metadata.find(i => i.Name === 'PhoneNumber');
    const amountItem = metadata.find(i => i.Name === 'Amount');
    const receiptItem = metadata.find(i => i.Name === 'MpesaReceiptNumber');
    const phone = phoneItem?.Value?.toString() || '';
    const amount = amountItem?.Value || 0;
    const receipt = receiptItem?.Value?.toString() || null;

    console.log('Payment confirmed. Phone:', phone, 'Amount:', amount);

    // Look up what this push was actually for. A push with no matching
    // row (legacy callers that don't pass purpose/email yet, or the row
    // write failed at STK-push time) falls through to the exact original
    // behavior — phone-match subscription activation — so nothing that
    // worked before this change can silently stop working.
    const pending = await findPendingTransaction(checkoutRequestId)

    if (pending?.purpose === 'wallet_topup') {
      const ok = await creditWallet(pending.user_email, amount, receipt)
      await markPendingTransaction(checkoutRequestId, ok ? 'completed' : 'failed')
      return res.status(200).json({ message: ok ? 'Wallet topped up' : 'Wallet credit failed' });
    }

    if (pending?.purpose === 'booking_payment') {
      // Booking payment confirmation is intentionally left on its existing
      // mechanism (the manual "I've paid" button / payment_status poll) —
      // not touched by this change. The pending_transactions row is still
      // marked completed here so it doesn't linger as stale "pending"
      // forever, but no further action is taken on the booking itself.
      await markPendingTransaction(checkoutRequestId, 'completed')
      return res.status(200).json({ message: 'Booking payment recorded' });
    }

    // purpose === 'subscription', or no tagged row found at all (legacy
    // behavior preserved exactly).
    await activateSubscriptionByPhone(phone)
    if (checkoutRequestId) await markPendingTransaction(checkoutRequestId, 'completed')
    return res.status(200).json({ message: 'Subscription activated successfully' });

  } catch (e) {
    console.error('Callback error:', e.message);
    return res.status(500).json({ error: e.message });
  }
}

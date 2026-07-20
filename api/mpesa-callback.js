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
//
// SECURITY: `amount` here is `pending.amount` — the figure THIS SERVER
// recorded when it initiated the STK push (see recordPendingTransaction in
// the customer app's api/mpesa-stk.js) — never the callback body's own
// Amount field. Daraja callbacks aren't signed, so anything that knows this
// URL can POST a forged "payment succeeded" body; if that forged body's
// Amount were trusted directly, anyone could credit their own wallet with
// an arbitrary number just by initiating a real (small) STK push to get a
// matching pending_transactions row, then faking the callback for it. Using
// the stored amount bounds a forged callback to, at most, the real amount
// that specific push was already limited to (capped and rate-limited at
// STK-push time) — it doesn't fully stop a forged "success" for a
// legitimately-initiated push the user never actually paid for. Closing
// that fully needs either the MPESA_CALLBACK_SECRET check below (set it!)
// or re-querying Daraja's Transaction Status API before crediting.
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

  // Daraja doesn't sign its callbacks, so there's no cryptographic way to
  // confirm this request actually came from Safaricom. The standard
  // mitigation (recommended by Safaricom's own integration guides) is a
  // secret token embedded in the callback URL itself, e.g. setting
  // MPESA_CALLBACK_URL to ".../api/mpesa-callback?token=<random>" — set
  // MPESA_CALLBACK_SECRET to that same random value here to enforce it.
  // Not hard-required (yet) so this doesn't break an existing deployment
  // that hasn't set it, but every request is logged as a warning until it
  // is, and without it this endpoint is only bounded by the fix below, not
  // actually authenticated.
  const expectedToken = process.env.MPESA_CALLBACK_SECRET;
  if (expectedToken) {
    const providedToken = req.query?.token;
    if (providedToken !== expectedToken) {
      console.warn('M-Pesa callback rejected: missing/incorrect token');
      return res.status(403).json({ message: 'Forbidden' });
    }
  } else {
    console.warn('M-Pesa callback received with MPESA_CALLBACK_SECRET unset — this endpoint is unauthenticated. Set MPESA_CALLBACK_SECRET and add ?token=<value> to MPESA_CALLBACK_URL.');
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
    const receiptItem = metadata.find(i => i.Name === 'MpesaReceiptNumber');
    const phone = phoneItem?.Value?.toString() || '';
    const receipt = receiptItem?.Value?.toString() || null;

    console.log('Payment confirmed. Phone:', phone);

    // Look up what this push was actually for. A push with no matching
    // row (legacy callers that don't pass purpose/email yet, or the row
    // write failed at STK-push time) falls through to the exact original
    // behavior — phone-match subscription activation — so nothing that
    // worked before this change can silently stop working.
    const pending = await findPendingTransaction(checkoutRequestId)

    if (pending?.purpose === 'wallet_topup') {
      // Use the amount THIS SERVER recorded at STK-push time, not the
      // callback body's own Amount field — see the comment on
      // creditWallet() above for why.
      const ok = await creditWallet(pending.user_email, pending.amount, receipt)
      await markPendingTransaction(checkoutRequestId, ok ? 'completed' : 'failed')
      return res.status(200).json({ message: ok ? 'Wallet topped up' : 'Wallet credit failed' });
    }

    if (pending?.purpose === 'booking_payment') {
      // FIX: this branch previously only marked the internal
      // pending_transactions row as 'completed' and never touched the
      // actual bookings row. The customer app's useBookingPaymentPoll
      // hook polls bookings.payment_status waiting for it to equal
      // 'paid' (see getBookingPaymentStatus in src/lib/bookings.ts) —
      // since nothing ever wrote that value, the poll always timed out
      // and the app never auto-advanced to /confirmed, even though the
      // payment had actually gone through. This PATCH is what was
      // missing.
      if (pending.booking_id) {
        const bookingRes = await fetch(
          `${SUPABASE_URL}/rest/v1/bookings?id=eq.${pending.booking_id}`,
          {
            method: 'PATCH',
            headers: {
              apikey: SUPABASE_SERVICE_KEY,
              Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
              'Content-Type': 'application/json',
              Prefer: 'return=minimal',
            },
            body: JSON.stringify({ payment_status: 'paid' }),
          }
        )
        if (!bookingRes.ok) {
          console.error('Failed to mark booking paid:', await bookingRes.text())
        }
      } else {
        console.error('booking_payment callback with no booking_id on pending row — cannot update booking', checkoutRequestId)
      }

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

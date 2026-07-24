// pages/api/mpesa-stk.js
//
// Second revision. On top of the previous fix (env vars instead of
// hardcoded secrets, restricted CORS, input validation), this version
// closes a real gap found by cross-checking against mpesa-callback.js
// and pending_transactions.sql: that callback already has purpose-aware
// routing (subscription vs. booking_payment vs. wallet_topup) built in,
// but nothing was ever writing the pending_transactions row it depends
// on to route correctly. Without it, EVERY M-Pesa payment — including
// booking payments and wallet top-ups — fell through to the legacy
// phone-match subscription activation, regardless of what was actually
// being paid for. This version records that row right after a
// successful STK push, using the CheckoutRequestID Safaricom just
// returned, same table/columns the callback already reads.
//
// Still not done: session-cookie auth (see the note below — now that
// lib/mpesa.ts and lib/wallet.ts both send credentials:'include' to the
// correct absolute URL, this is safe to add; I just don't have
// lib/session.js to match its exact shape) and a rate limit per
// phone/IP (reuse whatever rate_limits.sql already backs elsewhere in
// this codebase rather than inventing a new one here).

const ALLOWED_ORIGINS = new Set([
  'http://localhost:5173',
  'https://splashpass-react.vercel.app',
  'https://splashpass.site',
  'https://www.splashpass.site',
  'https://app.splashpass.site',
  // Operator app — same two origins middleware.js already trusts, so the
  // operator subscription STK push (purpose: 'operator_subscription') can
  // hit this same endpoint instead of needing a duplicate route.
  'https://splashpass-operator-react.vercel.app',
  'https://operator.splashpass.site',
]);

const CONSUMER_KEY = process.env.MPESA_CONSUMER_KEY;
const CONSUMER_SECRET = process.env.MPESA_CONSUMER_SECRET;
const SHORTCODE = process.env.MPESA_SHORTCODE;
const PASSKEY = process.env.MPESA_PASSKEY;
const CALLBACK_URL = process.env.MPESA_CALLBACK_URL;
const MPESA_BASE = process.env.MPESA_BASE_URL;

// Matches mpesa-callback.js's own hardcoded SUPABASE_URL — kept
// consistent with that file's existing style rather than introducing a
// new env-var-based pattern just in this one file.
const SUPABASE_URL = 'https://msdvyiqjoogafzyaoycg.supabase.co';
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const VALID_PURPOSES = new Set(['subscription', 'booking_payment', 'wallet_topup', 'operator_subscription']);

// Adjust to your actual business policy — this is a sanity ceiling to
// limit blast radius from abuse or a typo'd amount, not a number I know
// you've deliberately chosen.
const MAX_AMOUNT_KES = 100000;

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

// Written right after a successful STK push, read back by
// mpesa-callback.js's findPendingTransaction() when the result arrives.
// Deliberately non-fatal: if this insert fails (missing service key,
// missing email, network blip), the STK push itself already succeeded
// and the user's phone is already ringing — we don't want to fail the
// whole request over a routing-metadata write. Worst case on failure is
// exactly today's existing behavior (falls back to phone-match
// subscription activation in the callback).
async function recordPendingTransaction({ checkoutRequestId, purpose, email, amount, bookingId }) {
  if (!SUPABASE_SERVICE_KEY) {
    console.error('pending_transactions not recorded: SUPABASE_SERVICE_ROLE_KEY is not set. The callback will not know what this payment was for.');
    return;
  }
  if (!email) {
    console.error('pending_transactions not recorded: no email provided with this STK push. Update the caller to pass one.');
    return;
  }
  const safePurpose = VALID_PURPOSES.has(purpose) ? purpose : 'subscription';
  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/pending_transactions`, {
      method: 'POST',
      headers: {
        apikey: SUPABASE_SERVICE_KEY,
        Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
        'Content-Type': 'application/json',
        Prefer: 'return=minimal',
      },
      body: JSON.stringify({
        checkout_request_id: checkoutRequestId,
        purpose: safePurpose,
        user_email: email,
        amount,
        // bookingId is a UUID string (see Booking.id in bookings.ts / the
        // rest of this codebase) — do NOT coerce with Number(). Number()
        // on a UUID evaluates to NaN, and JSON.stringify(NaN) silently
        // serialises to null, so this was writing booking_id: null into
        // every pending_transactions row. mpesa-callback.js's
        // booking_payment branch checks `if (pending.booking_id)` before
        // PATCHing bookings.payment_status — with it always null, that
        // PATCH never ran, payment_status never flipped to 'paid', and
        // useBookingPaymentPoll had nothing to detect. That's why the app
        // relied entirely on the manual "I've paid" button.
        booking_id: bookingId || null,
      }),
    });
    if (!res.ok) {
      console.error('pending_transactions insert failed:', await res.text());
    }
  } catch (e) {
    console.error('recordPendingTransaction error:', e.message);
  }
}

export default async function handler(req, res) {
  const origin = req.headers.origin;
  if (origin && ALLOWED_ORIGINS.has(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Access-Control-Allow-Credentials', 'true');
  }
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ message: 'Method not allowed' });

  if (!CONSUMER_KEY || !CONSUMER_SECRET || !SHORTCODE || !PASSKEY || !CALLBACK_URL || !MPESA_BASE) {
    console.error('M-Pesa env vars missing — check MPESA_CONSUMER_KEY/SECRET/SHORTCODE/PASSKEY/CALLBACK_URL/BASE_URL');
    return res.status(500).json({ message: 'Payments are not configured on the server.' });
  }

  try {
    const { phone, amount, purpose, email, bookingId, accountReference, transactionDesc } = req.body || {};

    if (!phone || amount === undefined || amount === null) {
      return res.status(400).json({ message: 'Phone and amount are required' });
    }

    const numericAmount = Number(amount);
    if (!Number.isFinite(numericAmount) || numericAmount <= 0) {
      return res.status(400).json({ message: 'Invalid amount.' });
    }
    if (numericAmount > MAX_AMOUNT_KES) {
      return res.status(400).json({ message: 'Amount exceeds the allowed limit.' });
    }

    // Normalise phone to 2547XXXXXXXX / 2541XXXXXXXX format
    let normalised = String(phone).replace(/\s+/g, '').replace(/^\+/, '');
    if (normalised.startsWith('07') || normalised.startsWith('01')) {
      normalised = '254' + normalised.slice(1);
    }
    if (!/^254(7|1)\d{8}$/.test(normalised)) {
      return res.status(400).json({ message: 'Invalid Kenyan phone number.' });
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
        Amount: numericAmount,
        PartyA: normalised,
        PartyB: SHORTCODE,
        PhoneNumber: normalised,
        CallBackURL: CALLBACK_URL,
        AccountReference: accountReference || 'SplashPass',
        TransactionDesc: transactionDesc || (
          purpose === 'booking_payment' ? 'SplashPass Booking' :
          purpose === 'operator_subscription' ? 'SplashPass Operator Subscription' :
          'SplashPass Subscription'
        )
      })
    });

    const stkData = await stkRes.json();

    if (stkData.ResponseCode === '0') {
      // Fire-and-forget-ish, but awaited so any failure is logged before
      // we respond — doesn't block/fail the response to the user either
      // way (see the function's own comment on why this is non-fatal).
      await recordPendingTransaction({
        checkoutRequestId: stkData.CheckoutRequestID,
        purpose,
        email,
        amount: numericAmount,
        bookingId,
      });

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

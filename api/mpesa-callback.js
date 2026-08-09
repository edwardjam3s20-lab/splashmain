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

// Deliberately a dynamic import inside a try/catch, NOT a static
// top-of-file `import`. A static import of lib/notifyBookingConfirmed
// (which pulls in the qrcode and resend packages) means: if that module
// fails to load for ANY reason in the deployed environment -- a
// dependency not fully installed, a bundling issue, anything -- this
// entire file fails to load, and every single M-Pesa callback request
// starts failing immediately. That would silently break the actual
// payment confirmation (the thing that matters), not just the "nice to
// have" notification on top of it. Loading it lazily, inside a try/catch,
// means a broken notification module can only ever fail to notify -- it
// can never take down the payment-status flip that already happened.
async function safeNotifyBookingConfirmed(booking) {
  try {
    const { notifyBookingConfirmed } = await import('@/lib/notifyBookingConfirmed')
    await notifyBookingConfirmed(booking)
  } catch (e) {
    console.error('safeNotifyBookingConfirmed: notification module failed to load or run:', e.message)
  }
}

async function fetchBooking(bookingId) {
  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/bookings?id=eq.${bookingId}&select=*`, {
      headers: {
        apikey: SUPABASE_SERVICE_KEY,
        Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
      },
    })
    if (!res.ok) return null
    const rows = await res.json()
    return rows?.[0] || null
  } catch (e) {
    console.error('fetchBooking error:', e.message)
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

// New path, for operator subscriptions. Unlike activateSubscriptionByPhone
// below, this is keyed by email rather than phone — recordPendingTransaction
// in mpesa-stk.js already refuses to write a pending_transactions row at all
// without an email, so pending.user_email is guaranteed to be present here,
// and email is a direct, non-fuzzy match against operators.email (the same
// column loadOperator.js/operator login already key off). Single flat plan
// (operator_monthly, 2000 KSh) for now — see OPERATOR_PLAN_PRICES in
// lib/paystack/plans.js if a second operator tier is added later, at which
// point this should look up which plan was paid for the same way the
// Paystack path does, instead of hardcoding 'operator_monthly'.
async function activateOperatorSubscriptionByEmail(email) {
  if (!SUPABASE_SERVICE_KEY) {
    console.error('Operator subscription activation failed: SUPABASE_SERVICE_ROLE_KEY not configured')
    return false
  }
  try {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/operators?email=eq.${encodeURIComponent(email)}`,
      {
        method: 'PATCH',
        headers: {
          apikey: SUPABASE_SERVICE_KEY,
          Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
          'Content-Type': 'application/json',
          Prefer: 'return=minimal',
        },
        body: JSON.stringify({ sub_status: 'active', sub_plan: 'operator_monthly' }),
      }
    )
    if (!res.ok) {
      console.error('Operator subscription PATCH failed:', await res.text())
      return false
    }
    return true
  } catch (e) {
    console.error('activateOperatorSubscriptionByEmail error:', e.message)
    return false
  }
}

// New path, for org subscriptions. Orgs aren't keyed by an `email` column
// the way operators/profiles are — the paying identity is the org_user
// who owns the org (organization_users.email), not organizations
// .business_email — so this can't PATCH organizations?email=eq... the
// way activateOperatorSubscriptionByEmail does. Two REST calls instead:
// resolve organization_users.email -> id, then organization_members
// (role=owner, removed_at=null) -> organization_id, then PATCH that
// organization row directly by id. Same flat single-plan approach as the
// operator path (org_monthly, 2000 KSh — see ORG_PLAN_PRICES in
// lib/paystack/plans.js).
async function activateOrgSubscriptionByEmail(email) {
  if (!SUPABASE_SERVICE_KEY) {
    console.error('Org subscription activation failed: SUPABASE_SERVICE_ROLE_KEY not configured')
    return false
  }
  try {
    const userRes = await fetch(
      `${SUPABASE_URL}/rest/v1/organization_users?email=eq.${encodeURIComponent(email)}&select=id`,
      {
        headers: {
          apikey: SUPABASE_SERVICE_KEY,
          Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
        },
      }
    )
    if (!userRes.ok) {
      console.error('Org subscription: organization_users lookup failed:', await userRes.text())
      return false
    }
    const users = await userRes.json()
    const userId = users?.[0]?.id
    if (!userId) {
      console.error('Org subscription: no organization_users row for email', email)
      return false
    }

    const memberRes = await fetch(
      `${SUPABASE_URL}/rest/v1/organization_members?user_id=eq.${userId}&role=eq.owner&removed_at=is.null&select=organization_id`,
      {
        headers: {
          apikey: SUPABASE_SERVICE_KEY,
          Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
        },
      }
    )
    if (!memberRes.ok) {
      console.error('Org subscription: organization_members lookup failed:', await memberRes.text())
      return false
    }
    const members = await memberRes.json()
    const organizationId = members?.[0]?.organization_id
    if (!organizationId) {
      console.error('Org subscription: no owner membership found for organization_users.id', userId)
      return false
    }

    const orgRes = await fetch(
      `${SUPABASE_URL}/rest/v1/organizations?id=eq.${organizationId}`,
      {
        method: 'PATCH',
        headers: {
          apikey: SUPABASE_SERVICE_KEY,
          Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
          'Content-Type': 'application/json',
          Prefer: 'return=minimal',
        },
        body: JSON.stringify({ sub_status: 'active', sub_plan: 'org_monthly' }),
      }
    )
    if (!orgRes.ok) {
      console.error('Org subscription PATCH failed:', await orgRes.text())
      return false
    }
    return true
  } catch (e) {
    console.error('activateOrgSubscriptionByEmail error:', e.message)
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
      // FIX (original): this branch used to only mark the internal
      // pending_transactions row as 'completed' and never touched the
      // actual bookings row. The customer app's useBookingPaymentPoll
      // hook polls bookings.payment_status waiting for it to equal
      // 'paid' (see getBookingPaymentStatus in src/lib/bookings.ts) —
      // since nothing ever wrote that value, the poll always timed out
      // and the app never auto-advanced to /confirmed, even though the
      // payment had actually gone through.
      //
      // FIX (this change): setting payment_status alone still wasn't
      // enough. The wallet-payment path (app/api/wallet/pay-booking/
      // route.js) sets status: 'confirmed' too -- that's the field
      // canViewPass actually checks to unlock the in-app QR pass, and
      // the field notifyBookingConfirmed's callers key off. This branch
      // never set it, so an M-Pesa-paid booking stayed stuck on
      // 'accepted' forever: no QR pass, no confirmation email/push. Now
      // it mirrors the wallet path exactly -- same status transition,
      // same guard (only promote out of 'accepted'), same notification.
      if (pending.booking_id) {
        const existing = await fetchBooking(pending.booking_id)
        // Only promote all the way to 'confirmed' (and only fire the
        // confirmation notifications) if the booking was actually
        // sitting in 'accepted' waiting on this payment -- same guard
        // the wallet-payment route applies. Protects against a retried/
        // duplicate Daraja callback re-confirming (and re-notifying)
        // a booking that's already confirmed, or forcing 'confirmed'
        // onto a booking that's since moved to some other state.
        const shouldConfirm = existing?.status === 'accepted'

        const bookingRes = await fetch(
          `${SUPABASE_URL}/rest/v1/bookings?id=eq.${pending.booking_id}`,
          {
            method: 'PATCH',
            headers: {
              apikey: SUPABASE_SERVICE_KEY,
              Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
              'Content-Type': 'application/json',
              Prefer: 'return=representation',
            },
            body: JSON.stringify(
              shouldConfirm
                ? { payment_status: 'paid', status: 'confirmed' }
                : { payment_status: 'paid' }
            ),
          }
        )

        if (!bookingRes.ok) {
          console.error('Failed to mark booking paid:', await bookingRes.text())
        } else if (shouldConfirm) {
          const rows = await bookingRes.json()
          const updatedBooking = rows?.[0]
          if (updatedBooking) {
            await safeNotifyBookingConfirmed(updatedBooking)
          }
        } else if (existing) {
          console.warn(
            `M-Pesa payment recorded for booking ${pending.booking_id} but its status was "${existing.status}", not "accepted" — payment_status set to paid, status left unchanged.`
          )
        }
      } else {
        console.error('booking_payment callback with no booking_id on pending row — cannot update booking', checkoutRequestId)
      }

      await markPendingTransaction(checkoutRequestId, 'completed')
      return res.status(200).json({ message: 'Booking payment recorded' });
    }

    if (pending?.purpose === 'operator_subscription') {
      const ok = await activateOperatorSubscriptionByEmail(pending.user_email)
      await markPendingTransaction(checkoutRequestId, ok ? 'completed' : 'failed')
      return res.status(200).json({ message: ok ? 'Operator subscription activated' : 'Operator subscription activation failed' });
    }

    if (pending?.purpose === 'org_subscription') {
      const ok = await activateOrgSubscriptionByEmail(pending.user_email)
      await markPendingTransaction(checkoutRequestId, ok ? 'completed' : 'failed')
      return res.status(200).json({ message: ok ? 'Org subscription activated' : 'Org subscription activation failed' });
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

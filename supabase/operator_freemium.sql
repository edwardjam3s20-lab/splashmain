-- Run once in Supabase SQL editor.
-- Adds the columns operators need for the same 14-day-trial-then-subscribe
-- gate that already exists for customers on `profiles` (sub_status,
-- created_at). Mirrors that shape exactly so lib/operatorAccess.js can
-- reuse the same logic pattern as app/api/bookings/route.js's isOnTrial.

alter table operators
  add column if not exists created_at timestamptz default now();

alter table operators
  add column if not exists sub_status text default 'trial';

alter table operators
  add column if not exists sub_plan text;

-- Existing operators (created before this migration) get created_at
-- backfilled to NOW() by the default above only for rows inserted after
-- this runs. Existing rows will have created_at = NULL until backfilled
-- explicitly — NULL is treated as "not on trial" by isOperatorOnTrial(),
-- which would incorrectly lock out every existing operator the moment
-- this ships.
--
-- DECISION (dev-stage, no real operator base yet): fresh 14-day trial for
-- everyone, so the trial -> lockout -> subscribe -> unlock path actually
-- gets exercised in testing rather than masked by grandfathering. Revisit
-- this before onboarding real operators — at that point, existing
-- operators may need the grandfather line below instead:
--
-- update operators set sub_status = 'active' where created_at is null;

update operators set created_at = now() where created_at is null;

-- Paystack operator subscriptions reuse the existing paystack_transactions
-- table (see lib/paystack/applyPayment.js) — it needs an account_type
-- column to distinguish operator vs customer plan rows now that plan IDs
-- are looked up from two separate tables (PLAN_PRICES / OPERATOR_PLAN_PRICES
-- in lib/paystack/plans.js).
alter table paystack_transactions
  add column if not exists account_type text default 'customer';

-- If your Daraja/M-Pesa or Paystack purpose/plan columns use a CHECK
-- constraint anywhere on pending_transactions.purpose or a similar
-- enum, add 'operator_subscription' to it manually — no such constraint
-- exists in this repo's SQL files, so nothing to alter here, but check
-- Supabase directly if one was added outside version control.

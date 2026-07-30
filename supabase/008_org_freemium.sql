-- Run once in Supabase SQL editor.
-- Adds the same 14-day-trial-then-subscribe columns that already exist on
-- `operators` (see supabase/operator_freemium.sql) to `organizations`, so
-- lib/orgAccess.js can reuse the identical isOnTrial/hasAccess shape.
--
-- organizations.created_at already exists (every row has one — see
-- scripts/migrate-operators-to-orgs-apply.mjs, which relies on it being
-- set automatically on insert). Only sub_status/sub_plan are new here.

alter table organizations
  add column if not exists sub_status text default 'trial';

alter table organizations
  add column if not exists sub_plan text;

-- GRANDFATHER EXISTING ORGS. Unlike operator_freemium.sql's original
-- "fresh trial for everyone" call (made when there was no real operator
-- base yet, and explicitly flagged there as needing revisiting once real
-- operators existed) — this migration ships AFTER the operator->org
-- migration already put 3 real, paying, in-production businesses into
-- `organizations` (2026-07-28, verification_status = 'verified'). None of
-- them went through a trial signup funnel; they were manually verified
-- and migrated. Starting their clock now and surprising them with a
-- paywall a few days later, for a decision they never agreed to, isn't
-- acceptable — so every org that already existed when this runs is
-- marked active outright. Only orgs created AFTER this point start on
-- the 'trial' default above.
update organizations set sub_status = 'active' where sub_status is null or sub_status = 'trial';

-- Paystack transactions already has account_type (added in
-- operator_freemium.sql) with values 'customer' | 'operator' — 'org' is
-- a new valid value going forward, no schema change needed since the
-- column is a plain text field, not a CHECK-constrained enum.

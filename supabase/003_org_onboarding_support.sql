-- Run once in Supabase SQL editor.
-- Supports the registration/onboarding backend for the multi-tenant SaaS
-- redesign: OTP storage for organization_users, plus integrity
-- constraints the app layer alone can't guarantee.

-- Fix left over from 001: invitations.washpoint_ids was created as
-- bigint[] instead of uuid[] (wash_points.id is uuid). Safe to run — the
-- table is still empty, so there's no data to coerce.
alter table invitations
  alter column washpoint_ids type uuid[]
  using washpoint_ids::text[]::uuid[];

-- Prevents duplicate accounts for the same email. app/api/org/auth/register
-- checks this before insert, but only a real constraint closes the race
-- between two concurrent signups for the same address.
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'organization_users_email_key'
  ) then
    alter table organization_users add constraint organization_users_email_key unique (email);
  end if;
end $$;

-- One active membership per (organization, user) — same partial-unique-
-- index pattern already used for wash_point_staff elsewhere in this
-- project, to prevent assignment race conditions rather than relying on
-- an app-layer check alone. A removed member (removed_at set) can be
-- re-invited later without conflicting with their old, inactive row.
create unique index if not exists organization_members_org_user_active_idx
  on organization_members (organization_id, user_id)
  where removed_at is null;

-- OTP storage for organization_users email verification only. Phone
-- verification doesn't need a local code column — WapiSMS generates,
-- sends, and verifies phone OTPs on its own side (see
-- app/api/org/verify/phone-send and phone-verify), exactly like the
-- existing customer phone-verification flow already works.
create table if not exists organization_user_verification (
  email text primary key references organization_users(email) on delete cascade,
  email_code text,
  email_code_expires_at timestamptz
);

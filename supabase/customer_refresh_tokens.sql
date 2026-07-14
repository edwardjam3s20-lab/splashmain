-- customer_refresh_tokens
-- Server-side store for refresh tokens, enabling rotation and revocation
-- (neither is possible with a stateless JWT alone). Only a SHA-256 hash of
-- the token is ever stored — the plaintext exists only in the httpOnly
-- cookie and in transit over HTTPS.
--
-- family_id links every token in one rotation chain together. It's what
-- makes reuse-detection possible: if an already-rotated (revoked) token is
-- ever presented again, every token sharing its family_id gets revoked in
-- one update, ending that whole chain rather than just the one request.

create table if not exists customer_refresh_tokens (
  id              uuid primary key default gen_random_uuid(),
  customer_email  text not null,
  token_hash      text not null unique,
  family_id       uuid not null,
  created_at      timestamptz not null default now(),
  expires_at      timestamptz not null,
  revoked_at      timestamptz
);

-- Every refresh-endpoint hit looks up by token_hash first.
create index if not exists idx_customer_refresh_tokens_hash
  on customer_refresh_tokens (token_hash);

-- Logout and "revoke all sessions for this user" both filter by email.
create index if not exists idx_customer_refresh_tokens_email
  on customer_refresh_tokens (customer_email);

-- Reuse-detection and rotation both update by family_id.
create index if not exists idx_customer_refresh_tokens_family
  on customer_refresh_tokens (family_id);

-- This table is only ever touched via the Supabase service-role client in
-- lib/session.js (getSupabaseAdmin()), never from the browser — so RLS is
-- enabled with no policies, matching the deny-by-default posture used
-- elsewhere in this project for service-role-only tables.
alter table customer_refresh_tokens enable row level security;

-- Optional housekeeping: periodically clear out rows that are long past
-- being useful. Not required for correctness (expired/revoked rows are
-- already rejected by rotateRefreshToken's checks), just keeps the table
-- from growing forever. Safe to run on a schedule (e.g. a daily cron / edge
-- function) or skip entirely.
-- delete from customer_refresh_tokens
--   where revoked_at is not null and revoked_at < now() - interval '90 days'
--      or expires_at < now() - interval '90 days';

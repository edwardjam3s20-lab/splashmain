-- customer_verification: add password-reset columns
--
-- Reuses the existing customer_verification table (already holds
-- email_code/email_code_expires_at for signup/login email OTPs) rather than
-- a new table, but with its own dedicated columns — sharing email_code
-- would let a live password-reset code get silently clobbered by an
-- unrelated email-verification send (or vice versa), since both flows key
-- on the same `email` row via upsert(onConflict: 'email').
--
-- Run this once against the Supabase project before deploying
-- app/api/auth/forgot-password and app/api/auth/reset-password.

alter table customer_verification
  add column if not exists reset_code text,
  add column if not exists reset_code_expires_at timestamptz;

-- Adds referral tracking to profiles.
--
-- referral_code       — this user's own shareable code. Backfilled for
--                        existing rows below; app layer generates it for
--                        new signups going forward (app/api/auth/register).
-- referred_by_code     — the referral_code of whoever referred this user,
--                        captured at signup (register/route.js), null if
--                        they signed up unreferred or with an invalid code.
-- referral_bonus_awarded — flips true the one time the referrer is paid
--                        out for this signup (app/api/verify/email-verify),
--                        so a re-run or duplicate verify call can never
--                        double-award the same referral.
--
-- Bonus points are written to the existing point_ledger table (same one
-- app/api/loyalty/transactions already reads) with reason
-- 'referral_bonus' — no new ledger/points mechanism, just a new reason
-- value + the columns above needed to compute it once.
--
-- Run once in Supabase SQL editor.

alter table profiles
  add column if not exists referral_code text,
  add column if not exists referred_by_code text,
  add column if not exists referral_bonus_awarded boolean not null default false;

-- Backfill: give every existing profile a code before the unique
-- constraint goes on. Format matches what register/route.js generates
-- going forward (see lib/referralCode.js) — 4 letters from the name (or
-- "SPLASH" if the name is too short/blank) + 4 random alphanumerics.
do $$
declare
  r record;
  candidate text;
begin
  for r in select id, name from profiles where referral_code is null loop
    loop
      candidate := upper(
        coalesce(nullif(regexp_replace(r.name, '[^a-zA-Z]', '', 'g'), ''), 'SPLASH')
      );
      candidate := left(candidate, 4) ||
        upper(substr(md5(random()::text || r.id::text), 1, 4));
      exit when not exists (select 1 from profiles where referral_code = candidate);
    end loop;
    update profiles set referral_code = candidate where id = r.id;
  end loop;
end $$;

alter table profiles
  alter column referral_code set not null;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'profiles_referral_code_key'
  ) then
    alter table profiles add constraint profiles_referral_code_key unique (referral_code);
  end if;
end $$;

-- referred_by_code intentionally has NO foreign key to profiles.referral_code:
-- register/route.js already validates the code against a real profile before
-- storing it, and a loose column here means a referrer deleting their
-- account later can't ever break the referred user's row via FK cascade/
-- restrict — same reasoning invitations.washpoint_ids etc. use elsewhere
-- in this project for soft references.

create index if not exists profiles_referred_by_code_idx
  on profiles (referred_by_code)
  where referred_by_code is not null;

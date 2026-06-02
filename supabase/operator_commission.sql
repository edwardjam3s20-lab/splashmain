-- Commission tiers & operator payouts (run once in Supabase SQL editor)

-- Tier 1: operator 80%, platform 20% (default)
-- Tier 2: operator 90%, platform 10%
alter table operators
  add column if not exists commission_tier smallint not null default 1
  check (commission_tier in (1, 2));

alter table wash_points
  add column if not exists commission_tier smallint not null default 1
  check (commission_tier in (1, 2));

alter table bookings
  add column if not exists commission_tier smallint,
  add column if not exists splash_commission integer;

create table if not exists operator_payments (
  id bigint generated always as identity primary key,
  wash_point text not null,
  operator_name text,
  operator_id bigint references operators(id),
  amount integer not null check (amount > 0),
  method text default 'mpesa',
  reference text,
  notes text,
  paid_at timestamptz default now()
);

create index if not exists operator_payments_wp_idx on operator_payments(wash_point);
create index if not exists operator_payments_paid_at_idx on operator_payments(paid_at desc);

-- Commission tiers & operator payouts (run once in Supabase SQL editor)

-- Tier 1: operator 80%, platform 20% (default)
-- Tier 2: operator 90%, platform 10%
alter table operators
  add column if not exists commission_tier smallint not null default 1
  check (commission_tier in (1, 2));

alter table operators
  add column if not exists mpesa_phone text;

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
  operator_phone text,
  amount integer not null check (amount > 0),
  method text default 'mpesa',
  reference text,
  notes text,
  status text default 'manual',
  requested_by text,
  initiated_at timestamptz default now(),
  completed_at timestamptz,
  mpesa_originator_conversation_id text,
  mpesa_conversation_id text,
  mpesa_response_code text,
  mpesa_response_description text,
  mpesa_result_code integer,
  mpesa_result_description text,
  mpesa_transaction_id text,
  raw_response jsonb,
  raw_result jsonb,
  paid_at timestamptz default now()
);

alter table operator_payments
  add column if not exists operator_phone text,
  add column if not exists status text default 'manual',
  add column if not exists requested_by text,
  add column if not exists initiated_at timestamptz default now(),
  add column if not exists completed_at timestamptz,
  add column if not exists mpesa_originator_conversation_id text,
  add column if not exists mpesa_conversation_id text,
  add column if not exists mpesa_response_code text,
  add column if not exists mpesa_response_description text,
  add column if not exists mpesa_result_code integer,
  add column if not exists mpesa_result_description text,
  add column if not exists mpesa_transaction_id text,
  add column if not exists raw_response jsonb,
  add column if not exists raw_result jsonb;

create index if not exists operator_payments_wp_idx on operator_payments(wash_point);
create index if not exists operator_payments_paid_at_idx on operator_payments(paid_at desc);
create index if not exists operator_payments_conversation_idx on operator_payments(mpesa_conversation_id);
create index if not exists operator_payments_originator_idx on operator_payments(mpesa_originator_conversation_id);

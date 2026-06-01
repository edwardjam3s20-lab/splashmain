-- Run once in Supabase SQL editor (SplashPass operator improvements)

-- Link operators to wash_points by ID (admin can set wash_point_id when creating operators)
alter table operators
  add column if not exists wash_point_id bigint references wash_points(id);

-- Optional: backfill wash_point_id from name
-- update operators o
-- set wash_point_id = w.id
-- from wash_points w
-- where o.wash_point = w.name and o.wash_point_id is null;

-- Booking assignment / wash lifecycle (for multi-device operator queue)
alter table bookings
  add column if not exists assigned_washer_id text,
  add column if not exists assigned_washer_name text,
  add column if not exists wash_started_at timestamptz;

-- Staff roster per wash point (replaces localStorage-only washers)
create table if not exists wash_point_staff (
  id bigint generated always as identity primary key,
  wash_point_id bigint not null references wash_points(id) on delete cascade,
  name text not null,
  role text default 'Washer',
  created_at timestamptz default now()
);

create index if not exists wash_point_staff_wp_idx on wash_point_staff(wash_point_id);

-- Tighten RLS: operators should use server APIs only (anon key no longer needs write access)
-- Review existing policies on operators, bookings, profiles, wash_point_extras.

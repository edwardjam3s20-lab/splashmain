-- Run once in Supabase SQL editor.
-- Adds the one column washpoint management actually needs that doesn't
-- exist yet. The legacy "is this location open" concept lives entirely on
-- operators.status, which has no equivalent under the org model (a
-- washpoint can have several staff, so no single person's status can
-- represent the location itself) -- hence a real column here rather than
-- reusing anything from the operator side.
alter table wash_points
  add column if not exists active boolean not null default true;

-- Store Netflix accounts waiting for a household-problem replacement.
create table if not exists public.household_pool (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null unique,
  email text not null,
  days_remaining integer not null check (days_remaining >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  last_matched_at timestamptz
);

-- Reserve each source request and customer link exactly once.
create table if not exists public.household_assignments (
  id uuid primary key default gen_random_uuid(),
  source_account_id uuid not null unique,
  replacement_account_id uuid not null,
  customer_link_id uuid not null unique,
  created_at timestamptz not null default now()
);

create index if not exists household_pool_days_remaining_idx
  on public.household_pool (days_remaining);

create index if not exists household_assignments_replacement_account_idx
  on public.household_assignments (replacement_account_id);

alter table public.household_pool enable row level security;
alter table public.household_assignments enable row level security;

revoke all on table public.household_pool from anon, authenticated;
revoke all on table public.household_assignments from anon, authenticated;
grant select, insert, update, delete on table public.household_pool to service_role;
grant select, insert, update, delete on table public.household_assignments to service_role;

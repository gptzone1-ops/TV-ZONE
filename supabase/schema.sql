create extension if not exists "pgcrypto";

create table if not exists public.accounts (
  id uuid primary key default gen_random_uuid(),
  email text not null,
  password text not null,
  use_automated_code boolean not null default true,
  supplier_code_url text,
  code_fetch_method text check (code_fetch_method in ('auto_fetch', 'external_link') or code_fetch_method is null),
  verification_code text,
  verification_code_received_at timestamptz,
  service_type text not null default 'netflix' check (service_type in ('netflix', 'shahid', 'osn')),
  osn_subscription_mode text check (osn_subscription_mode in ('telegram_keys', 'monthly_rotation') or osn_subscription_mode is null),
  osn_cycle_number integer check (osn_cycle_number between 1 and 3 or osn_cycle_number is null),
  osn_cycle_started_at timestamptz,
  osn_cycle_ends_at timestamptz,
  account_type text not null check (account_type in ('private', 'shared', 'temporary', 'compensation')),
  compensation_distribution text check (compensation_distribution in ('private', 'shared')),
  compensation_tutorial_url text,
  temporary_short_id text unique,
  email_provider text not null default 'none' check (email_provider in ('none', 'outlook')),
  imap_enabled boolean not null default false,
  normal_client_layout boolean not null default false,
  hide_password_from_client boolean not null default false,
  is_reported_closed boolean not null default false,
  reported_closed_at timestamptz,
  expires_at date not null,
  created_at timestamptz not null default now(),
  constraint accounts_compensation_distribution_check check (
    (account_type = 'compensation' and compensation_distribution in ('private', 'shared'))
    or (account_type <> 'compensation' and compensation_distribution is null)
  ),
  constraint accounts_compensation_code_url_required check (
    account_type <> 'compensation' or nullif(btrim(supplier_code_url), '') is not null
  ),
  constraint accounts_external_code_url_required check (
    code_fetch_method is distinct from 'external_link'
    or coalesce(supplier_code_url, '') ~* '^https?://'
  )
);

create table if not exists public.customer_links (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts(id) on delete cascade,
  email text,
  uuid uuid not null unique default gen_random_uuid(),
  short_id text unique,
  service_type text not null default 'netflix' check (service_type in ('netflix', 'shahid', 'osn')),
  profile_name text not null,
  profile_label text not null,
  profile_code text not null,
  activation_key text,
  tv_approval_url text,
  has_used_tv_link boolean not null default false,
  tv_link_used_at timestamptz,
  external_code_used boolean not null default false,
  external_code_used_at timestamptz,
  external_code_first_opened_at timestamptz,
  updated_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

alter table public.accounts
  add column if not exists osn_subscription_mode text,
  add column if not exists osn_cycle_number integer,
  add column if not exists osn_cycle_started_at timestamptz,
  add column if not exists osn_cycle_ends_at timestamptz;

alter table public.customer_links
  add column if not exists short_id text;

alter table public.customer_links
  add column if not exists email text;

alter table public.customer_links
  add column if not exists activation_key text;

create unique index if not exists customer_links_osn_activation_key_unique
  on public.customer_links (lower(activation_key))
  where service_type = 'osn' and nullif(btrim(activation_key), '') is not null;

create table if not exists public.osn_codes (
  email text primary key,
  code text not null check (code ~ '^\d{4}$'),
  updated_at timestamptz not null default now()
);

create unique index if not exists osn_codes_email_lower_unique
  on public.osn_codes (lower(btrim(email)));

create index if not exists osn_codes_updated_at_idx
  on public.osn_codes (updated_at desc);

update public.customer_links as links
set email = accounts.email
from public.accounts as accounts
where accounts.id = links.account_id
  and (links.email is null or btrim(links.email) = '');

create sequence if not exists public.customer_links_link_number_seq start with 100;

alter table public.customer_links
  add column if not exists link_number bigint;

alter table public.customer_links
  alter column link_number set default nextval('public.customer_links_link_number_seq');

update public.customer_links
  set link_number = nextval('public.customer_links_link_number_seq')
  where link_number is null;

alter table public.customer_links
  alter column link_number set not null;

alter table public.customer_links
  add column if not exists code_request_limit integer not null default 1;

alter table public.customer_links
  add column if not exists code_requested_count integer not null default 0;

alter table public.customer_links
  add column if not exists code_used_at timestamptz;

alter table public.customer_links
  add column if not exists selected_device text;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'customer_links_selected_device_check'
      and conrelid = 'public.customer_links'::regclass
  ) then
    alter table public.customer_links
      add constraint customer_links_selected_device_check
      check (selected_device in ('mobile', 'screen') or selected_device is null);
  end if;
end
$$;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'accounts_external_code_url_required'
      and conrelid = 'public.accounts'::regclass
  ) then
    alter table public.accounts
      add constraint accounts_external_code_url_required
      check (
        code_fetch_method is distinct from 'external_link'
        or coalesce(supplier_code_url, '') ~* '^https?://'
      );
  end if;
end
$$;

alter table public.customer_links
  add column if not exists verification_code text;

alter table public.customer_links
  add column if not exists verification_code_received_at timestamptz;

alter table public.customer_links
  add column if not exists tv_approval_url text;

alter table public.customer_links
  add column if not exists has_used_tv_link boolean not null default false;

alter table public.customer_links
  add column if not exists tv_link_used_at timestamptz;

alter table public.customer_links
  add column if not exists external_code_used boolean not null default false;

alter table public.customer_links
  add column if not exists external_code_used_at timestamptz;

alter table public.customer_links
  add column if not exists external_code_first_opened_at timestamptz;

create or replace function public.protect_external_code_access_state()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'external_code_access_state_is_server_managed';
  end if;
  return new;
end;
$$;

drop trigger if exists protect_external_code_access_state_trigger on public.customer_links;
create trigger protect_external_code_access_state_trigger
before update of external_code_used, external_code_used_at, external_code_first_opened_at on public.customer_links
for each row execute function public.protect_external_code_access_state();

alter table public.customer_links
  add column if not exists updated_at timestamptz not null default now();

alter table public.customer_links
  add column if not exists generation_version integer;

alter table public.accounts
  add column if not exists service_type text not null default 'netflix';

alter table public.accounts
  add column if not exists use_automated_code boolean;

update public.accounts
  set use_automated_code = false
  where use_automated_code is null;

alter table public.accounts
  alter column use_automated_code set default true;

alter table public.accounts
  alter column use_automated_code set not null;

alter table public.accounts
  add column if not exists supplier_code_url text;

alter table public.accounts
  add column if not exists code_fetch_method text;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'accounts_code_fetch_method_check'
      and conrelid = 'public.accounts'::regclass
  ) then
    alter table public.accounts
      add constraint accounts_code_fetch_method_check
      check (code_fetch_method in ('auto_fetch', 'external_link') or code_fetch_method is null);
  end if;
end
$$;

alter table public.accounts
  add column if not exists verification_code text;

alter table public.accounts
  add column if not exists verification_code_received_at timestamptz;

alter table public.customer_links
  add column if not exists service_type text not null default 'netflix';

alter table if exists public.customer_links
  drop constraint if exists unique_customer_email;

alter table if exists public.customer_links
  drop constraint if exists customer_links_email_key;

drop index if exists public.unique_customer_email;
drop index if exists public.customer_links_email_key;
drop index if exists public.customer_links_email_unique;

create unique index if not exists customer_links_short_id_key
  on public.customer_links(short_id)
  where short_id is not null;

create unique index if not exists customer_links_link_number_key
  on public.customer_links(link_number);

create unique index if not exists customer_links_strict_account_profile_key
  on public.customer_links(account_id, profile_name)
  where generation_version = 2;

create index if not exists customer_links_email_idx
  on public.customer_links(lower(email))
  where email is not null and btrim(email) <> '';

create index if not exists accounts_created_at_idx on public.accounts(created_at desc);
create index if not exists customer_links_account_id_idx on public.customer_links(account_id);
create index if not exists customer_links_uuid_idx on public.customer_links(uuid);
create index if not exists customer_links_short_id_idx on public.customer_links(short_id);

alter table public.accounts enable row level security;
alter table public.customer_links enable row level security;

drop policy if exists "Allow anon dashboard reads accounts" on public.accounts;
drop policy if exists "Allow anon dashboard writes accounts" on public.accounts;
drop policy if exists "Allow anon dashboard updates accounts" on public.accounts;
drop policy if exists "Allow anon dashboard deletes accounts" on public.accounts;
drop policy if exists "Allow anon customer link reads" on public.customer_links;
drop policy if exists "Allow anon customer link writes" on public.customer_links;
drop policy if exists "Allow anon customer link deletes" on public.customer_links;
drop policy if exists "Allow anon customer link updates" on public.customer_links;

create policy "Allow anon dashboard reads accounts"
  on public.accounts for select
  to anon
  using (true);

create policy "Allow anon dashboard writes accounts"
  on public.accounts for insert
  to anon
  with check (true);

create policy "Allow anon dashboard updates accounts"
  on public.accounts for update
  to anon
  using (true)
  with check (true);

create policy "Allow anon dashboard deletes accounts"
  on public.accounts for delete
  to anon
  using (true);

create policy "Allow anon customer link reads"
  on public.customer_links for select
  to anon
  using (true);

create policy "Allow anon customer link writes"
  on public.customer_links for insert
  to anon
  with check (true);

create policy "Allow anon customer link deletes"
  on public.customer_links for delete
  to anon
  using (true);

create policy "Allow anon customer link updates"
  on public.customer_links for update
  to anon
  using (true)
  with check (true);

grant select, insert, update, delete on public.accounts to anon, authenticated;
grant select, insert, update, delete on public.customer_links to anon, authenticated;
grant usage, select on sequence public.customer_links_link_number_seq to anon, authenticated;

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

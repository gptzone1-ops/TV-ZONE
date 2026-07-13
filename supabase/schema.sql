create extension if not exists "pgcrypto";

create table if not exists public.accounts (
  id uuid primary key default gen_random_uuid(),
  email text not null,
  password text not null,
  service_type text not null default 'netflix' check (service_type in ('netflix', 'shahid')),
  account_type text not null check (account_type in ('private', 'shared')),
  expires_at date not null,
  created_at timestamptz not null default now()
);

create table if not exists public.customer_links (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts(id) on delete cascade,
  uuid uuid not null unique default gen_random_uuid(),
  short_id text unique,
  service_type text not null default 'netflix' check (service_type in ('netflix', 'shahid')),
  profile_name text not null,
  profile_label text not null,
  profile_code text not null,
  created_at timestamptz not null default now()
);

alter table public.customer_links
  add column if not exists short_id text;

alter table public.accounts
  add column if not exists service_type text not null default 'netflix';

alter table public.customer_links
  add column if not exists service_type text not null default 'netflix';

create unique index if not exists customer_links_short_id_key
  on public.customer_links(short_id)
  where short_id is not null;

create index if not exists accounts_created_at_idx on public.accounts(created_at desc);
create index if not exists customer_links_account_id_idx on public.customer_links(account_id);
create index if not exists customer_links_uuid_idx on public.customer_links(uuid);
create index if not exists customer_links_short_id_idx on public.customer_links(short_id);

alter table public.accounts enable row level security;
alter table public.customer_links enable row level security;

drop policy if exists "Allow anon dashboard reads accounts" on public.accounts;
drop policy if exists "Allow anon dashboard writes accounts" on public.accounts;
drop policy if exists "Allow anon dashboard deletes accounts" on public.accounts;
drop policy if exists "Allow anon customer link reads" on public.customer_links;
drop policy if exists "Allow anon customer link writes" on public.customer_links;
drop policy if exists "Allow anon customer link deletes" on public.customer_links;

create policy "Allow anon dashboard reads accounts"
  on public.accounts for select
  to anon
  using (true);

create policy "Allow anon dashboard writes accounts"
  on public.accounts for insert
  to anon
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

grant select, insert, delete on public.accounts to anon, authenticated;
grant select, insert, delete on public.customer_links to anon, authenticated;

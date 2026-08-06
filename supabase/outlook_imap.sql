-- Run once in Supabase SQL Editor before enabling Outlook IMAP accounts.
-- Existing accounts remain disabled because the new flag defaults to false.
alter table public.accounts
  add column if not exists email_provider text not null default 'none';

alter table public.accounts
  add column if not exists imap_enabled boolean not null default false;

alter table public.accounts
  drop constraint if exists accounts_email_provider_check;

alter table public.accounts
  add constraint accounts_email_provider_check
  check (email_provider in ('none', 'outlook'));

update public.accounts
set email_provider = 'none', imap_enabled = false
where email_provider is null or imap_enabled is null;

create table if not exists public.account_imap_credentials (
  account_id uuid primary key references public.accounts(id) on delete cascade,
  provider text not null default 'outlook' check (provider = 'outlook'),
  encrypted_password text not null,
  encryption_iv text not null,
  encryption_tag text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.account_imap_credentials enable row level security;
revoke all on public.account_imap_credentials from anon, authenticated;
grant all on public.account_imap_credentials to service_role;

alter table public.verification_messages
  add column if not exists source_key text;

create unique index if not exists verification_messages_source_key_unique
  on public.verification_messages (source_key)
  where source_key is not null;

select pg_notify('pgrst', 'reload schema');

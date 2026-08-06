-- Run once in Supabase SQL Editor before creating temporary accounts.
alter table public.accounts
  add column if not exists temporary_short_id text;

alter table public.accounts
  drop constraint if exists accounts_account_type_check;

alter table public.accounts
  add constraint accounts_account_type_check
  check (account_type in ('private', 'shared', 'temporary'));

create unique index if not exists accounts_temporary_short_id_key
  on public.accounts (temporary_short_id)
  where temporary_short_id is not null;

select pg_notify('pgrst', 'reload schema');

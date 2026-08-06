-- Safe migration for the new account type only.
-- This migration does not update or delete any existing account or customer link.

alter table public.accounts
  add column if not exists compensation_distribution text;

alter table public.accounts
  drop constraint if exists accounts_account_type_check;

alter table public.accounts
  add constraint accounts_account_type_check
  check (account_type in ('private', 'shared', 'temporary', 'compensation'));

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'accounts_compensation_distribution_check'
      and conrelid = 'public.accounts'::regclass
  ) then
    alter table public.accounts
      add constraint accounts_compensation_distribution_check
      check (
        (account_type = 'compensation' and compensation_distribution in ('private', 'shared'))
        or
        (account_type <> 'compensation' and compensation_distribution is null)
      );
  end if;
end;
$$;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'accounts_compensation_code_url_required'
      and conrelid = 'public.accounts'::regclass
  ) then
    alter table public.accounts
      add constraint accounts_compensation_code_url_required
      check (
        account_type <> 'compensation'
        or nullif(btrim(supplier_code_url), '') is not null
      );
  end if;
end;
$$;

select pg_notify('pgrst', 'reload schema');

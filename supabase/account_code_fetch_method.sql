-- Nullable by design: existing accounts keep their current behavior unchanged.
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

select pg_notify('pgrst', 'reload schema');

-- Adds OSN as an isolated service type. This migration does not update or
-- delete any existing Netflix or Shahid account/customer-link rows.

do $$
declare
  constraint_row record;
begin
  for constraint_row in
    select conname
    from pg_constraint
    where conrelid = 'public.accounts'::regclass
      and contype = 'c'
      and pg_get_constraintdef(oid) ilike '%service_type%'
  loop
    execute format('alter table public.accounts drop constraint %I', constraint_row.conname);
  end loop;
end
$$;

alter table public.accounts
  add constraint accounts_service_type_check
  check (service_type in ('netflix', 'shahid', 'osn')) not valid;

alter table public.accounts
  validate constraint accounts_service_type_check;

do $$
declare
  constraint_row record;
begin
  for constraint_row in
    select conname
    from pg_constraint
    where conrelid = 'public.customer_links'::regclass
      and contype = 'c'
      and pg_get_constraintdef(oid) ilike '%service_type%'
  loop
    execute format('alter table public.customer_links drop constraint %I', constraint_row.conname);
  end loop;
end
$$;

alter table public.customer_links
  add constraint customer_links_service_type_check
  check (service_type in ('netflix', 'shahid', 'osn')) not valid;

alter table public.customer_links
  validate constraint customer_links_service_type_check;

select pg_notify('pgrst', 'reload schema');

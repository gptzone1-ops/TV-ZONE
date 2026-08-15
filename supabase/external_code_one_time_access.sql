-- Tracks one-time external code access per customer link. No customer URL changes.
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

select pg_notify('pgrst', 'reload schema');

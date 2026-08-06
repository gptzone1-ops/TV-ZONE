create extension if not exists pgcrypto;

alter table public.customer_links
  add column if not exists client_code text;

create or replace function public.generate_client_code()
returns text
language plpgsql
volatile
set search_path = public
as $$
declare
  letters constant text := 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  digits constant text := '0123456789';
  candidate text;
begin
  perform pg_advisory_xact_lock(hashtext('zone_store_client_code_generation'));

  loop
    candidate :=
      substr(letters, 1 + floor(random() * length(letters))::integer, 1) ||
      substr(digits, 1 + floor(random() * length(digits))::integer, 1) ||
      substr(letters, 1 + floor(random() * length(letters))::integer, 1) ||
      substr(digits, 1 + floor(random() * length(digits))::integer, 1) ||
      substr(letters, 1 + floor(random() * length(letters))::integer, 1) ||
      substr(digits, 1 + floor(random() * length(digits))::integer, 1);

    exit when not exists (
      select 1
      from public.customer_links
      where lower(client_code) = lower(candidate)
    );
  end loop;

  return candidate;
end;
$$;

create or replace function public.set_customer_client_code()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.client_code is null or btrim(new.client_code) = '' then
    new.client_code := public.generate_client_code();
  else
    new.client_code := upper(btrim(new.client_code));
  end if;
  return new;
end;
$$;

drop trigger if exists customer_links_set_client_code on public.customer_links;
create trigger customer_links_set_client_code
before insert or update of client_code on public.customer_links
for each row execute function public.set_customer_client_code();

do $$
declare
  customer_row record;
begin
  for customer_row in
    select id from public.customer_links where client_code is null or btrim(client_code) = ''
  loop
    update public.customer_links
    set client_code = public.generate_client_code()
    where id = customer_row.id;
  end loop;
end;
$$;

alter table public.customer_links
  alter column client_code set default public.generate_client_code(),
  alter column client_code set not null;

create unique index if not exists customer_links_client_code_unique
  on public.customer_links (client_code);

create unique index if not exists customer_links_client_code_ci_unique
  on public.customer_links (lower(client_code));

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'customer_links_client_code_format'
  ) then
    alter table public.customer_links
      add constraint customer_links_client_code_format
      check (client_code ~ '^[A-Z][0-9][A-Z][0-9][A-Z][0-9]$');
  end if;
end;
$$;

create table if not exists public.compensation_requests (
  id uuid primary key default gen_random_uuid(),
  client_code text not null,
  status text not null default 'pending'
    check (status in ('pending', 'completed')),
  replacement_link text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint compensation_requests_client_code_unique unique (client_code),
  constraint compensation_requests_customer_fk
    foreign key (client_code) references public.customer_links(client_code)
    on update cascade on delete cascade,
  constraint compensation_requests_completed_link_check
    check (status <> 'completed' or replacement_link is not null)
);

create table if not exists public.compensation_link_pool (
  id uuid primary key default gen_random_uuid(),
  replacement_link text not null unique,
  status text not null default 'available'
    check (status in ('available', 'assigned')),
  assigned_request_id uuid unique
    references public.compensation_requests(id) on delete set null,
  created_at timestamptz not null default now(),
  assigned_at timestamptz,
  constraint compensation_link_pool_assignment_check check (
    (status = 'available' and assigned_request_id is null and assigned_at is null)
    or
    (status = 'assigned' and assigned_request_id is not null and assigned_at is not null)
  )
);

create or replace function public.touch_compensation_request_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  new.client_code := upper(btrim(new.client_code));
  return new;
end;
$$;

drop trigger if exists compensation_requests_touch_updated_at on public.compensation_requests;
create trigger compensation_requests_touch_updated_at
before insert or update on public.compensation_requests
for each row execute function public.touch_compensation_request_updated_at();

create or replace function public.assign_compensation_link(p_request_id uuid)
returns table (
  request_id uuid,
  assigned_client_code text,
  assigned_status text,
  assigned_replacement_link text,
  assigned_updated_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
declare
  selected_request public.compensation_requests%rowtype;
  selected_link public.compensation_link_pool%rowtype;
begin
  select * into selected_request
  from public.compensation_requests
  where id = p_request_id
  for update;

  if not found then
    raise exception 'request_not_found';
  end if;

  if selected_request.status = 'completed' then
    return query select
      selected_request.id,
      selected_request.client_code,
      selected_request.status,
      selected_request.replacement_link,
      selected_request.updated_at;
    return;
  end if;

  select * into selected_link
  from public.compensation_link_pool
  where status = 'available'
  order by created_at, id
  for update skip locked
  limit 1;

  if not found then
    raise exception 'no_available_links';
  end if;

  update public.compensation_requests
  set status = 'completed', replacement_link = selected_link.replacement_link
  where id = selected_request.id
  returning * into selected_request;

  update public.compensation_link_pool
  set status = 'assigned', assigned_request_id = selected_request.id, assigned_at = now()
  where id = selected_link.id;

  return query select
    selected_request.id,
    selected_request.client_code,
    selected_request.status,
    selected_request.replacement_link,
    selected_request.updated_at;
end;
$$;

create or replace function public.distribute_compensation_links()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  pending_request record;
  assigned_count integer := 0;
begin
  for pending_request in
    select id
    from public.compensation_requests
    where status = 'pending'
    order by created_at, id
  loop
    begin
      perform public.assign_compensation_link(pending_request.id);
      assigned_count := assigned_count + 1;
    exception
      when others then
        if sqlerrm = 'no_available_links' then
          exit;
        end if;
        raise;
    end;
  end loop;

  return assigned_count;
end;
$$;

alter table public.compensation_requests enable row level security;
alter table public.compensation_link_pool enable row level security;

revoke all on public.compensation_requests from anon, authenticated;
revoke all on public.compensation_link_pool from anon, authenticated;
revoke all on function public.assign_compensation_link(uuid) from public, anon, authenticated;
revoke all on function public.distribute_compensation_links() from public, anon, authenticated;
grant execute on function public.assign_compensation_link(uuid) to service_role;
grant execute on function public.distribute_compensation_links() to service_role;

select pg_notify('pgrst', 'reload schema');

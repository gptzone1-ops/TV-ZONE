-- Safe migration: this file never updates or deletes compensation_requests rows.
-- Existing pool links remain untouched and unclassified (account_type = null).

alter table public.compensation_link_pool
  add column if not exists account_type text;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'compensation_link_pool_account_type_check'
      and conrelid = 'public.compensation_link_pool'::regclass
  ) then
    alter table public.compensation_link_pool
      add constraint compensation_link_pool_account_type_check
      check (account_type is null or account_type in ('private', 'shared'));
  end if;
end;
$$;

create index if not exists compensation_link_pool_type_status_idx
  on public.compensation_link_pool (account_type, status, created_at, id);

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
  requested_account_type text;
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

  -- Read-only account type lookup. No customer, account, or pending request is changed.
  select case
    when accounts.account_type = 'private' then 'private'
    when accounts.account_type = 'shared' then 'shared'
    else null
  end
  into requested_account_type
  from public.customer_links as links
  join public.accounts as accounts on accounts.id = links.account_id
  where upper(btrim(links.client_code)) = upper(btrim(selected_request.client_code))
  limit 1;

  if requested_account_type is null then
    raise exception 'request_account_type_not_found';
  end if;

  select * into selected_link
  from public.compensation_link_pool
  where status = 'available'
    and account_type = requested_account_type
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
        if sqlerrm in ('no_available_links', 'request_account_type_not_found') then
          continue;
        end if;
        raise;
    end;
  end loop;

  return assigned_count;
end;
$$;

create or replace function public.distribute_compensation_links_by_type(p_account_type text default null)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  pending_request record;
  assigned_count integer := 0;
  private_exhausted boolean := false;
  shared_exhausted boolean := false;
begin
  if p_account_type is not null and p_account_type not in ('private', 'shared') then
    raise exception 'invalid_account_type';
  end if;

  for pending_request in
    select
      requests.id,
      (
        select case
          when accounts.account_type = 'private' then 'private'
          when accounts.account_type = 'shared' then 'shared'
          else null
        end
        from public.customer_links as links
        join public.accounts as accounts on accounts.id = links.account_id
        where upper(btrim(links.client_code)) = upper(btrim(requests.client_code))
        limit 1
      ) as request_account_type
    from public.compensation_requests as requests
    where requests.status = 'pending'
    order by requests.created_at, requests.id
  loop
    if pending_request.request_account_type is null then
      continue;
    end if;
    if p_account_type is not null and pending_request.request_account_type <> p_account_type then
      continue;
    end if;
    if pending_request.request_account_type = 'private' and private_exhausted then
      continue;
    end if;
    if pending_request.request_account_type = 'shared' and shared_exhausted then
      continue;
    end if;

    begin
      perform public.assign_compensation_link(pending_request.id);
      assigned_count := assigned_count + 1;
    exception
      when others then
        if sqlerrm = 'no_available_links' then
          if pending_request.request_account_type = 'private' then
            private_exhausted := true;
          else
            shared_exhausted := true;
          end if;
          continue;
        end if;
        if sqlerrm = 'request_account_type_not_found' then
          continue;
        end if;
        raise;
    end;
  end loop;

  return assigned_count;
end;
$$;

revoke all on function public.assign_compensation_link(uuid) from public, anon, authenticated;
revoke all on function public.distribute_compensation_links() from public, anon, authenticated;
revoke all on function public.distribute_compensation_links_by_type(text) from public, anon, authenticated;
grant execute on function public.assign_compensation_link(uuid) to service_role;
grant execute on function public.distribute_compensation_links() to service_role;
grant execute on function public.distribute_compensation_links_by_type(text) to service_role;

select pg_notify('pgrst', 'reload schema');

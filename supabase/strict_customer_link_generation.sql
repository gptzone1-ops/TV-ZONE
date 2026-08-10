-- Atomic creation for NEW Netflix private/shared accounts only.
-- This function never updates or deletes existing customer links.

create extension if not exists pgcrypto;

create or replace function public.create_strict_customer_links(
  p_account_id uuid,
  p_email text,
  p_links jsonb
)
returns setof public.customer_links
language plpgsql
security definer
set search_path = public
as $$
declare
  selected_account record;
  expected_count integer;
  inserted_count integer;
begin
  select id, email, account_type, service_type
  into selected_account
  from public.accounts
  where id = p_account_id
  for update;

  if not found then
    raise exception 'account_not_found';
  end if;

  if coalesce(selected_account.service_type, 'netflix') <> 'netflix'
     or selected_account.account_type not in ('private', 'shared') then
    raise exception 'unsupported_account_type';
  end if;

  if lower(btrim(p_email)) <> lower(btrim(selected_account.email)) then
    raise exception 'account_email_mismatch';
  end if;

  -- Protect every existing account, including partially populated legacy rows.
  if exists (select 1 from public.customer_links where account_id = p_account_id) then
    raise exception 'links_already_exist';
  end if;

  if jsonb_typeof(p_links) <> 'array' then
    raise exception 'invalid_links_payload';
  end if;

  expected_count := case selected_account.account_type when 'private' then 5 else 8 end;
  if jsonb_array_length(p_links) <> expected_count then
    raise exception 'invalid_links_count: expected %, received %', expected_count, jsonb_array_length(p_links);
  end if;

  if exists (
    select 1
    from jsonb_array_elements(p_links) with ordinality as item(value, position)
    where nullif(btrim(item.value->>'uuid'), '') is null
       or nullif(btrim(item.value->>'short_id'), '') is null
       or nullif(btrim(item.value->>'profile_name'), '') is null
       or nullif(btrim(item.value->>'profile_label'), '') is null
       or nullif(btrim(item.value->>'profile_code'), '') is null
       or coalesce(item.value->>'service_type', 'netflix') <> 'netflix'
       or (selected_account.account_type = 'private' and item.value->>'profile_name' <>
          (array['A','B','C','D','E'])[item.position::integer])
       or (selected_account.account_type = 'private' and item.value->>'profile_label' <>
          (array['A','B','C','D','E'])[item.position::integer])
       or (selected_account.account_type = 'shared' and item.value->>'profile_name' <>
          (array['B1','B2','C1','C2','D1','D2','E1','E2'])[item.position::integer])
       or (selected_account.account_type = 'shared' and item.value->>'profile_label' <>
          (array['B','B','C','C','D','D','E','E'])[item.position::integer])
  ) then
    raise exception 'invalid_links_structure';
  end if;

  return query
  insert into public.customer_links as inserted_link (
    account_id,
    email,
    uuid,
    short_id,
    service_type,
    profile_name,
    profile_label,
    profile_code
  )
  select
    p_account_id,
    lower(btrim(p_email)),
    (item.value->>'uuid')::uuid,
    item.value->>'short_id',
    'netflix',
    item.value->>'profile_name',
    item.value->>'profile_label',
    item.value->>'profile_code'
  from jsonb_array_elements(p_links) with ordinality as item(value, position)
  order by item.position
  returning inserted_link.*;

  select count(*) into inserted_count
  from public.customer_links
  where account_id = p_account_id;

  if inserted_count <> expected_count then
    raise exception 'inserted_links_count_mismatch';
  end if;
end;
$$;

revoke all on function public.create_strict_customer_links(uuid, text, jsonb)
from public, anon, authenticated;

grant execute on function public.create_strict_customer_links(uuid, text, jsonb)
to service_role;

select pg_notify('pgrst', 'reload schema');

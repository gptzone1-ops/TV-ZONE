begin;

alter table public.customer_links
  add column if not exists is_active boolean not null default true;

alter table public.customer_links
  add column if not exists invalidated_at timestamptz;

alter table public.customer_links
  add column if not exists invalidation_reason text;

create index if not exists customer_links_account_active_idx
  on public.customer_links (account_id, is_active);

create or replace function public.protect_customer_link_lifecycle_state()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if current_user not in ('service_role', 'postgres') then
    raise exception 'customer_link_lifecycle_state_is_server_managed';
  end if;
  return new;
end;
$$;

drop trigger if exists protect_customer_link_lifecycle_state_trigger
  on public.customer_links;

create trigger protect_customer_link_lifecycle_state_trigger
before update of is_active, invalidated_at, invalidation_reason
on public.customer_links
for each row execute function public.protect_customer_link_lifecycle_state();

create or replace function public.renew_account_and_replace_customer_links(
  p_account_id uuid,
  p_email text,
  p_password text,
  p_supplier_code_url text,
  p_service_type text,
  p_account_type text,
  p_links jsonb
)
returns jsonb
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  selected_account public.accounts%rowtype;
  updated_account public.accounts%rowtype;
  normalized_email text := lower(btrim(coalesce(p_email, '')));
  remaining_days integer;
  days_passed integer;
  expected_count integer;
  inserted_count integer;
  created_links jsonb;
begin
  if normalized_email = '' then
    raise exception 'account_email_required';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(normalized_email, 0));

  select *
  into selected_account
  from public.accounts
  where id = p_account_id
  for update;

  if not found then
    raise exception 'account_not_found';
  end if;

  if lower(btrim(selected_account.email)) <> normalized_email then
    raise exception 'account_email_mismatch';
  end if;

  if coalesce(selected_account.service_type, 'netflix') <> p_service_type then
    raise exception 'account_service_mismatch';
  end if;

  if p_account_type not in ('private', 'shared') then
    raise exception 'unsupported_account_type';
  end if;

  remaining_days := ceil(
    extract(epoch from (selected_account.expires_at::timestamptz - now())) / 86400.0
  )::integer;
  days_passed := floor(
    extract(epoch from (now() - selected_account.created_at)) / 86400.0
  )::integer;

  if remaining_days > 5 and days_passed < 25 then
    raise exception 'active_duplicate:%', remaining_days;
  end if;

  if jsonb_typeof(p_links) <> 'array' then
    raise exception 'invalid_links_payload';
  end if;

  expected_count := case
    when p_service_type = 'shahid' and p_account_type = 'private' then 4
    when p_service_type = 'shahid' and p_account_type = 'shared' then 8
    when p_account_type = 'private' then 5
    else 10
  end;

  if jsonb_array_length(p_links) <> expected_count then
    raise exception 'invalid_links_count:expected_%,received_%', expected_count, jsonb_array_length(p_links);
  end if;

  update public.customer_links
  set
    is_active = false,
    invalidated_at = now(),
    invalidation_reason = 'account_renewed',
    updated_at = now()
  where account_id in (
    select id
    from public.accounts
    where lower(btrim(email)) = normalized_email
      and coalesce(service_type, 'netflix') = p_service_type
  )
    and is_active = true;

  update public.accounts
  set
    password = p_password,
    supplier_code_url = nullif(btrim(coalesce(p_supplier_code_url, '')), ''),
    code_fetch_method = case
      when p_service_type = 'netflix' and nullif(btrim(coalesce(p_supplier_code_url, '')), '') is not null
        then 'external_link'
      when p_service_type = 'netflix' then 'auto_fetch'
      else null
    end,
    use_automated_code = p_service_type = 'netflix'
      and nullif(btrim(coalesce(p_supplier_code_url, '')), '') is null,
    account_type = p_account_type,
    created_at = now(),
    expires_at = current_date + 30,
    normal_client_layout = true,
    hide_password_from_client = p_service_type = 'netflix',
    is_reported_closed = false,
    reported_closed_at = null
  where id = selected_account.id
  returning * into updated_account;

  insert into public.customer_links (
    account_id,
    email,
    uuid,
    short_id,
    service_type,
    profile_name,
    profile_label,
    profile_code,
    is_active
  )
  select
    selected_account.id,
    normalized_email,
    (item->>'uuid')::uuid,
    btrim(item->>'short_id'),
    p_service_type,
    btrim(item->>'profile_name'),
    btrim(item->>'profile_label'),
    coalesce(item->>'profile_code', ''),
    true
  from jsonb_array_elements(p_links) as item;

  get diagnostics inserted_count = row_count;
  if inserted_count <> expected_count then
    raise exception 'incomplete_link_batch:expected_%,inserted_%', expected_count, inserted_count;
  end if;

  select coalesce(jsonb_agg(to_jsonb(link_row) order by link_row.created_at, link_row.id), '[]'::jsonb)
  into created_links
  from public.customer_links as link_row
  where link_row.account_id = selected_account.id
    and link_row.is_active = true;

  return jsonb_build_object(
    'account', to_jsonb(updated_account),
    'links', created_links
  );
end;
$$;

revoke all on function public.renew_account_and_replace_customer_links(uuid, text, text, text, text, text, jsonb)
  from public, anon, authenticated;

grant execute on function public.renew_account_and_replace_customer_links(uuid, text, text, text, text, text, jsonb)
  to service_role;

select pg_notify('pgrst', 'reload schema');

commit;

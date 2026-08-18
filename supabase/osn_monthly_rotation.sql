-- OSN monthly rotation is opt-in. Existing accounts remain unchanged (NULL mode).
alter table public.accounts
  add column if not exists osn_subscription_mode text,
  add column if not exists osn_cycle_number integer,
  add column if not exists osn_cycle_started_at timestamptz,
  add column if not exists osn_cycle_ends_at timestamptz;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'accounts_osn_subscription_mode_check'
  ) then
    alter table public.accounts
      add constraint accounts_osn_subscription_mode_check
      check (osn_subscription_mode is null or osn_subscription_mode in ('telegram_keys', 'monthly_rotation'))
      not valid;
  end if;

  if not exists (
    select 1 from pg_constraint where conname = 'accounts_osn_cycle_number_check'
  ) then
    alter table public.accounts
      add constraint accounts_osn_cycle_number_check
      check (osn_cycle_number is null or osn_cycle_number between 1 and 3)
      not valid;
  end if;
end $$;

create or replace function public.rotate_osn_monthly_cycle(p_account_id uuid)
returns setof public.customer_links
language plpgsql
security definer
set search_path = public
as $$
declare
  selected_account record;
  next_cycle integer;
  profile_names text[];
  profile_labels text[];
  profile_codes text[];
  profile_index integer;
  generated_short_id text;
begin
  select
    id,
    email,
    account_type,
    service_type,
    osn_subscription_mode,
    osn_cycle_number,
    osn_cycle_ends_at,
    expires_at
  into selected_account
  from public.accounts
  where id = p_account_id
  for update;

  if not found then
    raise exception 'account_not_found';
  end if;

  if selected_account.service_type <> 'osn'
     or selected_account.osn_subscription_mode <> 'monthly_rotation' then
    raise exception 'not_osn_monthly_rotation';
  end if;

  if coalesce(selected_account.osn_cycle_number, 1) >= 3 then
    raise exception 'all_monthly_cycles_completed';
  end if;

  if selected_account.osn_cycle_ends_at is null or selected_account.osn_cycle_ends_at > now() then
    raise exception 'current_cycle_not_finished';
  end if;

  if selected_account.expires_at < current_date then
    raise exception 'account_expired';
  end if;

  if selected_account.account_type = 'private' then
    profile_names := array['A', 'B', 'C', 'D', 'E'];
    profile_labels := array['A', 'B', 'C', 'D', 'E'];
    profile_codes := array['3333', '3334', '9999', '1212', '9090'];
  elsif selected_account.account_type = 'shared' then
    profile_names := array['A1', 'A2', 'B1', 'B2', 'C1', 'C2', 'D1', 'D2', 'E1', 'E2'];
    profile_labels := array['A', 'A', 'B', 'B', 'C', 'C', 'D', 'D', 'E', 'E'];
    profile_codes := array['3333', '3333', '3334', '3334', '9999', '9999', '1212', '1212', '9090', '9090'];
  else
    raise exception 'unsupported_account_type';
  end if;

  -- This delete is explicit and scoped to the selected monthly account only.
  delete from public.customer_links where account_id = p_account_id;

  for profile_index in 1..array_length(profile_names, 1) loop
    loop
      generated_short_id := substring(replace(gen_random_uuid()::text, '-', '') from 1 for 6);
      exit when not exists (
        select 1 from public.customer_links where lower(short_id) = lower(generated_short_id)
      );
    end loop;

    insert into public.customer_links (
      account_id,
      email,
      service_type,
      profile_name,
      profile_label,
      profile_code,
      short_id
    ) values (
      p_account_id,
      selected_account.email,
      'osn',
      profile_names[profile_index],
      profile_labels[profile_index],
      profile_codes[profile_index],
      generated_short_id
    );
  end loop;

  next_cycle := coalesce(selected_account.osn_cycle_number, 1) + 1;

  update public.accounts
  set
    osn_cycle_number = next_cycle,
    osn_cycle_started_at = now(),
    osn_cycle_ends_at = least(now() + interval '30 days', selected_account.expires_at::timestamptz)
  where id = p_account_id;

  return query
  select links.*
  from public.customer_links as links
  where links.account_id = p_account_id
  order by links.profile_name;
end;
$$;

revoke all on function public.rotate_osn_monthly_cycle(uuid) from public, anon, authenticated;
grant execute on function public.rotate_osn_monthly_cycle(uuid) to service_role;

select pg_notify('pgrst', 'reload schema');

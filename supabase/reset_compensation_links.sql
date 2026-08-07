-- Manual-only reset for shared compensation accounts.
-- No existing row changes until an authenticated admin explicitly calls this function.

create extension if not exists pgcrypto;

create or replace function public.reset_shared_compensation_customer_links(p_account_id uuid)
returns setof public.customer_links
language plpgsql
security definer
set search_path = public
as $$
declare
  selected_account record;
  profile_letter text;
  slot_number integer;
  generated_short_id text;
  generated_count integer := 0;
begin
  select id, email, account_type, compensation_distribution
  into selected_account
  from public.accounts
  where id = p_account_id
  for update;

  if not found then
    raise exception 'account_not_found';
  end if;

  if selected_account.account_type <> 'compensation'
     or selected_account.compensation_distribution <> 'shared' then
    raise exception 'account_is_not_shared_compensation';
  end if;

  delete from public.customer_links
  where account_id = p_account_id;

  foreach profile_letter in array array['B', 'C', 'D', 'E']
  loop
    for slot_number in 1..2
    loop
      loop
        generated_short_id := substr(md5(gen_random_uuid()::text || clock_timestamp()::text), 1, 4);
        exit when not exists (
          select 1
          from public.customer_links
          where lower(short_id) = lower(generated_short_id)
        );
      end loop;

      return query
      insert into public.customer_links as inserted_link (
        account_id,
        email,
        uuid,
        short_id,
        profile_name,
        profile_label,
        profile_code,
        service_type
      ) values (
        p_account_id,
        selected_account.email,
        gen_random_uuid(),
        generated_short_id,
        profile_letter || slot_number::text,
        profile_letter,
        case profile_letter
          when 'B' then '9000'
          when 'C' then '1234'
          when 'D' then '6666'
          when 'E' then '5556'
        end,
        'netflix'
      )
      returning inserted_link.*;

      generated_count := generated_count + 1;
    end loop;
  end loop;

  if generated_count <> 8 then
    raise exception 'shared_compensation_link_count_mismatch';
  end if;
end;
$$;

revoke all on function public.reset_shared_compensation_customer_links(uuid)
from public, anon, authenticated;

grant execute on function public.reset_shared_compensation_customer_links(uuid)
to service_role;

select pg_notify('pgrst', 'reload schema');

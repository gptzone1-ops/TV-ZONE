create or replace function public.set_default_profile_pin_on_insert()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  profile_key text;
begin
  -- Shahid profiles do not use a PIN, and explicit values are never overwritten.
  if coalesce(new.service_type, 'netflix') <> 'netflix'
    or nullif(btrim(new.profile_code), '') is not null then
    return new;
  end if;

  profile_key := upper(
    substring(coalesce(new.profile_label, new.profile_name, '') from '[A-Ea-e]')
  );

  new.profile_code := case profile_key
    when 'A' then '8888'
    when 'B' then '9000'
    when 'C' then '1234'
    when 'D' then '6666'
    when 'E' then '5556'
    else new.profile_code
  end;

  return new;
end;
$$;

drop trigger if exists set_default_profile_pin_before_insert
  on public.customer_links;

create trigger set_default_profile_pin_before_insert
before insert on public.customer_links
for each row
execute function public.set_default_profile_pin_on_insert();

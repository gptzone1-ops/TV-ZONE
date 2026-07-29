-- Restore missing customer links for shared accounts without touching existing rows.
-- Netflix shared accounts have two customer links for each profile (A1..E2).
-- Shahid shared accounts have two customer links for each profile (A1..D2).
--
-- This script is idempotent: running it again will not create duplicate profiles.
-- Existing ids, UUIDs, short ids, balances, device choices, and customer URLs remain unchanged.

begin;

create extension if not exists "pgcrypto";

-- customer_links must allow several rows with the same account email.
alter table if exists public.customer_links
  drop constraint if exists unique_customer_email;

alter table if exists public.customer_links
  drop constraint if exists customer_links_email_key;

drop index if exists public.unique_customer_email;
drop index if exists public.customer_links_email_key;
drop index if exists public.customer_links_email_unique;

with expected_profiles as (
  select
    account.id as account_id,
    lower(btrim(account.email)) as email,
    coalesce(account.service_type, 'netflix') as service_type,
    profile.profile_name,
    left(profile.profile_name, 1) as profile_label,
    case left(profile.profile_name, 1)
      when 'A' then '8279'
      when 'B' then '3971'
      when 'C' then '9213'
      when 'D' then '9158'
      when 'E' then '0914'
    end as profile_code
  from public.accounts as account
  cross join lateral (
    select profile_letter || copy_number::text as profile_name
    from unnest(
      case
        when coalesce(account.service_type, 'netflix') = 'shahid'
          then array['A', 'B', 'C', 'D']::text[]
        else array['A', 'B', 'C', 'D', 'E']::text[]
      end
    ) as letters(profile_letter)
    cross join generate_series(1, 2) as copy_number
  ) as profile
  where account.account_type = 'shared'
),
missing_profiles as (
  select expected.*
  from expected_profiles as expected
  where not exists (
    select 1
    from public.customer_links as existing
    where existing.account_id = expected.account_id
      and upper(btrim(existing.profile_name)) = expected.profile_name
  )
)
insert into public.customer_links (
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
  missing.account_id,
  missing.email,
  gen_random_uuid(),
  encode(gen_random_bytes(2), 'hex'),
  missing.service_type,
  missing.profile_name,
  missing.profile_label,
  case when missing.service_type = 'shahid' then '' else missing.profile_code end
from missing_profiles as missing;

commit;

-- Verification report: every Netflix shared account should show 10 rows,
-- and every Shahid shared account should show 8 rows.
select
  account.id as account_id,
  account.email,
  coalesce(account.service_type, 'netflix') as service_type,
  count(link.id) as current_links,
  case
    when coalesce(account.service_type, 'netflix') = 'shahid' then 8
    else 10
  end as expected_links,
  array_agg(link.profile_name order by link.profile_name)
    filter (where link.id is not null) as profiles
from public.accounts as account
left join public.customer_links as link
  on link.account_id = account.id
where account.account_type = 'shared'
group by account.id, account.email, account.service_type
order by account.email;

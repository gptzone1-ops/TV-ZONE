-- OSN automatic OTP is opt-in for newly-created accounts only.
-- Existing OSN accounts and customer links are not updated by this migration.

alter table public.accounts
  add column if not exists osn_subscription_mode text;

alter table public.accounts
  drop constraint if exists accounts_osn_subscription_mode_check;

alter table public.accounts
  add constraint accounts_osn_subscription_mode_check
  check (
    osn_subscription_mode is null
    or osn_subscription_mode in ('telegram_keys', 'monthly_rotation')
  ) not valid;

create table if not exists public.osn_codes (
  email text primary key,
  code text not null check (code ~ '^\d{4}$'),
  updated_at timestamptz not null default now()
);

create unique index if not exists osn_codes_email_lower_unique
  on public.osn_codes (lower(btrim(email)));

create index if not exists osn_codes_updated_at_idx
  on public.osn_codes (updated_at desc);

create or replace function public.normalize_osn_code_email()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.email := lower(btrim(new.email));
  new.code := regexp_replace(new.code, '\s+', '', 'g');
  return new;
end;
$$;

drop trigger if exists normalize_osn_code_email_before_write on public.osn_codes;
create trigger normalize_osn_code_email_before_write
before insert or update on public.osn_codes
for each row execute function public.normalize_osn_code_email();

alter table public.osn_codes enable row level security;
revoke all on table public.osn_codes from anon, authenticated;
grant all on table public.osn_codes to service_role;

select pg_notify('pgrst', 'reload schema');

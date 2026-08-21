-- Blocks duplicate emails for future account inserts only.
-- Existing accounts, duplicates, and customer links are intentionally untouched.

create or replace function public.prevent_new_duplicate_account_email()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  normalized_email text;
begin
  normalized_email := lower(btrim(new.email));

  if normalized_email is null or normalized_email = '' then
    raise exception using
      errcode = '23514',
      message = 'account_email_required';
  end if;

  -- Serialize concurrent inserts for the same normalized email. This gives the
  -- insert-only trigger unique-constraint behavior without rebuilding old data.
  perform pg_advisory_xact_lock(hashtextextended(normalized_email, 0));

  if exists (
    select 1
    from public.accounts as existing_account
    where lower(btrim(existing_account.email)) = normalized_email
  ) then
    raise exception using
      errcode = '23505',
      message = 'duplicate_account_email';
  end if;

  new.email := normalized_email;
  return new;
end;
$$;

drop trigger if exists prevent_new_duplicate_account_email_before_insert
on public.accounts;

create trigger prevent_new_duplicate_account_email_before_insert
before insert on public.accounts
for each row
execute function public.prevent_new_duplicate_account_email();

select pg_notify('pgrst', 'reload schema');

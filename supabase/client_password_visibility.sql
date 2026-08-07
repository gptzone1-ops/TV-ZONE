-- Existing accounts keep false and preserve their current client-page behavior.
-- The application explicitly sets true only for newly created private/shared Netflix accounts.
alter table public.accounts
  add column if not exists hide_password_from_client boolean not null default false;

select pg_notify('pgrst', 'reload schema');

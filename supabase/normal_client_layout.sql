-- Run once in Supabase SQL Editor.
-- Existing accounts remain on their current layout (false).
-- The application sets this flag to true only for newly created private/shared accounts.
alter table public.accounts
  add column if not exists normal_client_layout boolean not null default false;

-- Accounts created through the new Outlook flow before this migration
-- are also normal subscriptions. Legacy accounts remain unchanged.
update public.accounts
set normal_client_layout = true
where imap_enabled = true
  and account_type in ('private', 'shared');

select pg_notify('pgrst', 'reload schema');

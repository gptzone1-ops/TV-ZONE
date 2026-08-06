-- Run once in Supabase SQL Editor.
-- Existing accounts remain on their current layout (false).
-- The application sets this flag to true only for newly created private/shared accounts.
alter table public.accounts
  add column if not exists normal_client_layout boolean not null default false;

select pg_notify('pgrst', 'reload schema');

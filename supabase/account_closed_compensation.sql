-- Adds an account-level compensation notice without changing customer links.
alter table public.accounts
  add column if not exists is_reported_closed boolean not null default false,
  add column if not exists reported_closed_at timestamptz;

comment on column public.accounts.is_reported_closed is
  'When true, every existing customer link for this account shows the compensation view.';

select pg_notify('pgrst', 'reload schema');

begin;

alter table public.customer_links
  add column if not exists tv_approval_url text;

alter table public.customer_links
  add column if not exists updated_at timestamptz not null default now();

grant select, update on public.customer_links to anon, authenticated;

commit;

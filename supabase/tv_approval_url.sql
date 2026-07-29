begin;

alter table public.customer_links
  add column if not exists tv_approval_url text;

grant select, update on public.customer_links to anon, authenticated;

commit;

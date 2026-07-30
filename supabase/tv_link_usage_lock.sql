begin;

alter table public.customer_links
  add column if not exists has_used_tv_link boolean not null default false;

alter table public.customer_links
  add column if not exists tv_link_used_at timestamptz;

update public.customer_links
set has_used_tv_link = false
where has_used_tv_link is null;

commit;

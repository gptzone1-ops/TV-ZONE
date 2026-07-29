begin;

alter table public.customer_links
  add column if not exists tv_approval_url text;

alter table public.customer_links
  add column if not exists tv_approval_requested_at timestamptz;

alter table public.customer_links
  add column if not exists email text;

update public.customer_links as links
set email = accounts.email
from public.accounts as accounts
where accounts.id = links.account_id
  and (links.email is null or btrim(links.email) = '');

alter table public.customer_links
  add column if not exists updated_at timestamptz not null default now();

grant select, update on public.customer_links to anon, authenticated;

commit;

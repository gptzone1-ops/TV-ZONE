begin;

create sequence if not exists public.customer_links_link_number_seq start with 100;

alter table public.customer_links
  add column if not exists link_number bigint;

alter table public.customer_links
  alter column link_number set default nextval('public.customer_links_link_number_seq');

update public.customer_links
set link_number = nextval('public.customer_links_link_number_seq')
where link_number is null;

alter table public.customer_links
  alter column link_number set not null;

alter table public.customer_links
  add column if not exists code_request_limit integer not null default 1;

alter table public.customer_links
  add column if not exists code_requested_count integer not null default 0;

alter table public.customer_links
  add column if not exists selected_device text;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'customer_links_selected_device_check'
      and conrelid = 'public.customer_links'::regclass
  ) then
    alter table public.customer_links
      add constraint customer_links_selected_device_check
      check (selected_device in ('mobile', 'screen') or selected_device is null);
  end if;
end
$$;

alter table public.customer_links
  add column if not exists verification_code text;

alter table public.customer_links
  add column if not exists verification_code_received_at timestamptz;

alter table public.customer_links
  add column if not exists tv_approval_url text;

alter table public.customer_links
  add column if not exists updated_at timestamptz not null default now();

create unique index if not exists customer_links_link_number_key
  on public.customer_links(link_number);

alter table public.customer_links enable row level security;

drop policy if exists "Allow anon customer link updates" on public.customer_links;

create policy "Allow anon customer link updates"
  on public.customer_links
  for update
  to anon
  using (true)
  with check (true);

grant select, insert, update, delete on public.customer_links to anon, authenticated;
grant usage, select on sequence public.customer_links_link_number_seq to anon, authenticated;

commit;

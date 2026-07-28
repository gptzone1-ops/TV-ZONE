begin;

alter table public.customer_links
  add column if not exists selected_device text;

alter table public.customer_links
  add column if not exists code_request_limit integer not null default 1;

alter table public.customer_links
  add column if not exists code_requested_count integer not null default 0;

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

alter table public.customer_links enable row level security;

drop policy if exists "Allow anon customer link updates" on public.customer_links;

create policy "Allow anon customer link updates"
  on public.customer_links
  for update
  to anon
  using (true)
  with check (true);

grant select, update on public.customer_links to anon, authenticated;

commit;

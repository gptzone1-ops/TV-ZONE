create extension if not exists "pgcrypto";

create table if not exists public.extra_credit_requests (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references public.customer_links(id) on delete cascade,
  reason_type text not null check (
    reason_type in ('كود خاطئ', 'إضافة جهاز جديد', 'عدم تطبيق الخطوات وذهاب الكود', 'أخرى')
  ),
  description text not null check (char_length(btrim(description)) >= 10),
  image_url text not null check (btrim(image_url) <> ''),
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  created_at timestamptz not null default now(),
  reviewed_at timestamptz
);

create unique index if not exists extra_credit_requests_one_pending_per_customer
  on public.extra_credit_requests(customer_id)
  where status = 'pending';

create index if not exists extra_credit_requests_status_created_idx
  on public.extra_credit_requests(status, created_at desc);

alter table public.extra_credit_requests enable row level security;

drop policy if exists "Allow customer credit request reads" on public.extra_credit_requests;
drop policy if exists "Allow customer credit request inserts" on public.extra_credit_requests;

create policy "Allow customer credit request reads"
  on public.extra_credit_requests for select
  to anon, authenticated
  using (true);

create policy "Allow customer credit request inserts"
  on public.extra_credit_requests for insert
  to anon, authenticated
  with check (
    status = 'pending'
    and char_length(btrim(description)) >= 10
    and btrim(image_url) <> ''
  );

grant select, insert on public.extra_credit_requests to anon, authenticated;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'screenshots',
  'screenshots',
  true,
  5242880,
  array['image/jpeg', 'image/png', 'image/webp']
)
on conflict (id) do nothing;

drop policy if exists "Allow credit screenshot uploads" on storage.objects;
drop policy if exists "Allow credit screenshot reads" on storage.objects;

create policy "Allow credit screenshot uploads"
  on storage.objects for insert
  to anon, authenticated
  with check (bucket_id = 'screenshots');

create policy "Allow credit screenshot reads"
  on storage.objects for select
  to anon, authenticated
  using (bucket_id = 'screenshots');

create or replace function public.review_extra_credit_request(
  p_request_id uuid,
  p_status text
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  selected_request public.extra_credit_requests%rowtype;
begin
  if p_status not in ('approved', 'rejected') then
    raise exception 'invalid_request_status';
  end if;

  select requests.*
  into selected_request
  from public.extra_credit_requests as requests
  where requests.id = p_request_id
    and requests.status = 'pending'
  for update;

  if not found then
    return false;
  end if;

  if p_status = 'approved' then
    update public.customer_links as links
    set code_request_limit = greatest(
          coalesce(links.code_request_limit, 1),
          coalesce(links.code_requested_count, 0)
        ) + 1,
        has_used_tv_link = false,
        tv_link_used_at = null,
        code_used_at = null,
        updated_at = now()
    where links.id = selected_request.customer_id;
  end if;

  update public.extra_credit_requests as requests
  set status = p_status,
      reviewed_at = now()
  where requests.id = selected_request.id;

  return true;
end;
$$;

revoke all on function public.review_extra_credit_request(uuid, text) from public;
grant execute on function public.review_extra_credit_request(uuid, text) to service_role;

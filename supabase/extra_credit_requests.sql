create extension if not exists "pgcrypto";

create table if not exists public.extra_credit_requests (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references public.customer_links(id) on delete cascade,
  reason_type text not null check (
    reason_type in ('كود خاطئ', 'استبدال الجهاز أو الدخول بجهاز آخر', 'عدم تطبيق الخطوات وذهاب الكود', 'أخرى')
  ),
  description text not null check (char_length(btrim(description)) >= 10),
  image_url text,
  attachment_type text not null default 'image' check (attachment_type in ('image', 'video')),
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  ai_decision text check (
    ai_decision is null or ai_decision in ('processing', 'auto_approved', 'auto_rejected', 'manual_review')
  ),
  ai_confidence double precision check (
    ai_confidence is null or (ai_confidence >= 0 and ai_confidence <= 1)
  ),
  ai_analysis text,
  ai_model text,
  ai_reviewed_at timestamptz,
  review_reason text,
  created_at timestamptz not null default now(),
  reviewed_at timestamptz
);

alter table public.extra_credit_requests
  add column if not exists attachment_type text not null default 'image';

alter table public.extra_credit_requests
  add column if not exists ai_decision text,
  add column if not exists ai_confidence double precision,
  add column if not exists ai_analysis text,
  add column if not exists ai_model text,
  add column if not exists ai_reviewed_at timestamptz,
  add column if not exists review_reason text;

alter table public.extra_credit_requests
  drop constraint if exists extra_credit_requests_ai_decision_check;

alter table public.extra_credit_requests
  add constraint extra_credit_requests_ai_decision_check check (
    ai_decision is null or ai_decision in (
      'processing', 'auto_approved', 'auto_rejected', 'manual_review'
    )
  );

alter table public.extra_credit_requests
  drop constraint if exists extra_credit_requests_ai_confidence_check;

alter table public.extra_credit_requests
  add constraint extra_credit_requests_ai_confidence_check check (
    ai_confidence is null or (ai_confidence >= 0 and ai_confidence <= 1)
  );

alter table public.extra_credit_requests
  alter column image_url drop not null;

alter table public.extra_credit_requests
  drop constraint if exists extra_credit_requests_image_url_check;

alter table public.extra_credit_requests
  add constraint extra_credit_requests_image_url_check check (
    status <> 'pending' or (image_url is not null and btrim(image_url) <> '')
  );

alter table public.extra_credit_requests
  drop constraint if exists extra_credit_requests_reason_type_check;

update public.extra_credit_requests
set reason_type = 'استبدال الجهاز أو الدخول بجهاز آخر'
where reason_type = 'إضافة جهاز جديد';

alter table public.extra_credit_requests
  add constraint extra_credit_requests_reason_type_check check (
    reason_type in ('كود خاطئ', 'استبدال الجهاز أو الدخول بجهاز آخر', 'عدم تطبيق الخطوات وذهاب الكود', 'أخرى')
  );

alter table public.extra_credit_requests
  drop constraint if exists extra_credit_requests_attachment_type_check;

alter table public.extra_credit_requests
  add constraint extra_credit_requests_attachment_type_check check (
    attachment_type in ('image', 'video')
  );

create unique index if not exists extra_credit_requests_one_pending_per_customer
  on public.extra_credit_requests(customer_id)
  where status = 'pending';

create index if not exists extra_credit_requests_status_created_idx
  on public.extra_credit_requests(status, created_at desc);

create index if not exists extra_credit_requests_ai_decision_idx
  on public.extra_credit_requests(ai_decision, created_at desc);

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
    and attachment_type in ('image', 'video')
  );

grant select, insert on public.extra_credit_requests to anon, authenticated;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'extra_credit_requests',
  'extra_credit_requests',
  true,
  null,
  array[
    'image/jpeg',
    'image/png',
    'image/webp',
    'image/gif',
    'image/heic',
    'image/heif',
    'video/mp4',
    'video/webm',
    'video/quicktime',
    'video/x-m4v',
    'video/ogg',
    'video/mpeg',
    'video/3gpp',
    'video/3gpp2'
  ]
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "Allow extra credit attachment uploads" on storage.objects;
drop policy if exists "Allow extra credit attachment reads" on storage.objects;

create policy "Allow extra credit attachment uploads"
  on storage.objects for insert
  to anon, authenticated
  with check (bucket_id = 'extra_credit_requests');

create policy "Allow extra credit attachment reads"
  on storage.objects for select
  to anon, authenticated
  using (bucket_id = 'extra_credit_requests');

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
      reviewed_at = now(),
      image_url = null
  where requests.id = selected_request.id;

  return true;
end;
$$;

revoke all on function public.review_extra_credit_request(uuid, text) from public;
grant execute on function public.review_extra_credit_request(uuid, text) to service_role;

create extension if not exists "pgcrypto";

create table if not exists public.verification_messages (
  id uuid primary key default gen_random_uuid(),
  email text not null,
  message_type text not null check (message_type in ('code', 'tv_approval_url')),
  code text,
  tv_approval_url text,
  received_at timestamptz not null default now(),
  is_used boolean not null default false,
  used_by_customer_link_id uuid references public.customer_links(id) on delete set null,
  used_at timestamptz,
  created_at timestamptz not null default now(),
  constraint verification_messages_payload_check check (
    (message_type = 'code' and code is not null and tv_approval_url is null)
    or
    (message_type = 'tv_approval_url' and tv_approval_url is not null and code is null)
  )
);

create index if not exists verification_messages_lookup_idx
  on public.verification_messages (lower(email), message_type, is_used, received_at desc);

alter table public.verification_messages enable row level security;

revoke all on public.verification_messages from anon, authenticated;

drop function if exists public.get_latest_customer_message(uuid, text, boolean, timestamptz);

create or replace function public.get_latest_customer_message(
  p_customer_link_id uuid,
  p_message_type text,
  p_since timestamptz default null
)
returns table (
  id uuid,
  code text,
  tv_approval_url text,
  received_at timestamptz,
  is_used boolean
)
language sql
stable
security definer
set search_path = public
as $$
  select
    messages.id,
    messages.code,
    messages.tv_approval_url,
    messages.received_at,
    messages.is_used
  from public.verification_messages as messages
  join public.customer_links as links
    on links.id = p_customer_link_id
  left join public.accounts as accounts
    on accounts.id = links.account_id
  where lower(btrim(messages.email)) = lower(
    coalesce(nullif(btrim(links.email), ''), btrim(accounts.email))
  )
    and messages.message_type = p_message_type
    and messages.is_used = false
    and (p_since is null or messages.received_at >= p_since)
  order by messages.received_at desc, messages.created_at desc
  limit 1;
$$;

create or replace function public.consume_customer_message(
  p_message_id uuid,
  p_customer_link_id uuid,
  p_used_at timestamptz default now()
)
returns table (
  message_id uuid,
  code text,
  tv_approval_url text,
  received_at timestamptz,
  message_type text
)
language plpgsql
security definer
set search_path = public
as $$
declare
  selected_message public.verification_messages%rowtype;
  customer_email text;
  requested_count integer;
  request_limit integer;
  used_tv_link boolean;
begin
  select messages.*
    into selected_message
  from public.verification_messages as messages
  where messages.id = p_message_id
    and messages.is_used = false
  for update;

  if not found then
    return;
  end if;

  select
    lower(coalesce(nullif(btrim(links.email), ''), btrim(accounts.email))),
    coalesce(links.code_requested_count, 0),
    coalesce(links.code_request_limit, 1),
    coalesce(links.has_used_tv_link, false)
  into customer_email, requested_count, request_limit, used_tv_link
  from public.customer_links as links
  join public.accounts as accounts
    on accounts.id = links.account_id
  where links.id = p_customer_link_id
  for update of links;

  if not found or customer_email is null
    or lower(btrim(selected_message.email)) <> customer_email then
    return;
  end if;

  if selected_message.message_type = 'code' then
    if requested_count >= request_limit then
      return;
    end if;

    update public.customer_links as target
    set code_requested_count = request_limit,
        code_used_at = p_used_at,
        verification_code = selected_message.code,
        verification_code_received_at = selected_message.received_at
    where target.id = p_customer_link_id;
  elsif selected_message.message_type = 'tv_approval_url' then
    if used_tv_link then
      return;
    end if;

    update public.customer_links as target
    set has_used_tv_link = true,
        tv_link_used_at = p_used_at,
        tv_approval_url = selected_message.tv_approval_url,
        updated_at = selected_message.received_at
    where target.id = p_customer_link_id;
  else
    return;
  end if;

  update public.verification_messages as target
  set is_used = true,
      used_by_customer_link_id = p_customer_link_id,
      used_at = p_used_at
  where target.id = selected_message.id
    and target.is_used = false;

  if not found then
    return;
  end if;

  return query
  select
    selected_message.id,
    selected_message.code,
    selected_message.tv_approval_url,
    selected_message.received_at,
    selected_message.message_type;
end;
$$;

revoke all on function public.get_latest_customer_message(uuid, text, timestamptz)
  from public;
revoke all on function public.consume_customer_message(uuid, uuid, timestamptz)
  from public;

grant execute on function public.get_latest_customer_message(uuid, text, timestamptz)
  to anon, authenticated;
grant execute on function public.consume_customer_message(uuid, uuid, timestamptz)
  to anon, authenticated;

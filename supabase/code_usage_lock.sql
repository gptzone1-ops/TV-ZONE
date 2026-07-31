begin;

alter table public.customer_links
  add column if not exists code_used_at timestamptz;

commit;

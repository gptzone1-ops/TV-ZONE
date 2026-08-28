-- Read-only performance indexes for the admin dashboard.
-- This migration does not update or delete any account or customer-link data.

create extension if not exists pg_trgm;

create index if not exists idx_accounts_created_at_desc
  on public.accounts (created_at desc);

create index if not exists idx_accounts_email_lower
  on public.accounts (lower(email));

create index if not exists idx_accounts_email_search_trgm
  on public.accounts using gin (email gin_trgm_ops);

create index if not exists idx_accounts_service_created_at
  on public.accounts (service_type, created_at desc);

create index if not exists idx_accounts_service_type_created_at
  on public.accounts (service_type, account_type, created_at desc);

create index if not exists idx_customer_links_account_id
  on public.customer_links (account_id);

create index if not exists idx_customer_links_link_number
  on public.customer_links (link_number);

create index if not exists idx_customer_links_short_id_search
  on public.customer_links (short_id);

create index if not exists idx_customer_links_short_id_search_trgm
  on public.customer_links using gin (short_id gin_trgm_ops);

create index if not exists idx_extra_credit_requests_status_created_at
  on public.extra_credit_requests (status, created_at desc);

analyze public.accounts;
analyze public.customer_links;
analyze public.extra_credit_requests;

select pg_notify('pgrst', 'reload schema');

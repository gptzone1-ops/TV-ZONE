begin;

-- customer_links stores multiple customer links for the same account, so email
-- cannot be unique here. Duplicate account emails are blocked in the app before
-- insert, while links for the same account must be allowed to share the email.
alter table if exists public.customer_links
  drop constraint if exists unique_customer_email;

alter table if exists public.customer_links
  drop constraint if exists customer_links_email_key;

drop index if exists public.unique_customer_email;
drop index if exists public.customer_links_email_key;
drop index if exists public.customer_links_email_unique;

create index if not exists customer_links_email_idx
  on public.customer_links(lower(email))
  where email is not null and btrim(email) <> '';

commit;

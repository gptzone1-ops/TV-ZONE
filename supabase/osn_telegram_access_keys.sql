-- OSN only: existing links remain unchanged because activation_key defaults to NULL.
alter table public.customer_links
  add column if not exists activation_key text;

create unique index if not exists customer_links_osn_activation_key_unique
  on public.customer_links (lower(activation_key))
  where service_type = 'osn' and nullif(btrim(activation_key), '') is not null;

select pg_notify('pgrst', 'reload schema');

-- Spusť v Supabase: Dashboard → SQL Editor → New query → vlož a Run
-- Databáze klientů (odběratelů) — jednou zadaný klient se pak jen vybírá
-- v faktury.html a generator-dokumentu.html, místo aby se psal pokaždé
-- ručně znovu. Stejný vzor jako ledger_entries/invoices (16_schema_ledger.sql).

create table if not exists clients (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  ico text,
  dic text,
  address text,
  email text,
  phone text,
  note text,
  created_at timestamptz default now()
);

alter table clients enable row level security;

create policy "Users select own clients" on clients
  for select using (auth.uid() = user_id);
create policy "Users insert own clients" on clients
  for insert with check (auth.uid() = user_id);
create policy "Users update own clients" on clients
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "Users delete own clients" on clients
  for delete using (auth.uid() = user_id);

create index if not exists clients_user_id_name_idx on clients (user_id, name);

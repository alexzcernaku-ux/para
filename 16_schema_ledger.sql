-- Spusť v Supabase: Dashboard → SQL Editor → New query → vlož a Run
-- Evidence příjmů a výdajů + Sledování faktur + Kniha jízd — tři nové
-- tabulky, které spolu drží pohromadě (faktura může mít navazující řádek
-- v evidenci, evidence i kniha jízd slouží jako podklad pro export balíčku
-- pro účetního a pro hlídání obratu DPH).

-- 1) Sledování faktur (vystavené i přijaté) — musí vzniknout PŘED
--    ledger_entries, protože na ni ledger_entries odkazuje cizím klíčem.
create table if not exists invoices (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  direction text not null check (direction in ('vystavena', 'prijata')),
  number text,
  counterparty_name text,
  counterparty_ico text,
  issue_date date not null,
  due_date date,
  amount numeric(12,2) not null check (amount >= 0),
  vat_amount numeric(12,2) not null default 0 check (vat_amount >= 0),
  paid boolean not null default false,
  paid_date date,
  note text,
  created_at timestamptz default now()
);

alter table invoices enable row level security;
create policy "Users select own invoices" on invoices for select using (auth.uid() = user_id);
create policy "Users insert own invoices" on invoices for insert with check (auth.uid() = user_id);
create policy "Users update own invoices" on invoices for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "Users delete own invoices" on invoices for delete using (auth.uid() = user_id);

create index if not exists invoices_user_id_issue_date_idx on invoices (user_id, issue_date desc);

-- 2) Evidence příjmů a výdajů — základní kniha, ze které čerpají kalkulačky
--    (v budoucnu), hlídání obratu DPH a export balíčku pro účetního.
--    invoice_id je nepovinný odkaz na fakturu, ze které řádek vznikl.
create table if not exists ledger_entries (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  entry_date date not null,
  type text not null check (type in ('prijem', 'vydaj')),
  amount numeric(12,2) not null check (amount >= 0),
  category text,
  description text,
  invoice_id bigint references invoices(id) on delete set null,
  created_at timestamptz default now()
);

alter table ledger_entries enable row level security;
create policy "Users select own ledger entries" on ledger_entries for select using (auth.uid() = user_id);
create policy "Users insert own ledger entries" on ledger_entries for insert with check (auth.uid() = user_id);
create policy "Users update own ledger entries" on ledger_entries for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "Users delete own ledger entries" on ledger_entries for delete using (auth.uid() = user_id);

create index if not exists ledger_entries_user_id_date_idx on ledger_entries (user_id, entry_date desc);

-- 3) Kniha jízd — § 24 odst. 2 písm. k) bod 1 zákona 586/1992 Sb.: při
--    skutečných výdajích lze uplatnit náhradu výdajů za pohonné hmoty a
--    základní náhradu (na rozdíl od paušálu na dopravu, který žádnou
--    evidenci jízd nevyžaduje — proto tahle tabulka slouží jen té první
--    variantě).
create table if not exists vehicle_trips (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  trip_date date not null,
  purpose text not null,
  route text,
  distance_km numeric(8,1) not null check (distance_km >= 0),
  consumption_l_100km numeric(5,2),
  fuel_type text check (fuel_type in ('benzin95', 'benzin98', 'nafta', 'elektrina', 'vlastni_cena')),
  fuel_price_override numeric(8,2),
  created_at timestamptz default now()
);

alter table vehicle_trips enable row level security;
create policy "Users select own trips" on vehicle_trips for select using (auth.uid() = user_id);
create policy "Users insert own trips" on vehicle_trips for insert with check (auth.uid() = user_id);
create policy "Users update own trips" on vehicle_trips for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "Users delete own trips" on vehicle_trips for delete using (auth.uid() = user_id);

create index if not exists vehicle_trips_user_id_date_idx on vehicle_trips (user_id, trip_date desc);

-- Spusť v Supabase: Dashboard → SQL Editor → New query → vlož a Run
-- Zachytává e-maily zájemců o registraci z landing page (waitlist modal),
-- dokud není hotová Fáze 2 (Supabase Auth). Insert probíhá přímo z klienta
-- přes anon klíč - proto jen INSERT policy, žádné veřejné čtení.

create table if not exists waitlist (
  id bigint generated always as identity primary key,
  email text not null unique,
  source text,                 -- např. 'landing_page'
  created_at timestamptz default now()
);

alter table waitlist enable row level security;

create policy "Public insert access" on waitlist
  for insert with check (true);

-- Spusť v Supabase: Dashboard → SQL Editor → New query → vlož a Run
-- Přidává tabulku pro palec nahoru/dolů u odpovědí — časem ukáže, na co
-- systém spolehlivě neodpovídá (hodně 👎 nebo "nelze určit" u konkrétního
-- tématu = signál, že tam chybí zdrojový dokument).

create table if not exists feedback (
  id bigint generated always as identity primary key,
  question text not null,
  answer text not null,
  rating text not null check (rating in ('up', 'down')),
  sources jsonb,
  created_at timestamptz default now()
);

alter table feedback enable row level security;

-- Kdokoliv s anon/service klíčem může zapsat feedback (žádné čtení zvenku).
create policy "Public insert access" on feedback
  for insert with check (true);

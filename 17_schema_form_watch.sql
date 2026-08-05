-- Spusť v Supabase: Dashboard → SQL Editor → New query → vlož a Run
-- Hlídání aktuálnosti tiskopisů (PDF šablony pro DAP/DPH/Přehled OSVČ) a
-- primárních zdrojů čísel (sazby, limity, pásma), na kterých stojí
-- kalkulačky a generátory. Stejný princip jako check-law-updates pro text
-- zákonů (11_schema_law_updates.sql): NIC se nemění samo - jen se pošle
-- e-mail k ručnímu ověření/přemapování, dokud se to sám nepotvrdí.

create table if not exists form_watch_sources (
  id bigint generated always as identity primary key,
  key text unique not null,
  label text not null,
  url text not null,
  kind text not null check (kind in ('pdf', 'html')),
  -- Kterých souborů v appce se zdroj týká - jen do e-mailu, ať je hned
  -- jasné, co jít přemapovat/přepsat.
  affects text,
  last_known_hash text,
  last_checked_at timestamptz,
  created_at timestamptz default now()
);

alter table form_watch_sources enable row level security;
-- Čte/píše jen service role (edge functions) - žádný klientský přístup.
create policy "Service role only" on form_watch_sources for all using (false);

create table if not exists form_watch_events (
  id bigint generated always as identity primary key,
  source_key text not null,
  label text not null,
  url text not null,
  event_type text not null check (event_type in ('changed', 'unreachable')),
  old_hash text,
  new_hash text,
  status text not null default 'pending_review' check (status in ('pending_review', 'resolved')),
  review_token uuid not null default gen_random_uuid(),
  detected_at timestamptz default now(),
  resolved_at timestamptz
);

alter table form_watch_events enable row level security;
create policy "Service role only" on form_watch_events for all using (false);

create index if not exists form_watch_events_status_idx on form_watch_events (status);

-- Počáteční sledované zdroje. last_known_hash zůstává NULL - první běh
-- check-form-updates si hash sám doplní jako výchozí stav (bez alertu),
-- teprve DALŠÍ běh porovnává.
insert into form_watch_sources (key, label, url, kind, affects) values
  ('dap-5405', 'DAP hlavní tiskopis 25 5405', 'https://financnisprava.gov.cz/assets/tiskopisy/5405_30.pdf', 'pdf', 'dap-pdf-fill.js, dap-check.js, web/assets/img/dap/*'),
  ('dap-5405-p1', 'DAP příloha č. 1 (25 5405/P1)', 'https://financnisprava.gov.cz/assets/tiskopisy/5405-P1_22.pdf', 'pdf', 'dap-pdf-fill.js, dap-check.js, web/assets/img/dap/*'),
  ('dph-5401', 'DPH přiznání 25 5401', 'https://financnisprava.gov.cz/assets/tiskopisy/5401_26.pdf', 'pdf', 'dph-pdf-fill.js, dph-check.js, web/assets/img/dph/*'),
  ('prehled-osvc-cssz', 'ČSSZ Přehled o příjmech a výdajích OSVČ', 'https://eportal.cssz.cz/documents/20122/35805/OSVC_2025.pdf/3a5a71ee-7efe-1664-b6d1-024c240ab010', 'pdf', 'prehled-osvc-pdf-fill.js, prehled-osvc.js, web/assets/img/prehled-osvc/*'),
  ('cssz-udaje', 'ČSSZ - Přehled nejdůležitějších údajů pro sociální zabezpečení', 'https://www.cssz.gov.cz/-/prehled-nejdulezitejsich-udaju-pro-socialni-zabezpeceni-v-roce-2026', 'html', 'tax-constants.js (PRUMERNA_MZDA, SOCIALNI_*), prehled-osvc.js'),
  ('vzp-zalohy', 'VZP - OSVČ minimální výše záloh', 'https://www.vzp.cz/platci/informace/osvc/osvc-minimalni-vyse-zaloh', 'html', 'tax-constants.js (ZDRAVOTNI_MIN_ZAKLAD_MESICNE)'),
  ('mpsv-cestovni-nahrady', 'MPSV - sazby cestovních náhrad a ceny PHM', 'https://ppropo.mpsv.cz/Vyhlaska_573_2025', 'html', 'kniha-jizd.js (ZAKLADNI_NAHRADA_KM, PRUMERNA_CENA_PHM)'),
  ('fs-pausalni-dan', 'Finanční správa - informace k paušální dani', 'https://financnisprava.gov.cz/cs/dane/dane/dan-z-prijmu/pausalni-dan/informace-k-institutu-pausalni-dane-pro-rok-2025', 'html', 'pausalni-dan.js (PASMO_MESICNE, limity)')
on conflict (key) do nothing;

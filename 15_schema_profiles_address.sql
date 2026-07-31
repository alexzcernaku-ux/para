-- Spusť v Supabase: Dashboard → SQL Editor → New query → vlož a Run
-- Fáze 9 — Generátor dokumentů. Adresa dodavatele je náležitost účetního
-- dokladu (§11 zákona č. 563/1991 Sb., o účetnictví) i daňového dokladu
-- (§29 zákona č. 235/2004 Sb., o DPH) — bez ní nejde vystavit fakturu.
-- Plníme ji stejně jako ico/dic/company_name z ARES lookupu při onboardingu
-- (viz 14_schema_profiles_ares.sql), uživatel ji ale může v generátoru
-- dokumentů i ručně přepsat/doplnit, pokud ARES lookup nepoužil.

alter table profiles add column if not exists address text;

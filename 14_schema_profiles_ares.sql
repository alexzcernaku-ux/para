-- Spusť v Supabase: Dashboard → SQL Editor → New query → vlož a Run
-- Fáze 8 - ARES. Doplňuje profil o údaje, které si uživatel jinak musel
-- vyplňovat ručně (IČO, DIČ, obchodní jméno/název) - vytažené z veřejného
-- ARES API při onboardingu, ať se to dá i později použít (generátor
-- dokumentů ve Fázi 9, kontrola dokladu ve Fázi 6 apod.).

alter table profiles add column if not exists ico text;
alter table profiles add column if not exists dic text;
alter table profiles add column if not exists company_name text;

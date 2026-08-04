-- Spusť v Supabase: Dashboard → SQL Editor → New query → vlož a Run
-- Vzhled dokladů (generator-dokumentu.html) — vlastní logo, barva a
-- patičková poznámka místo pevného vzhledu Para na každém PDF. Kosmetické
-- nastavení vlastněné uživatelem, žádný revoke navíc (stejně jako
-- company_name/ico/dic z 14_schema_profiles_ares.sql).

alter table profiles add column if not exists invoice_brand_name text;
alter table profiles add column if not exists invoice_accent_color text;
-- Logo uložené rovnou jako base64 data URL (ne Supabase Storage) — appka
-- nikde jinde soubory neukládá, tohle je nejjednodušší cesta bez zavádění
-- nové infrastruktury. Klient si obrázek před uploadem zmenší na rozumnou
-- velikost (viz generator-page.js), ať řádek zbytečně nenabobtná.
alter table profiles add column if not exists invoice_logo_data_url text;
alter table profiles add column if not exists invoice_logo_width numeric;
alter table profiles add column if not exists invoice_logo_height numeric;
alter table profiles add column if not exists invoice_footer_note text;

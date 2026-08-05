-- Spusť v Supabase: Dashboard → SQL Editor → New query → vlož a Run
-- Doplněk k 11_schema_law_updates.sql - umožní check-law-updates rozložit
-- kontrolu velkého zákona (např. 586/1992 Sb. má 135 sledovaných paragrafů)
-- do víc týdenních běhů cronu, místo aby se to snažilo stihnout najednou
-- a riskovalo timeout edge function.

alter table law_versions add column if not exists checking_version_date text;
alter table law_versions add column if not exists pending_paragraphs text[];

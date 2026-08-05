-- Spusť v Supabase: Dashboard → SQL Editor → New query → vlož a Run
-- Rozšiřuje termínovník (deadlines.js) o zálohy na daň z příjmů (§ 38a
-- zákona č. 586/1992 Sb.) a daň z nemovitých věcí (zákon č. 338/1992 Sb.).
-- Obojí appka nedokáže spočítat sama z ničeho, co už eviduje - potřebuje
-- to od uživatele vyplnit (viz ucet.html).

-- Poslední známá daňová povinnost (Kč) - určuje, jestli/jak často se platí
-- zálohy na daň z příjmů (do 30 000 Kč žádné, 30-150 000 pololetně,
-- nad 150 000 čtvrtletně). Bez vyplnění appka zálohy vůbec nezobrazuje -
-- bezpečný výchozí stav (žádné falešné upozornění), ne "jako by byly 0".
alter table profiles add column if not exists last_known_tax_liability numeric;

-- Vlastní/užívá nemovitost k podnikání (sídlo, provozovna...) - bez toho
-- se termíny k dani z nemovitých věcí netýkají většiny uživatelů, appka
-- je proto standardně neukazuje vůbec.
alter table profiles add column if not exists owns_business_real_estate boolean not null default false;

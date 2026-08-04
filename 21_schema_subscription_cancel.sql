-- Spusť v Supabase: Dashboard → SQL Editor → New query → vlož a Run
-- Doplňuje 19_schema_subscriptions.sql o možnost zrušit předplatné bez
-- okamžitého odebrání přístupu — uživatel má appku dál do konce už
-- zaplaceného období (viz Obchodní podmínky čl. 5 a Podmínky opakovaných
-- plateb), jen se mu příště nestrhne další platba.
--
-- gopay-charge-renewals (viz index.ts) při true přeskočí strhávání a rovnou
-- přepne subscription_status na 'canceled', místo aby zkoušel platbu.

alter table profiles add column if not exists subscription_cancel_at_period_end boolean not null default false;

-- Stejný důvod jako u ostatních subscription_* sloupců (19_schema_subscriptions.sql)
-- — bez tohohle by si uživatel mohl přímo přes REST API zrušit i cizí
-- nastavení, nebo obráceně zablokovat vlastní zrušení, které appka právě
-- zpracovává. Mění to výhradně gopay-cancel-subscription (service role).
revoke update (subscription_cancel_at_period_end) on profiles from authenticated;

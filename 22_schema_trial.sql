-- Spusť v Supabase: Dashboard → SQL Editor → New query → vlož a Run
-- 7denní zkušební období zdarma, bez nutnosti zadat kartu - nový uživatel
-- appku může používat týden hned po registraci, teprve pak ho
-- requireActiveSubscription() (supabase-client.js) pošle na predplatne.html.
--
-- Necháváme to na kartě záměrně vynechané: GoPay garantuje blokaci
-- předautorizované platby jen 4 dny (ověřeno na help.gopay.com), takže
-- "karta hned, platba za 7 dní" by běželo mimo garantované okno GoPay.
-- Bez karty je to i jednodušší na registraci.

alter table profiles add column if not exists trial_ends_at timestamptz;

-- Nové registrace dostávají trial_ends_at automaticky přes trigger
-- on_auth_user_created (07_schema_profiles.sql) - přepisujeme funkci, ať
-- se datum nastaví hned při založení profilu, ne dodatečně.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.profiles (id, trial_ends_at) values (new.id, now() + interval '7 days');
  return new;
end;
$$;

-- Stejný důvod jako u ostatních subscription_* sloupců - bez tohohle by si
-- uživatel mohl trial_ends_at posunout sám přímo přes REST API. Trigger
-- výše běží jako security definer, takže revoke se ho netýká.
revoke update (trial_ends_at) on profiles from authenticated;

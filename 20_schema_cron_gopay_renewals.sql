-- Spusť v Supabase: Dashboard → SQL Editor → New query → vlož a Run
-- Naplánuje DENNÍ strhávání obnovy předplatného (gopay-charge-renewals musí
-- být už nasazená přes `supabase functions deploy gopay-charge-renewals`).
-- GoPay v ON_DEMAND režimu nic sama automaticky nestrhává - bez tohohle
-- cronu by po prvním zaplacení předplatné po měsíci/roce prostě vypršelo
-- a nikdy se neobnovilo.
--
-- ⚠️ Nahraď dva placeholdery před spuštěním (stejně jako u ostatních cronů):
--   1) TVUJ-PROJEKT           → project ref
--   2) TVUJ_SERVICE_ROLE_KEY  → Project Settings → API → service_role klíč

select cron.schedule(
  'gopay-charge-renewals-daily',
  '0 5 * * *',  -- denně v 5:00 UTC (před ostatními cronu kontrolami zákonů/tiskopisů)
  $$
  select net.http_post(
    url := 'https://TVUJ-PROJEKT.supabase.co/functions/v1/gopay-charge-renewals',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer TVUJ_SERVICE_ROLE_KEY'
    ),
    body := '{}'::jsonb
  );
  $$
);

-- Pro zrušení: select cron.unschedule('gopay-charge-renewals-daily');

-- Spusť v Supabase: Dashboard → SQL Editor → New query → vlož a Run
-- Naplánuje denní spuštění supabase/functions/recurring-invoices-run (musí
-- být už nasazená - supabase functions deploy recurring-invoices-run).
--
-- ⚠️ Nahraď dva placeholdery níže před spuštěním:
--   1) TVUJ-PROJEKT          → project ref
--   2) TVUJ_SERVICE_ROLE_KEY → Project Settings → API → service_role klíč

select cron.schedule(
  'recurring-invoices-run-daily',
  '0 6 * * *',  -- denně v 6:00 UTC (před send-reminders v 7:00, ať případný nový záznam stihne padnout do stejného dne)
  $$
  select net.http_post(
    url := 'https://TVUJ-PROJEKT.supabase.co/functions/v1/recurring-invoices-run',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer TVUJ_SERVICE_ROLE_KEY'
    ),
    body := '{}'::jsonb
  );
  $$
);

-- Pro zrušení: select cron.unschedule('recurring-invoices-run-daily');

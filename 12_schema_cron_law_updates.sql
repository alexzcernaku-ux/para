-- Spusť v Supabase: Dashboard → SQL Editor → New query → vlož a Run
-- Naplánuje týdenní kontrolu novel (check-law-updates musí být už nasazená).
--
-- ⚠️ Nahraď dva placeholdery před spuštěním (stejně jako u 10_schema_cron_reminders.sql):
--   1) TVUJ-PROJEKT           → project ref
--   2) TVUJ_SERVICE_ROLE_KEY  → Project Settings → API → service_role klíč

select cron.schedule(
  'check-law-updates-weekly',
  '0 6 * * 1',  -- každé pondělí v 6:00 UTC
  $$
  select net.http_post(
    url := 'https://TVUJ-PROJEKT.supabase.co/functions/v1/check-law-updates',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer TVUJ_SERVICE_ROLE_KEY'
    ),
    body := '{}'::jsonb
  );
  $$
);

-- Pro zrušení: select cron.unschedule('check-law-updates-weekly');

-- Spusť v Supabase: Dashboard → SQL Editor → New query → vlož a Run
-- Naplánuje DENNÍ kontrolu tiskopisů a zdrojových stránek (check-form-updates
-- musí být už nasazená). Denně, ne týdně jako u zákonů (12_schema_cron_law_updates.sql)
-- - je to jen pár levných HTTP requestů, a tiskopisy/sazby na přelomu roku
-- se mění nárazově, takže rychlejší záchyt stojí za to.
--
-- ⚠️ Nahraď dva placeholdery před spuštěním (stejně jako u ostatních cronů):
--   1) TVUJ-PROJEKT           → project ref
--   2) TVUJ_SERVICE_ROLE_KEY  → Project Settings → API → service_role klíč

select cron.schedule(
  'check-form-updates-daily',
  '0 7 * * *',  -- denně v 7:00 UTC (hodinu po týdenní kontrole zákonů, ať neběží souběžně)
  $$
  select net.http_post(
    url := 'https://TVUJ-PROJEKT.supabase.co/functions/v1/check-form-updates',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer TVUJ_SERVICE_ROLE_KEY'
    ),
    body := '{}'::jsonb
  );
  $$
);

-- Pro zrušení: select cron.unschedule('check-form-updates-daily');

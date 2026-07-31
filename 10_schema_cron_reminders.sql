-- Spusť v Supabase: Dashboard → SQL Editor → New query → vlož a Run
-- Naplánuje denní spuštění supabase/functions/send-reminders (musí být
-- už nasazená — supabase functions deploy send-reminders).
--
-- ⚠️ Nahraď dva placeholdery níže před spuštěním:
--   1) TVUJ-PROJEKT   → project ref (stejný jako v PARA_CONFIG.supabaseUrl)
--   2) TVUJ_SERVICE_ROLE_KEY → Project Settings → API → service_role klíč
--      (tajný, nikdy ho nedávej do klientského kódu — tady je to v pořádku,
--      protože žije jen v databázi, ne ve webu)

create extension if not exists pg_cron with schema extensions;
create extension if not exists pg_net with schema extensions;

select cron.schedule(
  'send-reminders-daily',
  '0 7 * * *',  -- každý den v 7:00 UTC (9:00 v létě / 8:00 v zimě SEČ)
  $$
  select net.http_post(
    url := 'https://TVUJ-PROJEKT.supabase.co/functions/v1/send-reminders',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer TVUJ_SERVICE_ROLE_KEY'
    ),
    body := '{}'::jsonb
  );
  $$
);

-- Pro zrušení plánu (např. při ladění): select cron.unschedule('send-reminders-daily');
-- Pro ruční test bez čekání na cron: zavolej stejné net.http_post příkazy
-- ručně v SQL editoru, nebo rovnou "supabase functions invoke send-reminders".

-- Spusť v Supabase: Dashboard → SQL Editor → New query → vlož a Run
-- Fáze 4 — termínovník. Eviduje, které připomínky (e-mail pár dní před
-- termínem) už byly danému uživateli odeslané, aby se totéž neposílalo
-- vícekrát. Zapisuje jen scheduled edge function (service role), proto
-- žádná insert/update policy pro klienta — jen čtení vlastních řádků.

create table if not exists reminder_log (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  deadline_key text not null,   -- např. 'dph-2026-3', viz klíče v deadlines.js
  sent_at timestamptz default now(),
  unique (user_id, deadline_key)
);

alter table reminder_log enable row level security;

create policy "Users select own reminder log" on reminder_log
  for select using (auth.uid() = user_id);

create index if not exists reminder_log_user_id_idx on reminder_log (user_id);

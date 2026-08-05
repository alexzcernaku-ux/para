-- Spusť v Supabase: Dashboard → SQL Editor → New query → vlož a Run
-- Fáze 7 - sledování novel zákonů. Čistě interní tabulky, dotýkají se jich
-- jen edge functions (service role) - žádné RLS policy pro klienta/uživatele
-- záměrně (RLS je zapnuté, ale bez policy = nikdo přes anon/authenticated
-- roli nic nepřečte ani nezapíše; service_role RLS obchází vždy).

-- 1) Poslední známá verze každého sledovaného zákona (podle má-poslední-znění
--    z e-Sbírky). Bez řádku pro daný law_code = ještě jsme ho nekontrolovali.
create table if not exists law_versions (
  law_code text primary key,
  last_known_version_date text,
  last_checked_at timestamptz default now()
);

alter table law_versions enable row level security;

-- 2) Detekované změny čekající na (lidské) schválení, případně už vyřízené.
create table if not exists law_change_events (
  id bigint generated always as identity primary key,
  law_code text not null,
  law_name text,
  section_ref text not null,          -- např. '§ 29'
  chunk_ids bigint[] not null,        -- id řádků v law_chunks, kterých se to týká (viz pozn. u review-law-change)
  old_version_date text,
  new_version_date text,
  old_content text,
  new_content text,
  review_token uuid not null default gen_random_uuid(),
  status text not null default 'pending_review'
    check (status in ('pending_review', 'approved', 'rejected', 'unreliable')),
  detected_at timestamptz default now(),
  reviewed_at timestamptz,
  notified_user_count int
);

alter table law_change_events enable row level security;

create index if not exists law_change_events_status_idx on law_change_events (status);

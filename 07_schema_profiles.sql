-- Spusť v Supabase: Dashboard → SQL Editor → New query → vlož a Run
-- Fáze 2 — účty a profily. Vyžaduje zapnutý Supabase Auth (Email/Magic Link),
-- viz Authentication → Providers → Email (Magic Link stačí, heslo nepotřebujeme).

-- 1) Profil uživatele — typ subjektu a DPH režim, používá se pro
--    personalizaci odpovědí edge function (viz profileContext() v
--    03_local_server.mjs / 03_edge_function/index.ts).
create table if not exists profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  legal_form text check (legal_form in ('osvc_pausal', 'osvc_skutecne', 'sro')),
  vat_payer boolean,
  note text,
  onboarded_at timestamptz,
  created_at timestamptz default now()
);

alter table profiles enable row level security;

create policy "Users select own profile" on profiles
  for select using (auth.uid() = id);
create policy "Users update own profile" on profiles
  for update using (auth.uid() = id) with check (auth.uid() = id);
-- Žádná explicitní insert policy pro klienta — řádek vytváří jen trigger
-- níže (security definer), aby vždy existoval přesně jeden profil na
-- uživatele a klient si nemohl založit cizí/duplicitní řádek.

-- 2) Při registraci automaticky založit prázdný profil (onboarded_at = null,
--    dokud uživatel neprojde onboardingem).
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.profiles (id) values (new.id);
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- 3) Historie dotazů — jen pro přihlášené, každý vidí jen svoje.
create table if not exists query_history (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  question text not null,
  answer text not null,
  sources jsonb,
  created_at timestamptz default now()
);

alter table query_history enable row level security;

create policy "Users select own history" on query_history
  for select using (auth.uid() = user_id);
create policy "Users insert own history" on query_history
  for insert with check (auth.uid() = user_id);
create policy "Users delete own history" on query_history
  for delete using (auth.uid() = user_id);

create index if not exists query_history_user_id_created_idx
  on query_history (user_id, created_at desc);

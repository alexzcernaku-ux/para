-- Spusť v Supabase: Dashboard → SQL Editor → New query → vlož a Run
-- Předplatné - profil dostává stav předplatného, plus dočasný whitelist
-- (dokud GoPay integrace neběží naostro, jde přes něj obejít placení pro
-- konkrétní e-maily - typicky majitele účtu při testování).

alter table profiles add column if not exists subscription_status text not null default 'none'
  check (subscription_status in ('none', 'active', 'past_due', 'canceled'));
alter table profiles add column if not exists subscription_plan text
  check (subscription_plan in ('monthly', 'yearly'));
alter table profiles add column if not exists subscription_current_period_end timestamptz;
-- ID zakládající (ON_DEMAND) platby u GoPay - potřeba pro create-recurrence
-- při měsíční/roční obnově (viz gopay-charge-renewals).
alter table profiles add column if not exists gopay_parent_payment_id text;

-- KRITICKÉ: existující RLS policy "Users update own profile" (07_schema_profiles.sql)
-- dovolí uživateli přepsat KTERÝKOLI sloupec vlastního řádku - bez tohohle
-- REVOKE by si mohl kdokoli nastavit subscription_status='active' přímo
-- přes REST API a mít appku zdarma navždy, bez placení. RLS řeší JEN
-- "čí řádek", ne "který sloupec" - to je otázka column-level GRANT/REVOKE,
-- oddělený mechanismus. Tyhle čtyři sloupce smí měnit jen service role
-- (edge funkce gopay-checkout/gopay-webhook/gopay-charge-renewals).
revoke update (subscription_status, subscription_plan, subscription_current_period_end, gopay_parent_payment_id)
  on profiles from authenticated;

create table if not exists subscription_whitelist (
  email text primary key,
  note text,
  created_at timestamptz default now()
);

alter table subscription_whitelist enable row level security;
-- Uživatel smí zjistit JEN, jestli je na whitelistu JEHO VLASTNÍ e-mail -
-- ne nahlížet do celého seznamu.
create policy "Users check own email" on subscription_whitelist
  for select using (email = auth.jwt() ->> 'email');

-- Dočasná výjimka, dokud neběží platby naostro - uprav/smaž podle potřeby:
-- delete from subscription_whitelist where email = 'tvuj@email.cz';
insert into subscription_whitelist (email, note) values
  ('alexzcernaku@gmail.com', 'Majitel účtu - dočasná výjimka, než běží GoPay naostro.')
on conflict (email) do nothing;

-- Log plateb pro dohledatelnost (nezávisí na tom, jestli se to profilu
-- podařilo zapsat) - čte/píše jen service role z edge funkcí.
create table if not exists payment_events (
  id bigint generated always as identity primary key,
  user_id uuid references auth.users(id) on delete set null,
  gopay_payment_id text,
  gopay_parent_payment_id text,
  event_type text not null, -- 'created' | 'paid' | 'failed' | 'canceled' | 'renewal_charged' | 'renewal_failed'
  amount numeric(10,2),
  raw_state text,
  created_at timestamptz default now()
);

alter table payment_events enable row level security;
create policy "Service role only" on payment_events for all using (false);

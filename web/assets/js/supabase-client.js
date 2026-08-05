// Sdílený Supabase klient + auth/profil/historie helpery pro celý autentizovaný
// web (prihlaseni.html, onboarding.html, app.html). Načítá se jako ES modul
// (<script type="module">), supabase-js jde přímo z CDN stejně jako v
// supabase/functions/zakon-query/index.ts (žádný build krok, žádný framework).
//
// PARA_CONFIG.supabaseUrl / supabaseAnonKey musí být nastavené v <head> stránky
// před importem tohoto modulu (viz komentář v index.html).

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const cfg = window.PARA_CONFIG || {};

if (!cfg.supabaseUrl || cfg.supabaseUrl.includes("TVUJ-PROJEKT")) {
  console.warn(
    "PARA_CONFIG.supabaseUrl není nastavený - auth, profil a historie dotazů nebudou fungovat, dokud nedoplníš Supabase URL/anon key."
  );
}

export const supabase = createClient(
  cfg.supabaseUrl || "https://placeholder.supabase.co",
  cfg.supabaseAnonKey || "placeholder",
  { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true } }
);

export const LOGIN_PAGE = "prihlaseni.html";
export const ONBOARDING_PAGE = "onboarding.html";
export const APP_PAGE = "app.html";
export const SUBSCRIBE_PAGE = "predplatne.html";

export async function getSession() {
  const { data, error } = await supabase.auth.getSession();
  if (error) throw error;
  return data.session;
}

// Pošle magic link. redirectTo musí být na allow-listu v Supabase
// (Authentication → URL Configuration → Redirect URLs). Ponecháno jako
// záložní cesta (odkaz "přihlásit se odkazem" na prihlaseni.html) - hlavní
// cesta je teď heslo, viz signUpWithPassword/signInWithPassword níže.
export async function sendMagicLink(email, redirectTo) {
  const { error } = await supabase.auth.signInWithOtp({
    email,
    options: { emailRedirectTo: redirectTo },
  });
  if (error) throw error;
}

// Registrace heslem - pošle potvrzovací e-mail (Supabase Auth to dělá samo,
// stejná šablona jako pro magic link, jen s odkazem "potvrdit e-mail" místo
// "přihlásit se"). Dokud uživatel nepotvrdí, signInWithPassword neprojde.
export async function signUpWithPassword(email, password, redirectTo) {
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: { emailRedirectTo: redirectTo },
  });
  if (error) throw error;
  return data;
}

export async function signInWithPassword(email, password) {
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) throw error;
  return data;
}

// Odešle e-mail s odkazem na nastavení nového hesla (odkaz vede na
// reset-hesla.html, kde se stránka podle přítomnosti session pozná, že je
// v "recovery" režimu - viz supabase.auth.onAuthStateChange tam).
export async function sendPasswordReset(email, redirectTo) {
  const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo });
  if (error) throw error;
}

export async function updatePassword(newPassword) {
  const { error } = await supabase.auth.updateUser({ password: newPassword });
  if (error) throw error;
}

export async function signOut() {
  await supabase.auth.signOut();
  window.location.href = LOGIN_PAGE;
}

// Přesměruje na přihlášení, pokud uživatel nemá session. Vrací session, jinak null.
export async function requireSession() {
  const session = await getSession();
  if (!session) {
    window.location.href = LOGIN_PAGE;
    return null;
  }
  return session;
}

export async function getProfile(userId) {
  const { data, error } = await supabase
    .from("profiles")
    .select("*")
    .eq("id", userId)
    .single();
  if (error) throw error;
  return data;
}

// Dočasná výjimka z placení (19_schema_subscriptions.sql) - dokud GoPay
// neběží naostro, e-maily na tomhle seznamu appku používají zdarma. RLS na
// subscription_whitelist dovolí zjistit jen vlastní e-mail, ne celý seznam.
async function isWhitelisted(email) {
  const { data, error } = await supabase.from("subscription_whitelist").select("email").eq("email", email).maybeSingle();
  if (error) {
    console.error("Nepodařilo se ověřit whitelist:", error.message);
    return false;
  }
  return !!data;
}

function isSubscriptionActive(profile) {
  return profile.subscription_status === "active" || profile.subscription_status === "past_due";
}

// 7denní zkušební období bez karty (22_schema_trial.sql) - trial_ends_at se
// nastaví automaticky při registraci, appka ho respektuje stejně jako
// aktivní předplatné, dokud nevyprší.
export function isInTrial(profile) {
  return !!profile.trial_ends_at && new Date(profile.trial_ends_at) > new Date();
}

// Kolik dní zkušební doby ještě zbývá (zaokrouhleno nahoru) - pro zobrazení
// v appce (app.html, ucet.html). Vrací 0, pokud trial už neběží.
export function trialDaysLeft(profile) {
  if (!isInTrial(profile)) return 0;
  const msLeft = new Date(profile.trial_ends_at).getTime() - Date.now();
  return Math.max(0, Math.ceil(msLeft / (24 * 60 * 60 * 1000)));
}

// Vyžaduje session A (aktivní předplatné NEBO běžící trial NEBO whitelist
// výjimku) - bez toho appku nejde použít vůbec, ani onboarding. Použij na
// app.html i na onboarding.html.
export async function requireActiveSubscription() {
  const session = await requireSession();
  if (!session) return null;
  const profile = await getProfile(session.user.id);
  if (isSubscriptionActive(profile) || isInTrial(profile) || (await isWhitelisted(session.user.email))) {
    return { session, profile };
  }
  window.location.href = SUBSCRIBE_PAGE;
  return null;
}

// Vyžaduje session, aktivní předplatné I dokončený onboarding (legal_form
// vyplněný). Použij na app.html a všech nástrojích - bez předplatného pošle
// na predplatne.html, s předplatným ale bez onboardingu na onboarding.html.
export async function requireOnboardedProfile() {
  const result = await requireActiveSubscription();
  if (!result) return null;
  const { session, profile } = result;
  if (!profile.onboarded_at) {
    window.location.href = ONBOARDING_PAGE;
    return null;
  }
  return { session, profile };
}

// Zrušení předplatného (ucet.html) - volá gopay-cancel-subscription, která
// nastaví subscription_cancel_at_period_end. Appka zůstává funkční do konce
// zaplaceného období, viz Obchodní podmínky čl. 5 a gopay-charge-renewals.
export async function cancelSubscription(accessToken) {
  const res = await fetch(`${cfg.supabaseUrl}/functions/v1/gopay-cancel-subscription`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${accessToken}`,
      apikey: cfg.supabaseAnonKey,
    },
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || `Chyba serveru (${res.status})`);
  return data;
}

export async function saveProfile(userId, { legalForm, vatPayer, note, ico, dic, companyName, address }) {
  const { error } = await supabase
    .from("profiles")
    .update({
      legal_form: legalForm,
      vat_payer: vatPayer,
      note: note || null,
      ico: ico || null,
      dic: dic || null,
      company_name: companyName || null,
      address: address || null,
      onboarded_at: new Date().toISOString(),
    })
    .eq("id", userId);
  if (error) throw error;
}

// Umožní generátoru dokumentů (Fáze 9) doplnit/přepsat firemní údaje
// (adresu apod.) i po dokončeném onboardingu, aniž by se přepisoval
// legal_form/vat_payer/onboarded_at.
export async function updateProfileBillingInfo(userId, { companyName, ico, dic, address }) {
  const { error } = await supabase
    .from("profiles")
    .update({
      company_name: companyName || null,
      ico: ico || null,
      dic: dic || null,
      address: address || null,
    })
    .eq("id", userId);
  if (error) throw error;
}

// Editace firemních údajů z ucet.html - na rozdíl od saveProfile (onboarding)
// nešahá na note/onboarded_at, jen na to, co si uživatel může chtít
// dodatečně opravit (např. špatně načtené ARES údaje, změna DPH režimu).
export async function updateCompanyInfo(userId, { legalForm, vatPayer, companyName, ico, dic, address, lastKnownTaxLiability, ownsBusinessRealEstate }) {
  const { error } = await supabase
    .from("profiles")
    .update({
      legal_form: legalForm,
      vat_payer: vatPayer,
      company_name: companyName || null,
      ico: ico || null,
      dic: dic || null,
      address: address || null,
      last_known_tax_liability: lastKnownTaxLiability || null,
      owns_business_real_estate: !!ownsBusinessRealEstate,
    })
    .eq("id", userId);
  if (error) throw error;
}

// Vzhled dokladů (24_schema_invoice_branding.sql) - logo/barva/patička
// místo pevného vzhledu Para na PDF z generator-dokumentu.html.
export async function updateInvoiceBranding(userId, { brandName, accentColor, logoDataUrl, logoWidth, logoHeight, footerNote }) {
  const { error } = await supabase
    .from("profiles")
    .update({
      invoice_brand_name: brandName || null,
      invoice_accent_color: accentColor || null,
      invoice_logo_data_url: logoDataUrl || null,
      invoice_logo_width: logoWidth || null,
      invoice_logo_height: logoHeight || null,
      invoice_footer_note: footerNote || null,
    })
    .eq("id", userId);
  if (error) throw error;
}

export async function insertQueryHistory({ userId, question, answer, sources }) {
  const { error } = await supabase
    .from("query_history")
    .insert({ user_id: userId, question, answer, sources });
  if (error) throw error;
}

export async function listQueryHistory(userId, limit = 50) {
  const { data, error } = await supabase
    .from("query_history")
    .select("*")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw error;
  return data;
}

// --- Evidence příjmů a výdajů (16_schema_ledger.sql) -----------------------

export async function listLedgerEntries(userId, { from, to } = {}) {
  let query = supabase.from("ledger_entries").select("*").eq("user_id", userId).order("entry_date", { ascending: false });
  if (from) query = query.gte("entry_date", from);
  if (to) query = query.lte("entry_date", to);
  const { data, error } = await query;
  if (error) throw error;
  return data;
}

export async function insertLedgerEntry(userId, { entryDate, type, amount, category, description, invoiceId }) {
  const { data, error } = await supabase
    .from("ledger_entries")
    .insert({ user_id: userId, entry_date: entryDate, type, amount, category: category || null, description: description || null, invoice_id: invoiceId || null })
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function updateLedgerEntry(id, { entryDate, type, amount, category, description }) {
  const { error } = await supabase
    .from("ledger_entries")
    .update({ entry_date: entryDate, type, amount, category: category || null, description: description || null })
    .eq("id", id);
  if (error) throw error;
}

export async function deleteLedgerEntry(id) {
  const { error } = await supabase.from("ledger_entries").delete().eq("id", id);
  if (error) throw error;
}

// Hromadné vložení (Import bankovního výpisu) - jeden insert místo řádku po řádku.
export async function insertLedgerEntriesBulk(userId, entries) {
  const rows = entries.map((e) => ({
    user_id: userId,
    entry_date: e.entryDate,
    type: e.type,
    amount: e.amount,
    category: e.category || null,
    description: e.description || null,
  }));
  const { data, error } = await supabase.from("ledger_entries").insert(rows).select();
  if (error) throw error;
  return data;
}

// --- Sledování faktur (16_schema_ledger.sql) --------------------------------

export async function listInvoices(userId) {
  const { data, error } = await supabase
    .from("invoices")
    .select("*")
    .eq("user_id", userId)
    .order("issue_date", { ascending: false });
  if (error) throw error;
  return data;
}

export async function insertInvoice(userId, invoice) {
  const { data, error } = await supabase
    .from("invoices")
    .insert({
      user_id: userId,
      direction: invoice.direction,
      number: invoice.number || null,
      counterparty_name: invoice.counterpartyName || null,
      counterparty_ico: invoice.counterpartyIco || null,
      issue_date: invoice.issueDate,
      due_date: invoice.dueDate || null,
      amount: invoice.amount,
      vat_amount: invoice.vatAmount || 0,
      note: invoice.note || null,
    })
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function updateInvoice(id, invoice) {
  const { error } = await supabase
    .from("invoices")
    .update({
      direction: invoice.direction,
      number: invoice.number || null,
      counterparty_name: invoice.counterpartyName || null,
      counterparty_ico: invoice.counterpartyIco || null,
      issue_date: invoice.issueDate,
      due_date: invoice.dueDate || null,
      amount: invoice.amount,
      vat_amount: invoice.vatAmount || 0,
      note: invoice.note || null,
    })
    .eq("id", id);
  if (error) throw error;
}

export async function setInvoicePaid(id, paid) {
  const { error } = await supabase
    .from("invoices")
    .update({ paid, paid_date: paid ? new Date().toISOString().slice(0, 10) : null })
    .eq("id", id);
  if (error) throw error;
}

export async function deleteInvoice(id) {
  const { error } = await supabase.from("invoices").delete().eq("id", id);
  if (error) throw error;
}

// --- Klienti (23_schema_clients.sql) ----------------------------------------
// Jednou zadaný klient (odběratel) se pak jen vybírá ve faktury.html a
// generator-dokumentu.html místo ručního přepisování - viz klienti.html.

export async function listClients(userId) {
  const { data, error } = await supabase
    .from("clients")
    .select("*")
    .eq("user_id", userId)
    .order("name", { ascending: true });
  if (error) throw error;
  return data;
}

export async function insertClient(userId, { name, ico, dic, address, email, phone, note }) {
  const { data, error } = await supabase
    .from("clients")
    .insert({
      user_id: userId,
      name,
      ico: ico || null,
      dic: dic || null,
      address: address || null,
      email: email || null,
      phone: phone || null,
      note: note || null,
    })
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function updateClient(id, { name, ico, dic, address, email, phone, note }) {
  const { error } = await supabase
    .from("clients")
    .update({
      name,
      ico: ico || null,
      dic: dic || null,
      address: address || null,
      email: email || null,
      phone: phone || null,
      note: note || null,
    })
    .eq("id", id);
  if (error) throw error;
}

export async function deleteClient(id) {
  const { error } = await supabase.from("clients").delete().eq("id", id);
  if (error) throw error;
}

// Uloží klienta, pokud stejné jméno (case-insensitive) ještě v seznamu není
// - používá se z "Uložit i jako klienta" checkboxu ve faktury.html a
// generator-dokumentu.html, ať se nehromadí duplicity při opakovaném zadání
// téhož odběratele.
export async function upsertClientByName(userId, clientData) {
  const existing = await listClients(userId);
  const match = existing.find((c) => c.name.trim().toLowerCase() === clientData.name.trim().toLowerCase());
  if (match) {
    await updateClient(match.id, { ...match, ...clientData });
    return match.id;
  }
  const created = await insertClient(userId, clientData);
  return created.id;
}

// --- Kniha jízd (16_schema_ledger.sql) --------------------------------------

export async function listVehicleTrips(userId, { from, to } = {}) {
  let query = supabase.from("vehicle_trips").select("*").eq("user_id", userId).order("trip_date", { ascending: false });
  if (from) query = query.gte("trip_date", from);
  if (to) query = query.lte("trip_date", to);
  const { data, error } = await query;
  if (error) throw error;
  return data;
}

export async function insertVehicleTrip(userId, trip) {
  const { data, error } = await supabase
    .from("vehicle_trips")
    .insert({
      user_id: userId,
      trip_date: trip.tripDate,
      purpose: trip.purpose,
      route: trip.route || null,
      distance_km: trip.distanceKm,
      consumption_l_100km: trip.consumptionL100km || null,
      fuel_type: trip.fuelType || null,
      fuel_price_override: trip.fuelPriceOverride || null,
    })
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function deleteVehicleTrip(id) {
  const { error } = await supabase.from("vehicle_trips").delete().eq("id", id);
  if (error) throw error;
}

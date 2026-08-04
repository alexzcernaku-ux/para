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
    "PARA_CONFIG.supabaseUrl není nastavený — auth, profil a historie dotazů nebudou fungovat, dokud nedoplníš Supabase URL/anon key."
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

export async function getSession() {
  const { data, error } = await supabase.auth.getSession();
  if (error) throw error;
  return data.session;
}

// Pošle magic link. redirectTo musí být na allow-listu v Supabase
// (Authentication → URL Configuration → Redirect URLs).
export async function sendMagicLink(email, redirectTo) {
  const { error } = await supabase.auth.signInWithOtp({
    email,
    options: { emailRedirectTo: redirectTo },
  });
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

// Vyžaduje session I dokončený onboarding (legal_form vyplněný). Použij na
// app.html — pokud profil ještě není hotový, pošle uživatele na onboarding.
export async function requireOnboardedProfile() {
  const session = await requireSession();
  if (!session) return null;
  const profile = await getProfile(session.user.id);
  if (!profile.onboarded_at) {
    window.location.href = ONBOARDING_PAGE;
    return null;
  }
  return { session, profile };
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

// Hromadné vložení (Import bankovního výpisu) — jeden insert místo řádku po řádku.
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

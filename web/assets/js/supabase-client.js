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

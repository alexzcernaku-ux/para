// supabase/functions/check-form-updates/index.ts
//
// Denní cron (viz 18_schema_cron_form_updates.sql) - hlídá dvě věci, které
// check-law-updates NEPOKRÝVÁ (ten hlídá jen text § v law_chunks):
//
// 1) Tiskopisy (PDF), na které jsou napevno namapované pixelové souřadnice
//    v dap-pdf-fill.js/dph-pdf-fill.js/prehled-osvc-pdf-fill.js - vyjde-li
//    nový "vzor", souřadnice se rozjedou potichu, bez chybové hlášky.
// 2) Zdrojové stránky pro čísla v tax-constants.js/kniha-jizd.js/
//    pausalni-dan.js (sazby, limity, pásma) - ty se NEČERPAJÍ ze zákonů
//    automaticky, jsou to ručně ověřená čísla zapsaná při stavbě appky.
//
// Princip stejný jako check-law-updates: nic se v appce samo nezmění.
// U PDF se porovná SHA-256 hash obsahu, u HTML stránek hash z
// html-text.js (jen viditelný text, ať nehlásí "změnu" kvůli
// cache-busting timestampu v <script> na každý request). Při rozdílu (nebo
// když zdroj přestane jít stáhnout - třeba se přesunul úplně jinam) založí
// form_watch_events (pending_review) a pošle e-mail. last_known_hash se
// při alertu rovnou přepíše na nový, ať nechodí stejný e-mail znovu a
// znovu každý den - vyřešeno/potvrzeno se označí přes review-form-update.
//
// Nasazení: supabase functions deploy check-form-updates
// Secrets: žádné nové - RESEND_API_KEY, RESEND_FROM, ADMIN_EMAIL stejné jako check-law-updates.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { htmlToStableText, sha256Hex } from "../_shared/html-text.js";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
);

const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY")!;
const RESEND_FROM = Deno.env.get("RESEND_FROM") || "Para <onboarding@resend.dev>";
const ADMIN_EMAIL = Deno.env.get("ADMIN_EMAIL")!;
const FUNCTIONS_BASE = `${Deno.env.get("SUPABASE_URL")}/functions/v1`;

async function sendEmail(to: string, subject: string, html: string) {
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${RESEND_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from: RESEND_FROM, to, subject, html }),
  });
  if (!res.ok) throw new Error(`Resend API error: ${res.status} ${await res.text()}`);
}

async function fetchAndHash(url: string, kind: "pdf" | "html") {
  const res = await fetch(url, { headers: { "User-Agent": "Para-form-watch/1.0" } });
  if (!res.ok) return { ok: false as const, status: res.status };
  if (kind === "pdf") {
    const buf = new Uint8Array(await res.arrayBuffer());
    return { ok: true as const, hash: await sha256Hex(buf) };
  }
  const text = htmlToStableText(await res.text());
  return { ok: true as const, hash: await sha256Hex(text) };
}

Deno.serve(async (req) => {
  try {
    const { data: sources, error } = await supabase.from("form_watch_sources").select("*").order("key");
    if (error) throw error;

    const summary: any[] = [];
    const changedForEmail: any[] = [];

    for (const source of sources) {
      let result;
      try {
        result = await fetchAndHash(source.url, source.kind);
      } catch (err) {
        result = { ok: false as const, status: 0, error: String(err) };
      }

      if (!result.ok) {
        // Nejde stáhnout - buď dočasný výpadek serveru, nebo (důležitější
        // případ) se dokument přesunul na jinou URL. Založit event jen když
        // se to jinak nekontrolovalo poprvé (ať bootstrap se stránkou, co
        // je zrovna nedostupná, hned nezaloží falešný poplach).
        summary.push({ key: source.key, unreachable: true, status: "status" in result ? result.status : undefined });
        if (source.last_known_hash) {
          const { data: inserted } = await supabase
            .from("form_watch_events")
            .insert({ source_key: source.key, label: source.label, url: source.url, event_type: "unreachable", old_hash: source.last_known_hash })
            .select("id, review_token")
            .single();
          if (inserted) changedForEmail.push({ source, inserted, type: "unreachable" });
        }
        await supabase.from("form_watch_sources").update({ last_checked_at: new Date().toISOString() }).eq("key", source.key);
        continue;
      }

      if (!source.last_known_hash) {
        // Bootstrap - první běh pro tenhle zdroj, jen si uložit výchozí stav.
        await supabase
          .from("form_watch_sources")
          .update({ last_known_hash: result.hash, last_checked_at: new Date().toISOString() })
          .eq("key", source.key);
        summary.push({ key: source.key, baseline: true });
        continue;
      }

      if (result.hash === source.last_known_hash) {
        await supabase.from("form_watch_sources").update({ last_checked_at: new Date().toISOString() }).eq("key", source.key);
        summary.push({ key: source.key, unchanged: true });
        continue;
      }

      const { data: inserted, error: insertError } = await supabase
        .from("form_watch_events")
        .insert({
          source_key: source.key,
          label: source.label,
          url: source.url,
          event_type: "changed",
          old_hash: source.last_known_hash,
          new_hash: result.hash,
        })
        .select("id, review_token")
        .single();
      if (insertError) throw insertError;

      await supabase
        .from("form_watch_sources")
        .update({ last_known_hash: result.hash, last_checked_at: new Date().toISOString() })
        .eq("key", source.key);

      summary.push({ key: source.key, changed: true, eventId: inserted.id });
      changedForEmail.push({ source, inserted, type: "changed" });
    }

    if (changedForEmail.length && ADMIN_EMAIL) {
      const rows = changedForEmail
        .map(({ source, inserted, type }) => {
          const ackUrl = `${FUNCTIONS_BASE}/review-form-update?id=${inserted.id}&token=${inserted.review_token}`;
          const kindLabel = source.kind === "pdf" ? "Tiskopis (PDF)" : "Zdrojová stránka";
          const msg = type === "unreachable" ? "Přestalo jít stáhnout - možná se přesunulo na jinou adresu." : "Obsah se změnil oproti poslední kontrole.";
          return `<tr>
            <td style="padding:10px 12px;border-bottom:1px solid #e2e8f0">
              <strong>${source.label}</strong><br/>
              <span style="color:#64748b;font-size:13px">${kindLabel} · ${msg}</span><br/>
              <span style="color:#64748b;font-size:12px">Ovlivňuje: ${source.affects || "-"}</span><br/>
              <a href="${source.url}" style="font-size:13px">${source.url}</a>
            </td>
            <td style="padding:10px 12px;border-bottom:1px solid #e2e8f0;white-space:nowrap">
              <a href="${ackUrl}" style="background:#6366F1;color:#fff;padding:8px 14px;border-radius:8px;text-decoration:none;font-size:13px">Označit jako vyřešeno</a>
            </td>
          </tr>`;
        })
        .join("");

      await sendEmail(
        ADMIN_EMAIL,
        `Para: ${changedForEmail.length} tiskopis/zdroj ke kontrole`,
        `<div style="font-family:sans-serif;max-width:680px">
          <p>Změnil se obsah u ${changedForEmail.length} sledovaného zdroje - u tiskopisů to obvykle znamená nový "vzor" (přemapovat souřadnice v *-pdf-fill.js), u zdrojových stránek novou sazbu/limit pro daný rok (přepsat konstantu v tax-constants.js / kniha-jizd.js / pausalni-dan.js).</p>
          <table style="border-collapse:collapse;width:100%">${rows}</table>
          <p style="color:#94a3b8;font-size:12px;margin-top:16px">Odkaz jen potvrdí, že jsi to viděl/a - samotnou opravu (přemapování PDF, přepsání konstanty) musíš udělat ručně, appka to sama neumí bezpečně odhadnout.</p>
        </div>`
      ).catch((e) => console.error("Admin email selhal:", e.message));
    }

    return new Response(JSON.stringify({ ok: true, sourcesChecked: sources.length, changed: changedForEmail.length, summary }), {
      headers: { "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error(err);
    return new Response(JSON.stringify({ error: String(err) }), { status: 500, headers: { "Content-Type": "application/json" } });
  }
});

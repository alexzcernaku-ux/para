// supabase/functions/check-law-updates/index.ts
//
// Fáze 7 — cron (týdně, viz 12_schema_cron_law_updates.sql). Pro každý
// sledovaný zákon zjistí z e-Sbírky (_shared/esbirka.js), jestli vyšla nová
// konsolidovaná verze. Pokud ano, projde paragrafy, které o daném zákonu
// máme v law_chunks, zrekonstruuje jejich nový text a porovná se stávajícím.
// Při reálném rozdílu založí law_change_events (status pending_review) a
// pošle TOBĚ (ADMIN_EMAIL) e-mail se shrnutím a odkazem na schválení/zamítnutí
// — podle tvého rozhodnutí se nic nemění v produkční DB ani se neposílá
// uživatelům, dokud to neschválíš (viz supabase/functions/review-law-change).
//
// Nasazení: supabase functions deploy check-law-updates
// Secrets: žádné nové — ANTHROPIC_API_KEY se nepoužívá, ale RESEND_API_KEY
// a service role ano (stejné jako u send-reminders).

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  parseLawCode,
  fetchLatestVersionDate,
  fetchVersionFragmentPaths,
  reconstructParagraphText,
  baseParagraphNumber,
} from "../_shared/esbirka.js";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
);

const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY")!;
const RESEND_FROM = Deno.env.get("RESEND_FROM") || "Para <onboarding@resend.dev>";
const ADMIN_EMAIL = Deno.env.get("ADMIN_EMAIL")!;
// review-law-change je taky edge function, ne stránka na webu — schvalovací
// odkaz v e-mailu musí mířit sem, ne na statický web.
const FUNCTIONS_BASE = `${Deno.env.get("SUPABASE_URL")}/functions/v1`;

const MAX_LAWS_PER_RUN = 15; // ověření verze je levné (1 request/zákon); nákladná je jen rekonstrukce při reálné změně
const MAX_PARAGRAPHS_PER_BATCH = 15; // kolik paragrafů max. zkontrolovat za jedno spuštění (viz pending_paragraphs níže)

function normalize(text: string) {
  return (text || "").replace(/\s+/g, " ").trim();
}

// Poslední řádek(y) u nás uloženého chunku někdy obsahuje nadpis NÁSLEDUJÍCÍ
// části/hlavy zákona (ČÁST PRVNÍ, HLAVA II…), protože se to tak vizuálně
// nacházelo hned pod paragrafem na zdroji, ze kterého se ručně kopírovalo
// při prvotním ingestu. e-Sbírka takový nadpis počítá jako SOUROZENCE
// paragrafu, ne jeho součást, takže rekonstrukce ho správně neobsahuje —
// bez týhle očisty by to při KAŽDÉM běhu vypadalo jako "změna", i když není.
// Ověřeno živě 2026-07-31 na § 1 zákona 586/1992 Sb.
function stripTrailingHeadingLines(text: string) {
  const lines = text.split("\n");
  while (lines.length > 1) {
    const last = lines[lines.length - 1].trim();
    const isShouty = last.length > 2 && last === last.toUpperCase() && /[A-ZÁČĎÉĚÍŇÓŘŠŤÚŮÝŽ]/.test(last);
    if (isShouty) lines.pop();
    else break;
  }
  return lines.join("\n");
}

function contentsMatch(oldContent: string, reconstructed: string) {
  return normalize(stripTrailingHeadingLines(oldContent)) === normalize(stripTrailingHeadingLines(reconstructed));
}

async function sendEmail(to: string, subject: string, html: string) {
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${RESEND_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from: RESEND_FROM, to, subject, html }),
  });
  if (!res.ok) throw new Error(`Resend API error: ${res.status} ${await res.text()}`);
}

// PostgREST vrací max. 1000 řádků na dotaz, i bez explicitního .limit() —
// law_chunks jich má přes 2700, takže bez stránkování bychom viděli jen
// prvních 1000 (= náhodnou podmnožinu zákonů podle pořadí ingestu).
async function fetchAllLawChunks() {
  const pageSize = 1000;
  let offset = 0;
  const all: any[] = [];
  for (;;) {
    const { data, error } = await supabase
      .from("law_chunks")
      .select("id, law_code, law_name, section_ref, content")
      .order("id")
      .range(offset, offset + pageSize - 1);
    if (error) throw error;
    all.push(...data);
    if (data.length < pageSize) break;
    offset += pageSize;
  }
  return all;
}

Deno.serve(async (req) => {
  try {
    const allChunks = await fetchAllLawChunks();

    // Zákony, který parseLawCode nerozezná (ČÚS/NÚR standardy, ne "N/RRRR Sb."),
    // e-Sbírka je nemá — jen je zeptat, tak je přeskočit.
    const byLaw = new Map<string, typeof allChunks>();
    for (const c of allChunks) {
      if (!parseLawCode(c.law_code)) continue;
      if (!byLaw.has(c.law_code)) byLaw.set(c.law_code, []);
      byLaw.get(c.law_code)!.push(c);
    }

    const lawCodes = [...byLaw.keys()].slice(0, MAX_LAWS_PER_RUN);
    const summary: any[] = [];
    let paragraphBatchUsed = false; // zpracujeme paragrafovou dávku jen pro JEDEN zákon za běh (viz níže)

    for (const lawCode of lawCodes) {
      const chunks = byLaw.get(lawCode)!;
      const lawName = chunks[0]?.law_name || lawCode;

      const { data: versionRow } = await supabase
        .from("law_versions")
        .select("last_known_version_date, checking_version_date, pending_paragraphs")
        .eq("law_code", lawCode)
        .maybeSingle();

      const isFirstRun = !versionRow;
      const alreadyChecking = versionRow?.checking_version_date && versionRow?.pending_paragraphs?.length;

      // U zákona, který se právě dokontroluje z minula, nemá smysl volat
      // znovu fetchLatestVersionDate — držíme se verze, na kterou jsme se
      // rozjeli, ať nemícháme dva různé cíle v jedné dávce.
      const latestVersion = alreadyChecking ? versionRow.checking_version_date : await fetchLatestVersionDate(lawCode);
      if (!latestVersion) {
        summary.push({ lawCode, skipped: "no_version_found" });
        continue;
      }

      const changed = !isFirstRun && !alreadyChecking && versionRow.last_known_version_date !== latestVersion;

      if (isFirstRun) {
        await supabase
          .from("law_versions")
          .upsert({ law_code: lawCode, last_known_version_date: latestVersion, last_checked_at: new Date().toISOString() });
        summary.push({ lawCode, baseline: latestVersion });
        continue;
      }

      if (!changed && !alreadyChecking) {
        await supabase.from("law_versions").update({ last_checked_at: new Date().toISOString() }).eq("law_code", lawCode);
        continue;
      }

      // Zpracovat paragrafovou dávku umíme jen pro jeden zákon za běh (ať
      // requesty na e-Sbírku zůstanou v rozumném počtu na jedno spuštění).
      // Zákony, na které se nedostane, zůstanou "changed"/"checking" a
      // vyřídí se příští týden.
      if (paragraphBatchUsed) {
        summary.push({ lawCode, deferred: "batch_limit_reached_this_run" });
        continue;
      }
      paragraphBatchUsed = true;

      let pending = versionRow.pending_paragraphs as string[] | null;
      if (!pending) {
        // Nový detekovaný rozdíl verze — naplánovat kontrolu VŠECH paragrafů,
        // které o tomhle zákonu sledujeme.
        const allNums = new Set<string>();
        for (const c of chunks) {
          const num = baseParagraphNumber(c.section_ref);
          if (num) allNums.add(num);
        }
        pending = [...allNums];
      }

      const batch = pending.slice(0, MAX_PARAGRAPHS_PER_BATCH);
      const remaining = pending.slice(MAX_PARAGRAPHS_PER_BATCH);

      const fragmentPaths = await fetchVersionFragmentPaths(lawCode, latestVersion);
      const byParagraph = new Map<string, typeof chunks>();
      for (const c of chunks) {
        const num = baseParagraphNumber(c.section_ref);
        if (num) (byParagraph.get(num) || byParagraph.set(num, []).get(num)!).push(c);
      }

      for (const paragraphNumber of batch) {
        const paragraphChunks = byParagraph.get(paragraphNumber);
        if (!paragraphChunks) continue;

        const reconstructed = await reconstructParagraphText(lawCode, latestVersion, paragraphNumber, fragmentPaths);
        if (reconstructed === null) continue; // paragraf ve verzi nenalezen (přejmenování apod.) — mimo rozsah V1
        if (typeof reconstructed === "object") {
          console.warn(`Nespolehlivá rekonstrukce ${lawCode} § ${paragraphNumber}:`, JSON.stringify(reconstructed));
          continue; // zůstává mimo "pending" už odškrtnuté — dotáhne se to, až se zákon příště reálně změní. V1 limitace.
        }

        const oldContent = paragraphChunks
          .sort((a, b) => a.section_ref.localeCompare(b.section_ref))
          .map((c) => c.content)
          .join("\n");

        if (contentsMatch(oldContent, reconstructed)) continue; // beze změny

        const sectionRef = paragraphChunks[0].section_ref.replace(/\s*\(\d+\/\d+\)$/, "");
        const { data: inserted, error: insertError } = await supabase
          .from("law_change_events")
          .insert({
            law_code: lawCode,
            law_name: lawName,
            section_ref: sectionRef,
            chunk_ids: paragraphChunks.map((c) => c.id),
            old_version_date: versionRow.last_known_version_date,
            new_version_date: latestVersion,
            old_content: oldContent,
            new_content: reconstructed,
          })
          .select("id, review_token")
          .single();
        if (insertError) throw insertError;

        summary.push({ lawCode, sectionRef, changeEventId: inserted.id });

        if (ADMIN_EMAIL) {
          const approveUrl = `${FUNCTIONS_BASE}/review-law-change?id=${inserted.id}&token=${inserted.review_token}&action=approve`;
          const rejectUrl = `${FUNCTIONS_BASE}/review-law-change?id=${inserted.id}&token=${inserted.review_token}&action=reject`;
          await sendEmail(
            ADMIN_EMAIL,
            `Ke schválení: ${lawName} — ${sectionRef} se změnil`,
            `<div style="font-family:sans-serif;max-width:600px">
              <p><strong>${lawCode}</strong> (${lawName}) — <strong>${sectionRef}</strong></p>
              <p>Nová verze zákona účinná od ${latestVersion} (dřív ${versionRow.last_known_version_date}).</p>
              <p style="color:#92400e;background:#fffbeb;padding:8px 12px;border-radius:6px">Rozdíl nemusí být jen novela — může jít i o formátovací hranici mezi naším původním ručním ingestem a strukturou e-Sbírky, nebo o opravu chyby v datech z prvotního nahrání. Přečti si obě znění, než schválíš.</p>
              <h4>Staré znění (v databázi teď)</h4><pre style="white-space:pre-wrap;background:#f1f5f9;padding:12px;border-radius:8px">${oldContent}</pre>
              <h4>Nové znění (rekonstruováno z e-Sbírky)</h4><pre style="white-space:pre-wrap;background:#eef2ff;padding:12px;border-radius:8px">${reconstructed}</pre>
              <p><a href="${approveUrl}" style="background:#6366F1;color:#fff;padding:10px 18px;border-radius:8px;text-decoration:none;margin-right:10px">Schválit a aktualizovat</a>
              <a href="${rejectUrl}" style="color:#64748b">Zamítnout</a></p>
            </div>`
          ).catch((e) => console.error("Admin email selhal:", e.message));
        }
      }

      if (remaining.length) {
        // Dávka nestačila na celý zákon — uložit rozpracovaný stav, last_known_version_date
        // NEPOSOUVAT (jinak by se zbytek pending paragrafů už nikdy nezkontroloval).
        await supabase
          .from("law_versions")
          .update({ checking_version_date: latestVersion, pending_paragraphs: remaining, last_checked_at: new Date().toISOString() })
          .eq("law_code", lawCode);
        summary.push({ lawCode, batchProgress: `${batch.length} zkontrolováno, ${remaining.length} zbývá` });
      } else {
        await supabase
          .from("law_versions")
          .update({
            last_known_version_date: latestVersion,
            checking_version_date: null,
            pending_paragraphs: null,
            last_checked_at: new Date().toISOString(),
          })
          .eq("law_code", lawCode);
        summary.push({ lawCode, fullyChecked: latestVersion });
      }
    }

    return new Response(JSON.stringify({ ok: true, lawsChecked: lawCodes.length, summary }), {
      headers: { "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response(JSON.stringify({ ok: false, error: String(err) }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
});

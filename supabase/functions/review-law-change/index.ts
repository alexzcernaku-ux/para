// supabase/functions/review-law-change/index.ts
//
// Cíl odkazů "Schválit"/"Zamítnout" z e-mailu, který posílá check-law-updates.
// GET, ne POST — musí jít otevřít kliknutím z e-mailového klienta. Zabezpečeno
// jednorázovým review_token (UUID) vygenerovaným při vzniku události; bez
// správného tokenu nebo když už byla vyřízená, se nic neprovede.
//
// Schválení: přepíše dotčený chunk (první z chunk_ids) na nové znění,
// přepočte embedding, případné další chunk_ids (vzniklé naším dělením
// dlouhého paragrafu na "(1/2)"/"(2/2)") smaže — paragraf tím zkolabuje
// do jednoho chunku. Pak pošle notifikaci jen relevantním uživatelům
// (_shared/law-relevance.js), ne všem.
//
// Nasazení: supabase functions deploy review-law-change
// Secrety: stejné jako check-law-updates + OPENAI_API_KEY (na embedding).

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { isLawRelevantToProfile } from "../_shared/law-relevance.js";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
);

const OPENAI_KEY = Deno.env.get("OPENAI_API_KEY")!;
const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY")!;
const RESEND_FROM = Deno.env.get("RESEND_FROM") || "Para <onboarding@resend.dev>";

function page(title: string, body: string) {
  return `<!DOCTYPE html><html lang="cs"><head><meta charset="utf-8"><title>${title}</title>
  <style>body{font-family:-apple-system,sans-serif;max-width:560px;margin:60px auto;padding:0 20px;color:#0F172A}
  h1{font-size:20px}p{color:#334155;line-height:1.5}</style></head>
  <body><h1>${title}</h1>${body}</body></html>`;
}

async function embed(text: string) {
  const res = await fetch("https://api.openai.com/v1/embeddings", {
    method: "POST",
    headers: { Authorization: `Bearer ${OPENAI_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model: "text-embedding-3-small", input: text }),
  });
  if (!res.ok) throw new Error(`OpenAI embeddings error: ${res.status} ${await res.text()}`);
  const data = await res.json();
  return data.data[0].embedding;
}

async function sendEmail(to: string, subject: string, html: string) {
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${RESEND_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from: RESEND_FROM, to, subject, html }),
  });
  if (!res.ok) throw new Error(`Resend API error: ${res.status} ${await res.text()}`);
}

Deno.serve(async (req) => {
  const url = new URL(req.url);
  const id = url.searchParams.get("id");
  const token = url.searchParams.get("token");
  const action = url.searchParams.get("action");

  if (!id || !token || !["approve", "reject"].includes(action || "")) {
    return new Response(page("Chybný požadavek", "<p>Chybí id, token nebo action.</p>"), {
      status: 400,
      headers: { "Content-Type": "text/html; charset=utf-8" },
    });
  }

  try {
    const { data: event, error } = await supabase
      .from("law_change_events")
      .select("*")
      .eq("id", id)
      .single();
    if (error || !event) {
      return new Response(page("Nenalezeno", "<p>Tahle změna neexistuje.</p>"), {
        status: 404,
        headers: { "Content-Type": "text/html; charset=utf-8" },
      });
    }
    if (event.review_token !== token) {
      return new Response(page("Neplatný odkaz", "<p>Token nesedí.</p>"), {
        status: 403,
        headers: { "Content-Type": "text/html; charset=utf-8" },
      });
    }
    if (event.status !== "pending_review") {
      return new Response(
        page("Už vyřízeno", `<p>Tahle změna už má stav <strong>${event.status}</strong>, nic se znovu neprovádí.</p>`),
        { headers: { "Content-Type": "text/html; charset=utf-8" } }
      );
    }

    if (action === "reject") {
      await supabase
        .from("law_change_events")
        .update({ status: "rejected", reviewed_at: new Date().toISOString() })
        .eq("id", id);
      return new Response(
        page("Zamítnuto", `<p>Změna ${event.law_code} ${event.section_ref} byla zamítnuta — v databázi zůstává původní znění.</p>`),
        { headers: { "Content-Type": "text/html; charset=utf-8" } }
      );
    }

    // action === "approve"
    const [primaryId, ...extraIds] = event.chunk_ids as number[];
    const newEmbedding = await embed(event.new_content);

    const { error: updateError } = await supabase
      .from("law_chunks")
      .update({ content: event.new_content, embedding: newEmbedding })
      .eq("id", primaryId);
    if (updateError) throw updateError;

    if (extraIds.length) {
      // Paragraf byl u nás rozdělený na víc chunků (dlouhý text) — po
      // novele ho sloučíme do jednoho, zbylé smažeme.
      await supabase.from("law_chunks").delete().in("id", extraIds);
    }

    // Notifikace jen relevantním uživatelům (podle profilu), ne všem.
    const { data: profiles } = await supabase
      .from("profiles")
      .select("id, legal_form, vat_payer")
      .not("onboarded_at", "is", null);

    const relevant = (profiles || []).filter((p) => isLawRelevantToProfile(event.law_code, p));
    let notified = 0;
    for (const profile of relevant) {
      try {
        const { data: userData } = await supabase.auth.admin.getUserById(profile.id);
        const email = userData?.user?.email;
        if (!email) continue;
        await sendEmail(
          email,
          `Zákon se změnil: ${event.law_name} — ${event.section_ref}`,
          `<div style="font-family:-apple-system,sans-serif;max-width:480px">
            <p style="color:#6366F1;font-weight:700;font-size:12px;text-transform:uppercase">§ Para — aktualizace zákona</p>
            <h2 style="color:#0F172A">${event.law_name}, ${event.section_ref} se změnilo</h2>
            <p style="color:#334155">Nové znění je účinné od ${event.new_version_date}. Zeptejte se Para na podrobnosti — odpovídá už z aktualizovaného textu.</p>
            <p style="color:#94a3b8;font-size:12px">Para není daňové ani účetní poradenství.</p>
          </div>`
        );
        notified++;
      } catch (e) {
        console.error(`Notifikace pro ${profile.id} selhala:`, (e as Error).message);
      }
    }

    await supabase
      .from("law_change_events")
      .update({ status: "approved", reviewed_at: new Date().toISOString(), notified_user_count: notified })
      .eq("id", id);

    return new Response(
      page(
        "Schváleno a aktualizováno",
        `<p>${event.law_code} ${event.section_ref} má nové znění v databázi (embedding přepočítaný).</p>
         <p>Upozornění dostalo <strong>${notified}</strong> relevantních uživatelů z ${relevant.length} kontrolovaných.</p>`
      ),
      { headers: { "Content-Type": "text/html; charset=utf-8" } }
    );
  } catch (err) {
    return new Response(page("Chyba", `<p>${String(err)}</p>`), {
      status: 500,
      headers: { "Content-Type": "text/html; charset=utf-8" },
    });
  }
});

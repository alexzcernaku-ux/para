// supabase/functions/zakon-query/index.ts
//
// Nasazení: supabase functions deploy zakon-query
// Potřebné secrets: supabase secrets set OPENAI_API_KEY=... ANTHROPIC_API_KEY=...
// (SUPABASE_URL a SUPABASE_SERVICE_ROLE_KEY jsou v edge functions dostupné automaticky)
//
// Pozn.: Lokální 03_local_server.mjs navíc streamuje odpověď a má in-memory
// rate limiting — obojí tady záměrně chybí. Streaming přes Deno.serve jde
// (ReadableStream), ale zvyšuje složitost; rate limiting v paměti procesu
// nedává smysl, protože edge function instance nejsou perzistentní (Supabase
// má vlastní rate limiting na úrovni platformy). Feedback endpoint řešíme
// přes URL path (.../zakon-query/feedback), protože Deno.serve má jen jeden
// vstupní bod na funkci.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
);

const OPENAI_KEY = Deno.env.get("OPENAI_API_KEY")!;
const ANTHROPIC_KEY = Deno.env.get("ANTHROPIC_API_KEY")!;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Rozepíše uživatelský dotaz (+ pár posledních zpráv konverzace) na explicitní
// právní/účetní pojmy předtím, než se počítá embedding pro vektorové vyhledávání.
// Široké/složené otázky (např. "koupě auta" = DPH + odpisy + účetní zachycení)
// mají samy o sobě "rozmytý" vektor, který se nejvíc podobá spoustě povrchně
// souvisejících paragrafů místo těch skutečně relevantních.
// Sestaví krátký kontextový řádek z profilu uživatele (právní forma, plátce
// DPH...), aby ho nemusel opakovat v každém dotazu. Prázdný string, pokud
// profil není vyplněný. (Parita s profileContext() v 03_local_server.mjs.)
function profileContext(profile: { legalForm?: string; vatPayer?: boolean; note?: string } | null | undefined) {
  if (!profile) return "";
  const parts: string[] = [];
  if (profile.legalForm) parts.push(profile.legalForm);
  if (profile.vatPayer === true) parts.push("plátce DPH");
  if (profile.vatPayer === false) parts.push("neplátce DPH");
  if (profile.note) parts.push(profile.note);
  return parts.length ? `Kontext o uživateli: ${parts.join(", ")}.` : "";
}

async function expandQuery(
  question: string,
  history: { role: string; content: string }[],
  profile?: { legalForm?: string; vatPayer?: boolean; note?: string } | null
) {
  const historyText = (history || [])
    .slice(-4)
    .map((m) => `${m.role === "user" ? "Uživatel" : "Asistent"}: ${m.content}`)
    .join("\n");
  const profileLine = profileContext(profile);

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": ANTHROPIC_KEY,
      "anthropic-version": "2023-06-01",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 300,
      system: `Rozšiř účetní/daňový dotaz pro účely vektorového vyhledávání v databázi
českých zákonů, Českých účetních standardů a interpretací NÚR. Přidej explicitní
právní a účetní pojmy, typické názvy institutů a čísla paragrafů, pokud je znáš
(daň z příjmů, DPH, odpisy, dlouhodobý majetek, účtové skupiny apod.), související
témata z více oblastí (daň z příjmů, DPH, účetnictví), pokud se dotazu týkají.
${historyText ? "Zohledni i kontext předchozí konverzace níže, pokud se na něj dotaz odkazuje." : ""}
${profileLine}
Vrať POUZE rozšířený text (pár vět, ne odpověď na dotaz), žádné vysvětlení ani úvod.`,
      messages: [
        { role: "user", content: historyText ? `${historyText}\n\nNový dotaz: ${question}` : question },
      ],
    }),
  });
  if (!res.ok) throw new Error(`Anthropic API error (expand): ${res.status} ${await res.text()}`);
  const data = await res.json();
  const textBlock = data.content?.find((b: any) => b.type === "text");
  return textBlock?.text ?? question;
}

async function embedQuery(text: string) {
  const res = await fetch("https://api.openai.com/v1/embeddings", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${OPENAI_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ model: "text-embedding-3-small", input: text }),
  });
  const data = await res.json();
  return data.data[0].embedding;
}

const SYSTEM_PROMPT = `Jsi asistent pro české účetní a daňové právo pro účetní a studenty, kteří
chtějí rychlou prakticky použitelnou odpověď — ne esej. Cíl: odpověď přečtená za cca 20 sekund.

FORMÁT ODPOVĚDI (drž se ho vždy, není to volitelné):
1. Nejdřív rovnou samotná odpověď v 1–2 řádcích. Jde-li o účtování, hned předkontace v notaci
   "MD účet / D účet" (např. "MD 501 / D 321"), případně krátce obě varianty způsobu A/B. Jde-li
   o jinou otázku (sazba, lhůta, limit...), rovnou konkrétní číslo/odpověď, ne odstavec kolem.
2. Pak 2–4 věty vysvětlení — proč, s odkazem na paragraf/standard (stačí v závorce nebo jako
   součást věty, ne jako samostatná sekce citací).
3. Pokud existují relevantní výjimky nebo navazující témata (jiná právní forma, DPH, vlastní
   spotřeba, jiná odpisová skupina...), zmiň je JEDNOU VĚTOU jako nabídku k doptání — nerozepisuj
   je rovnou do plné šířky. Uživatel se doptá, pokud to potřebuje ("A co když jsme s.r.o.?").

Nepiš dlouhé strukturované texty s mnoha nadpisy a odrážkami, pokud se na to uživatel výslovně
nezeptal nebo pokud otázka sama vyžaduje srovnání více scénářů vedle sebe (např. výslovně "jaké
jsou všechny možnosti"). Krátká přímá odpověď je vždy lepší než vyčerpávající přehled.

Odpovídej výhradně na základě poskytnutých úryvků zákonů, Českých účetních standardů a interpretací
NÚR níže. Pokud odpověď v úryvcích není, jasně řekni, že to z dostupných podkladů nelze určit, a
doporuč konzultaci s daňovým poradcem nebo účetním. Nikdy si nevymýšlej čísla paragrafů.

U otázek typu "jak se to zaúčtuje" smíš SYNTETIZOVAT typický postup účtování (předkontace) kombinací
více poskytnutých zdrojů najednou (např. směrná účtová osnova z vyhlášky 500/2002 + popis postupu
z Českého účetního standardu) — jasně to odliš jako odvozený/typický postup, ne jako doslovnou citaci
jednoho paragrafu, a uveď, ze kterých konkrétních zdrojů kombinaci skládáš.`;

async function handleFeedback(req: Request): Promise<Response> {
  try {
    const { question, answer, rating, sources } = await req.json();
    if (!question || !answer || !["up", "down"].includes(rating)) {
      return new Response(JSON.stringify({ error: "Chybí question/answer/rating (up|down)." }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const { error } = await supabase.from("feedback").insert({ question, answer, rating, sources });
    if (error) throw error;
    return new Response(JSON.stringify({ ok: true }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const url = new URL(req.url);
  if (url.pathname.endsWith("/feedback")) {
    return handleFeedback(req);
  }

  try {
    const { question, history, profile } = await req.json();
    if (!question || typeof question !== "string") {
      return new Response(JSON.stringify({ error: "Chybí 'question' v těle požadavku." }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // 1) Rozšíření dotazu a embedding
    const expanded = await expandQuery(question, history, profile);
    const queryEmbedding = await embedQuery(expanded);

    // 2) Vektorové vyhledání relevantních paragrafů
    const { data: matches, error } = await supabase.rpc("match_law_chunks", {
      query_embedding: queryEmbedding,
      match_count: 15,
    });
    if (error) throw error;

    // 3) Sestavení kontextu pro Claude
    const context = matches
      .map((m: any) => `[${m.law_name}, ${m.section_ref ?? ""}]\n${m.content}`)
      .join("\n\n---\n\n");

    // 4) Volání Claude API (s historií konverzace pro navazující dotazy)
    const messages = [
      ...(history || []).slice(-6).map((m: any) => ({ role: m.role, content: m.content })),
      { role: "user", content: question },
    ];
    const profileLine = profileContext(profile);

    const claudeRes = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": ANTHROPIC_KEY,
        "anthropic-version": "2023-06-01",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "claude-sonnet-5",
        max_tokens: 4096,
        system: `${SYSTEM_PROMPT}${profileLine ? `\n\n${profileLine}` : ""}\n\nRELEVANTNÍ ÚRYVKY ZÁKONŮ:\n${context}`,
        messages,
      }),
    });
    const claudeData = await claudeRes.json();
    const answer = claudeData.content?.find((b: any) => b.type === "text")?.text ?? "Nepodařilo se získat odpověď.";

    return new Response(
      JSON.stringify({
        answer,
        sources: matches.map((m: any) => ({
          law_name: m.law_name,
          section_ref: m.section_ref,
          source_url: m.source_url,
          similarity: m.similarity,
          snippet: m.content.length > 500 ? m.content.slice(0, 500) + "…" : m.content,
        })),
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

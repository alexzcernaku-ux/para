// Lokální náhrada za supabase/functions/zakon-query/index.ts (Deno edge function),
// aby šlo RAG API otestovat na localhost bez nasazování do Supabase.
// Spuštění: node 03_local_server.mjs
// Potřebuje v .env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, OPENAI_API_KEY, ANTHROPIC_API_KEY
//
// Protokol odpovědi: NDJSON (řádky oddělené \n), streamované postupně:
//   {"type":"sources","data":[...]}
//   {"type":"delta","text":"..."}   (opakovaně)
//   {"type":"done","usage":{...}}
//   {"type":"error","message":"..."}

import { createServer } from "http";

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const OPENAI_KEY = process.env.OPENAI_API_KEY;
const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY;
const PORT = process.env.PORT || 8787;

if (!SUPABASE_URL || !SUPABASE_KEY || !OPENAI_KEY || !ANTHROPIC_KEY) {
  console.error("Chybí SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY / OPENAI_API_KEY / ANTHROPIC_API_KEY v env.");
  process.exit(1);
}

// Orientační ceny za MTok (miliony tokenů), pro hrubý odhad nákladu na dotaz v logu.
// Sonnet 5 má do 2026-08-31 zaváděcí cenu — po tomto datu zdraží na $3/$15.
const PRICING = {
  "claude-sonnet-5": { in: 2.0, out: 10.0 },
  "claude-haiku-4-5-20251001": { in: 1.0, out: 5.0 },
  "text-embedding-3-small": { in: 0.02, out: 0 },
};

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

// --- Jednoduchý rate limiting v paměti: max N dotazů za okno na IP ---
const RATE_LIMIT_MAX = 20;
const RATE_LIMIT_WINDOW_MS = 5 * 60 * 1000; // 5 minut
const rateLimitLog = new Map(); // ip -> [timestampy]

function checkRateLimit(ip) {
  const now = Date.now();
  const timestamps = (rateLimitLog.get(ip) || []).filter((t) => now - t < RATE_LIMIT_WINDOW_MS);
  if (timestamps.length >= RATE_LIMIT_MAX) return false;
  timestamps.push(now);
  rateLimitLog.set(ip, timestamps);
  return true;
}

function estimateCost(model, inputTokens, outputTokens) {
  const p = PRICING[model];
  if (!p) return null;
  return (inputTokens / 1_000_000) * p.in + (outputTokens / 1_000_000) * p.out;
}

// Rozepíše uživatelský dotaz (+ pár posledních zpráv konverzace) na explicitní
// právní/účetní pojmy předtím, než se počítá embedding pro vektorové vyhledávání.
// Široké/složené otázky (např. "koupě auta" = DPH + odpisy + účetní zachycení)
// mají samy o sobě "rozmytý" vektor, který se nejvíc podobá spoustě povrchně
// souvisejících paragrafů místo těch skutečně relevantních.
// Sestaví krátký kontextový řádek z profilu uživatele (právní forma, plátce
// DPH...), aby ho nemusel opakovat v každém dotazu. Prázdný string, pokud
// profil není vyplněný.
function profileContext(profile) {
  if (!profile) return "";
  const parts = [];
  if (profile.legalForm) parts.push(profile.legalForm);
  if (profile.vatPayer === true) parts.push("plátce DPH");
  if (profile.vatPayer === false) parts.push("neplátce DPH");
  if (profile.note) parts.push(profile.note);
  return parts.length ? `Kontext o uživateli: ${parts.join(", ")}.` : "";
}

async function expandQuery(question, history, profile) {
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
  const textBlock = data.content?.find((b) => b.type === "text");
  return textBlock?.text ?? question;
}

async function embedQuery(text) {
  const res = await fetch("https://api.openai.com/v1/embeddings", {
    method: "POST",
    headers: { "Authorization": `Bearer ${OPENAI_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model: "text-embedding-3-small", input: text }),
  });
  if (!res.ok) throw new Error(`OpenAI embeddings error: ${res.status} ${await res.text()}`);
  const data = await res.json();
  return { embedding: data.data[0].embedding, tokens: data.usage?.total_tokens ?? 0 };
}

async function matchLawChunks(queryEmbedding, matchCount = 15) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/match_law_chunks`, {
    method: "POST",
    headers: {
      "apikey": SUPABASE_KEY,
      "Authorization": `Bearer ${SUPABASE_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ query_embedding: queryEmbedding, match_count: matchCount }),
  });
  if (!res.ok) throw new Error(`Supabase RPC error: ${res.status} ${await res.text()}`);
  return res.json();
}

// --- Přímé prohlížení zákonů (bez LLM) — pro režim "otevři a přečti si § X" ---
async function listLaws() {
  const keys = new Set();
  const laws = [];
  let offset = 0;
  const pageSize = 1000;
  for (;;) {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/law_chunks?select=law_code,law_name&order=id&limit=${pageSize}&offset=${offset}`,
      { headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` } }
    );
    if (!res.ok) throw new Error(`Supabase select error: ${res.status} ${await res.text()}`);
    const rows = await res.json();
    for (const row of rows) {
      const key = row.law_code;
      if (!keys.has(key)) {
        keys.add(key);
        laws.push({ law_code: row.law_code, law_name: row.law_name });
      }
    }
    if (rows.length < pageSize) break;
    offset += pageSize;
  }
  laws.sort((a, b) => a.law_name.localeCompare(b.law_name, "cs"));
  return laws;
}

async function browseLaw(lawCode) {
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/law_chunks?select=section_ref,content&law_code=eq.${encodeURIComponent(lawCode)}&order=id`,
    { headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` } }
  );
  if (!res.ok) throw new Error(`Supabase select error: ${res.status} ${await res.text()}`);
  return res.json();
}

async function insertFeedback({ question, answer, rating, sources }) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/feedback`, {
    method: "POST",
    headers: {
      "apikey": SUPABASE_KEY,
      "Authorization": `Bearer ${SUPABASE_KEY}`,
      "Content-Type": "application/json",
      "Prefer": "return=minimal",
    },
    body: JSON.stringify({ question, answer, rating, sources }),
  });
  if (!res.ok) throw new Error(`Supabase feedback insert error: ${res.status} ${await res.text()}`);
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

async function askClaudeStream(question, context, history, profile, onDelta) {
  const messages = [
    ...(history || []).slice(-6).map((m) => ({ role: m.role, content: m.content })),
    { role: "user", content: question },
  ];
  const profileLine = profileContext(profile);

  const res = await fetch("https://api.anthropic.com/v1/messages", {
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
      stream: true,
    }),
  });
  if (!res.ok) throw new Error(`Anthropic API error: ${res.status} ${await res.text()}`);

  let usage = { input_tokens: 0, output_tokens: 0 };
  let buffer = "";
  for await (const chunk of res.body) {
    // res.body je Web ReadableStream — chunk je Uint8Array, ne Node Buffer.
    // Uint8Array.toString("utf-8") encoding tiše ignoruje a vrátí bajty
    // oddělené čárkami, proto musíme dekódovat přes Buffer.from().
    buffer += Buffer.from(chunk).toString("utf-8");
    const lines = buffer.split("\n");
    buffer = lines.pop(); // nedokončený řádek si necháme na příště
    for (const line of lines) {
      if (!line.startsWith("data: ")) continue;
      const payload = line.slice(6).trim();
      if (!payload || payload === "[DONE]") continue;
      let event;
      try {
        event = JSON.parse(payload);
      } catch {
        continue;
      }
      if (event.type === "content_block_delta" && event.delta?.type === "text_delta") {
        onDelta(event.delta.text);
      } else if (event.type === "message_start") {
        usage.input_tokens = event.message?.usage?.input_tokens ?? 0;
      } else if (event.type === "message_delta") {
        usage.output_tokens = event.usage?.output_tokens ?? usage.output_tokens;
      }
    }
  }
  return usage;
}

const server = createServer(async (req, res) => {
  if (req.method === "OPTIONS") {
    res.writeHead(204, corsHeaders);
    return res.end();
  }

  const ip = req.socket.remoteAddress || "unknown";
  const reqUrl = new URL(req.url, `http://${req.headers.host}`);

  if (reqUrl.pathname === "/laws" && req.method === "GET") {
    try {
      const laws = await listLaws();
      res.writeHead(200, { ...corsHeaders, "Content-Type": "application/json" });
      res.end(JSON.stringify(laws));
    } catch (err) {
      res.writeHead(500, { ...corsHeaders, "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: err.message }));
    }
    return;
  }

  if (reqUrl.pathname === "/browse" && req.method === "GET") {
    try {
      const lawCode = reqUrl.searchParams.get("law_code");
      if (!lawCode) throw new Error("Chybí parametr law_code.");
      const chunks = await browseLaw(lawCode);
      res.writeHead(200, { ...corsHeaders, "Content-Type": "application/json" });
      res.end(JSON.stringify(chunks));
    } catch (err) {
      res.writeHead(500, { ...corsHeaders, "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: err.message }));
    }
    return;
  }

  if (reqUrl.pathname === "/feedback" && req.method === "POST") {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", async () => {
      try {
        const { question, answer, rating, sources } = JSON.parse(body || "{}");
        if (!question || !answer || !["up", "down"].includes(rating)) {
          res.writeHead(400, { ...corsHeaders, "Content-Type": "application/json" });
          return res.end(JSON.stringify({ error: "Chybí question/answer/rating (up|down)." }));
        }
        await insertFeedback({ question, answer, rating, sources });
        console.log(`  ${rating === "up" ? "👍" : "👎"} feedback uložen`);
        res.writeHead(200, { ...corsHeaders, "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: true }));
      } catch (err) {
        console.error("✗ feedback:", err.message);
        res.writeHead(500, { ...corsHeaders, "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: err.message }));
      }
    });
    return;
  }

  if (req.method !== "POST") {
    res.writeHead(405, { ...corsHeaders, "Content-Type": "application/json" });
    return res.end(JSON.stringify({ error: "Pouze POST." }));
  }

  if (!checkRateLimit(ip)) {
    res.writeHead(429, { ...corsHeaders, "Content-Type": "application/json" });
    return res.end(JSON.stringify({ error: "Příliš mnoho dotazů, zkus to za chvíli znovu." }));
  }

  let body = "";
  req.on("data", (c) => (body += c));
  req.on("end", async () => {
    // NDJSON streamovací odpověď
    res.writeHead(200, { ...corsHeaders, "Content-Type": "application/x-ndjson" });
    const send = (obj) => res.write(JSON.stringify(obj) + "\n");

    try {
      const { question, history, profile } = JSON.parse(body || "{}");
      if (!question || typeof question !== "string") {
        send({ type: "error", message: "Chybí 'question' v těle požadavku." });
        return res.end();
      }

      console.log(`→ Dotaz: ${question}`);
      const expanded = await expandQuery(question, history, profile);
      console.log(`  Rozšířeno na: ${expanded.slice(0, 200)}${expanded.length > 200 ? "…" : ""}`);

      const { embedding, tokens: embedTokens } = await embedQuery(expanded);
      const matches = await matchLawChunks(embedding, 15);
      console.log(`  Nalezeno ${matches.length} relevantních úryvků.`);

      const sources = matches.map((m) => ({
        law_name: m.law_name,
        section_ref: m.section_ref,
        source_url: m.source_url,
        similarity: m.similarity,
        // krátký náhled skutečného textu — přesnější než odkaz na celý dokument,
        // protože e-sbirka.gov.cz nepodporuje kotvy na konkrétní paragraf
        snippet: m.content.length > 500 ? m.content.slice(0, 500) + "…" : m.content,
      }));
      send({ type: "sources", data: sources });

      const context = matches
        .map((m) => `[${m.law_name}, ${m.section_ref ?? ""}]\n${m.content}`)
        .join("\n\n---\n\n");

      let fullAnswer = "";
      const usage = await askClaudeStream(question, context, history, profile, (delta) => {
        fullAnswer += delta;
        send({ type: "delta", text: delta });
      });

      const embedCost = estimateCost("text-embedding-3-small", embedTokens, 0) ?? 0;
      const haikuCost = estimateCost("claude-haiku-4-5-20251001", 200, 100) ?? 0; // hrubý odhad expand kroku
      const sonnetCost = estimateCost("claude-sonnet-5", usage.input_tokens, usage.output_tokens) ?? 0;
      const totalCost = embedCost + haikuCost + sonnetCost;
      console.log(
        `  💰 odhad nákladu: $${totalCost.toFixed(4)} (sonnet in=${usage.input_tokens} out=${usage.output_tokens}, embed tok=${embedTokens})`
      );

      send({ type: "done", usage: { ...usage, embedTokens, estimatedCostUsd: totalCost } });
      res.end();
    } catch (err) {
      console.error("✗", err.message);
      try {
        send({ type: "error", message: err.message });
      } catch {}
      res.end();
    }
  });
});

server.listen(PORT, () => {
  console.log(`Lokální RAG server běží na http://localhost:${PORT}`);
});

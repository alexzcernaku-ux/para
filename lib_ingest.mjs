// Sdílené funkce pro ingest skripty (02_ingest.mjs pro zákony, 04_ingest_docs.mjs
// pro ČÚS/interpretace NÚR) — embeddings, insert do Supabase, kontrola duplicit,
// rozdělení příliš dlouhého textu.

export const SUPABASE_URL = process.env.SUPABASE_URL;
export const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY; // service_role, ne anon!
export const OPENAI_KEY = process.env.OPENAI_API_KEY;

if (!SUPABASE_URL || !SUPABASE_KEY || !OPENAI_KEY) {
  console.error("Chybí SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY / OPENAI_API_KEY v env.");
  process.exit(1);
}

// Konzervativní limit na znaky na jeden embeddings vstup (OpenAI limit je 8192
// tokenů; u českého textu s diakritikou vychází bezpečně kolem 6000 znaků).
export const MAX_CHUNK_CHARS = 6000;

// Rozdělí dlouhý text na menší kousky podél přirozených hranic (odstavce
// "(N)", položky výčtu "a)"), a teprve když to nejde, natvrdo podle délky na
// hranici řádku.
export function splitLongPart(text, maxChars) {
  if (text.length <= maxChars) return [text];

  let pieces = text.split(/\n(?=\(\d+[a-z]?\)\s*\n)/g);
  if (pieces.length === 1) pieces = text.split(/\n(?=[a-z]\d*\)\s*\n)/g);

  if (pieces.length === 1) {
    const hardSplit = [];
    let rest = text;
    while (rest.length > maxChars) {
      let cut = rest.lastIndexOf("\n", maxChars);
      if (cut <= 0) cut = maxChars;
      hardSplit.push(rest.slice(0, cut).trim());
      rest = rest.slice(cut).trim();
    }
    if (rest) hardSplit.push(rest);
    return hardSplit.filter(Boolean);
  }

  const grouped = [];
  let current = "";
  for (const piece of pieces) {
    if (current && current.length + piece.length + 1 > maxChars) {
      grouped.push(current);
      current = piece;
    } else {
      current = current ? current + "\n" + piece : piece;
    }
  }
  if (current) grouped.push(current);

  return grouped.flatMap(g => (g.length > maxChars ? splitLongPart(g, maxChars) : g));
}

export async function embed(text) {
  const res = await fetch("https://api.openai.com/v1/embeddings", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${OPENAI_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ model: "text-embedding-3-small", input: text }),
  });
  if (!res.ok) throw new Error(`OpenAI embeddings error: ${res.status} ${await res.text()}`);
  const data = await res.json();
  return data.data[0].embedding;
}

export async function insertChunk(chunk, embedding) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/law_chunks`, {
    method: "POST",
    headers: {
      "apikey": SUPABASE_KEY,
      "Authorization": `Bearer ${SUPABASE_KEY}`,
      "Content-Type": "application/json",
      "Prefer": "return=minimal",
    },
    body: JSON.stringify({
      law_code: chunk.lawCode,
      law_name: chunk.lawName,
      section_ref: chunk.sectionRef,
      content: chunk.content,
      source_url: chunk.sourceUrl,
      embedding,
    }),
  });
  if (!res.ok) throw new Error(`Supabase insert error: ${res.status} ${await res.text()}`);
}

export async function loadExistingKeys() {
  const keys = new Set();
  const pageSize = 1000;
  let offset = 0;
  for (;;) {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/law_chunks?select=law_code,section_ref&order=id&limit=${pageSize}&offset=${offset}`,
      { headers: { "apikey": SUPABASE_KEY, "Authorization": `Bearer ${SUPABASE_KEY}` } }
    );
    if (!res.ok) throw new Error(`Supabase select error: ${res.status} ${await res.text()}`);
    const rows = await res.json();
    for (const row of rows) keys.add(`${row.law_code} ${row.section_ref}`);
    if (rows.length < pageSize) break;
    offset += pageSize;
  }
  return keys;
}

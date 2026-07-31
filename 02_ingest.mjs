// ingest.mjs
// Spuštění: node 02_ingest.mjs
//
// Co dělá:
// 1) Přečte všechny .txt soubory ve složce ./laws
// 2) Rozseká je podle "§ N" na jednotlivé paragrafy
// 3) Pro každý paragraf vyrobí embedding (OpenAI text-embedding-3-small)
// 4) Nahraje vše do Supabase tabulky law_chunks
//
// Potřebuješ v prostředí (nebo .env) nastavit:
//   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, OPENAI_API_KEY

import { readdir, readFile } from "fs/promises";
import path from "path";
import { MAX_CHUNK_CHARS, splitLongPart, embed, insertChunk, loadExistingKeys } from "./lib_ingest.mjs";

const LAWS_DIR = path.join(process.cwd(), "laws");

function parseLawFile(raw) {
  const lines = raw.split("\n");
  let lawCode = "", lawName = "", sourceUrl = "";
  let bodyStart = 0;

  for (let i = 0; i < lines.length; i++) {
    if (lines[i].startsWith("ZÁKON:")) lawCode = lines[i].replace("ZÁKON:", "").trim();
    else if (lines[i].startsWith("NAZEV:")) lawName = lines[i].replace("NAZEV:", "").trim();
    else if (lines[i].startsWith("URL:")) { sourceUrl = lines[i].replace("URL:", "").trim(); bodyStart = i + 1; }
  }

  const body = lines.slice(bodyStart).join("\n");
  // Rozdělení podle "§ číslo" na začátku řádku — ale jen pokud je "§ N" samo na
  // celém řádku (skutečný začátek paragrafu), ne když za ním následuje další
  // text na stejném řádku (to bývá citace v poznámce pod čarou, např.
  // "§ 657 a násl. občanského zákoníku.")
  const parts = body.split(/\n(?=§\s*\d+[a-z]?\s*\n)/g).map(p => p.trim()).filter(Boolean);

  const chunks = [];
  for (const part of parts) {
    const match = part.match(/^§\s*(\d+[a-z]?)/);
    const sectionRef = match ? `§ ${match[1]}` : null;
    const pieces = splitLongPart(part, MAX_CHUNK_CHARS);
    pieces.forEach((piece, i) => {
      const ref = pieces.length > 1 ? `${sectionRef} (${i + 1}/${pieces.length})` : sectionRef;
      chunks.push({ lawCode, lawName, sourceUrl, sectionRef: ref, content: piece });
    });
  }
  return chunks;
}

async function main() {
  const files = (await readdir(LAWS_DIR)).filter(f => f.endsWith(".txt"));
  console.log(`Nalezeno ${files.length} souborů zákonů.`);

  const existing = await loadExistingKeys();
  console.log(`V Supabase už existuje ${existing.size} paragrafů (budou přeskočeny).`);

  for (const file of files) {
    const raw = await readFile(path.join(LAWS_DIR, file), "utf-8");
    const chunks = parseLawFile(raw);
    console.log(`${file}: ${chunks.length} paragrafů`);

    for (const chunk of chunks) {
      if (chunk.content.length < 20) continue; // přeskočit prázdné/nesmyslné kousky
      const key = `${chunk.lawCode} ${chunk.sectionRef}`;
      if (existing.has(key)) {
        console.log(`  ⏭ ${chunk.sectionRef || "?"} (už existuje)`);
        continue;
      }
      try {
        const embedding = await embed(chunk.content);
        await insertChunk(chunk, embedding);
        existing.add(key);
        console.log(`  ✓ ${chunk.sectionRef || "?"}`);
      } catch (err) {
        console.error(`  ✗ ${chunk.sectionRef || "?"}:`, err.message);
      }
      // malá pauza, ať nenarazíš na rate limit
      await new Promise(r => setTimeout(r, 200));
    }
  }
  console.log("Hotovo.");
}

main();

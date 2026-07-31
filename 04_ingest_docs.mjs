// 04_ingest_docs.mjs
// Spuštění: node 04_ingest_docs.mjs
//
// Ingest pro dokumenty, které NEMAJÍ strukturu "§ N" (na rozdíl od zákonů
// v ./laws zpracovávaných 02_ingest.mjs) — České účetní standardy (./laws/cus)
// a interpretace Národní účetní rady (./laws/nur). Celý dokument se bere jako
// jedna jednotka a dělí se jen podle délky (kvůli limitu embeddings), nikdy
// podle "§", protože i tyhle dokumenty běžně obsahují citace typu "§ 25 zákona"
// na začátku řádku (kvůli zalomení textu z PDF), což by při naivním dělení
// podle "§ N" fragmentovalo obsah stejně jako u zákonů před opravou.
//
// Potřebuješ v prostředí (nebo .env) nastavit:
//   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, OPENAI_API_KEY

import { readdir, readFile } from "fs/promises";
import path from "path";
import { MAX_CHUNK_CHARS, splitLongPart, embed, insertChunk, loadExistingKeys } from "./lib_ingest.mjs";

const DIRS = [
  path.join(process.cwd(), "laws", "cus"),
  path.join(process.cwd(), "laws", "nur"),
];

function parseDocFile(raw) {
  const lines = raw.split("\n");
  let lawCode = "", lawName = "", sourceUrl = "";
  let bodyStart = 0;

  for (let i = 0; i < lines.length; i++) {
    if (lines[i].startsWith("ZÁKON:")) lawCode = lines[i].replace("ZÁKON:", "").trim();
    else if (lines[i].startsWith("NAZEV:")) lawName = lines[i].replace("NAZEV:", "").trim();
    else if (lines[i].startsWith("URL:")) { sourceUrl = lines[i].replace("URL:", "").trim(); bodyStart = i + 1; }
  }

  const body = lines.slice(bodyStart).join("\n").trim();
  const pieces = splitLongPart(body, MAX_CHUNK_CHARS);

  return pieces.map((piece, i) => ({
    lawCode,
    lawName,
    sourceUrl,
    sectionRef: pieces.length > 1 ? `část ${i + 1}/${pieces.length}` : "celý text",
    content: piece,
  }));
}

async function main() {
  const existing = await loadExistingKeys();
  console.log(`V Supabase už existuje ${existing.size} položek (budou přeskočeny).`);

  for (const dir of DIRS) {
    const files = (await readdir(dir)).filter(f => f.endsWith(".txt"));
    console.log(`\n${dir}: ${files.length} souborů.`);

    for (const file of files) {
      const raw = await readFile(path.join(dir, file), "utf-8");
      const chunks = parseDocFile(raw);
      console.log(`${file}: ${chunks.length} část(í)`);

      for (const chunk of chunks) {
        if (chunk.content.length < 20) continue;
        const key = `${chunk.lawCode} ${chunk.sectionRef}`;
        if (existing.has(key)) {
          console.log(`  ⏭ ${chunk.sectionRef} (už existuje)`);
          continue;
        }
        try {
          const embedding = await embed(chunk.content);
          await insertChunk(chunk, embedding);
          existing.add(key);
          console.log(`  ✓ ${chunk.sectionRef}`);
        } catch (err) {
          console.error(`  ✗ ${chunk.sectionRef}:`, err.message);
        }
        await new Promise(r => setTimeout(r, 200));
      }
    }
  }
  console.log("\nHotovo.");
}

main();

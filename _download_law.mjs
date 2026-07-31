// Stáhne text zákona z e-sbirka.gov.cz a uloží do laws/{cislo}-{rok}-{slug}.txt
// Použití: node _download_law.mjs <rok> <cislo> <slug> "<název zákona>" [waitMs]

import { chromium } from "playwright";
import { writeFile, mkdir } from "fs/promises";
import path from "path";

const [rok, cislo, slug, nazev, waitMsArg] = process.argv.slice(2);
if (!rok || !cislo || !slug || !nazev) {
  console.error("Použití: node _download_law.mjs <rok> <cislo> <slug> \"<název>\" [waitMs]");
  process.exit(1);
}
const waitMs = waitMsArg ? parseInt(waitMsArg, 10) : 4000;
const url = `https://e-sbirka.gov.cz/sb/${rok}/${cislo}`;
const outPath = path.join(process.cwd(), "laws", `${cislo}-${rok}-${slug}.txt`);

async function run() {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  console.log(`→ Otevírám ${url} (čekání na vykreslení: ${waitMs}ms)`);
  await page.goto(url, { waitUntil: "networkidle", timeout: 60000 });
  await page.waitForTimeout(waitMs);

  const mainText = await page.evaluate(() => {
    const el = document.querySelector("main");
    return el ? el.innerText : "";
  });

  if (!mainText || mainText.length < 500) {
    console.error(`✗ Stránka vypadá prázdná (délka ${mainText.length}). Zkus vyšší waitMs.`);
    await browser.close();
    process.exit(2);
  }

  const re = /\n(\d+[a-z]?)\n(ZÁKON|VYHLÁŠKA|ZÁKONNÉ OPATŘENÍ SENÁTU|ÚSTAVNÍ ZÁKON|NAŘÍZENÍ VLÁDY)\n/;
  const m = mainText.match(re);

  if (!m) {
    console.error("✗ Nenašel jsem začátek normativního textu (vzorec 'ČÍSLO\\nZÁKON/VYHLÁŠKA'). Ukládám debug dump a končím.");
    await mkdir(path.join(process.cwd(), "laws"), { recursive: true });
    await writeFile(outPath + ".DEBUG.txt", mainText, "utf-8");
    await browser.close();
    process.exit(3);
  }

  if (m[1] !== String(cislo)) {
    console.error(`✗ Nalezené číslo předpisu (${m[1]}) neodpovídá očekávanému (${cislo}). Možná špatná URL/přesměrování.`);
    await browser.close();
    process.exit(4);
  }

  const body = mainText.slice(m.index).trim();

  if (!/§\s*1\b/.test(body.slice(0, 3000))) {
    console.error("✗ V úvodu textu nevidím '§ 1' — obsah může být neúplný.");
    await browser.close();
    process.exit(5);
  }

  const paragraphCount = (body.match(/\n§\s*\d+[a-z]?\b/g) || []).length;
  console.log(`  Nalezeno přibližně ${paragraphCount} paragrafů, délka textu ${body.length} znaků.`);

  if (paragraphCount < 1 || body.length < 1000) {
    console.error("✗ Podezřele málo obsahu — nepokračuji s uložením.");
    await browser.close();
    process.exit(6);
  }

  const header = `ZÁKON: ${cislo}/${rok} Sb.\nNAZEV: ${nazev}\nURL: ${url}\n\n`;
  await mkdir(path.join(process.cwd(), "laws"), { recursive: true });
  await writeFile(outPath, header + body + "\n", "utf-8");
  console.log(`✓ Uloženo: ${outPath} (${(header + body).length} znaků, ~${paragraphCount} paragrafů)`);

  await browser.close();
}

run().catch(async (err) => {
  console.error("✗ Chyba:", err.message);
  process.exit(10);
});

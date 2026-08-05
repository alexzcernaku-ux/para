// Klient pro veřejné Linked Data API e-Sbírky (opendata.eselpoint.gov.cz).
// Ne oficiálně zdokumentované jako "veřejné REST API" (to vyžaduje registraci
// přes datovou zprávu na MV) - tohle je jejich open-data/LOD endpoint,
// content-negotiation přes Accept: application/ld+json, bez auth.
//
// Ověřeno ručně (2026-07-31) na zákonu 235/2004 Sb.: rekonstruovaný text
// § 29 odpovídal znak po znaku textu už uloženému v law_chunks.
//
// Struktura: právní akt → má-poslední-znění (datovaná verze) → má-fragment-znění
// (plochý seznam ELI cest ke KAŽDÉMU uzlu, včetně odstavců a písmen) → každý
// uzel má metadata (mj. obsahuje-fragment → jiné ID) → to ID nese samotný text
// (text-fragmentu, obalený v <var>…</var> u číslování/označení).

const BASE = "https://opendata.eselpoint.gov.cz/esel-esb";
const HEADERS = { Accept: "application/ld+json", "User-Agent": "Para/1.0 (para-app; kontrola novel zakonu)" };

// e-Sbírka API je nezdokumentované a v praxi se ukázalo příležitostně
// nespolehlivé (ojedinělý fetch v dávce vrátí prázdný/vadný obsah bez
// chyby na úrovni HTTP) - 2 opakování s krátkou prodlevou tohle v praxi
// spolehlivě přebijí, viz poznámka u reconstructParagraphText.
async function getJsonLd(path, attempt = 1) {
  const res = await fetch(`${BASE}/${path}`, { headers: HEADERS });
  if (!res.ok) {
    if (attempt < 3) {
      await new Promise((r) => setTimeout(r, 300 * attempt));
      return getJsonLd(path, attempt + 1);
    }
    throw new Error(`e-Sbírka API ${res.status} pro ${path}`);
  }
  return res.json();
}

// "235/2004 Sb." -> { rok: "2004", cislo: "235" }
export function parseLawCode(lawCode) {
  const m = lawCode.match(/^(\d+)\/(\d{4})\s*Sb\.?$/);
  if (!m) return null;
  return { cislo: m[1], rok: m[2] };
}

// Vrátí datum poslední platné konsolidované verze zákona, např. "2026-01-01".
export async function fetchLatestVersionDate(lawCode) {
  const parsed = parseLawCode(lawCode);
  if (!parsed) return null;
  const data = await getJsonLd(`eli/cz/sb/${parsed.rok}/${parsed.cislo}`);
  const uri = data["má-poslední-znění"];
  if (!uri) return null;
  const m = uri.match(/(\d{4}-\d{2}-\d{2})$/);
  return m ? m[1] : null;
}

// Vrátí plochý seznam všech fragmentových cest dané datované verze
// (desítky až tisíce položek, jeden fetch na celý zákon).
export async function fetchVersionFragmentPaths(lawCode, versionDate) {
  const parsed = parseLawCode(lawCode);
  if (!parsed) return [];
  const data = await getJsonLd(`eli/cz/sb/${parsed.rok}/${parsed.cislo}/${versionDate}`);
  return data["má-fragment-znění"] || [];
}

// "§ 29" nebo "§ 7 (1/2)" -> "29" / "7" / "35b" - základní označení paragrafu
// bez značky odstavce a bez našeho vlastního "(n/m)" dělení chunků.
export function baseParagraphNumber(sectionRef) {
  // section_ref bývá null u chunků bez konkrétního paragrafu (např. preambule
  // zákona "ZÁKON České národní rady ze dne…") - ty prostě nesledujeme.
  if (!sectionRef) return null;
  const m = sectionRef.match(/§\s*([0-9]+[a-z]*)/i);
  return m ? m[1].toLowerCase() : null;
}

// Najde v seznamu fragmentových cest tu, která odpovídá holému paragrafu
// (ne jeho odstavci/písmenu) - cesta má končit přesně "/par_<cislo>".
export function findParagraphFragmentPath(fragmentPaths, paragraphNumber) {
  const suffix = `/par_${paragraphNumber}`;
  return fragmentPaths.find((p) => p.endsWith(suffix)) || null;
}

async function fetchFragmentMeta(path) {
  // Cesty v má-fragment-znění už obsahují "esel-esb/" prefix samy o sobě
  // (BASE ho má taky) - bez stripnutí by request šel na .../esel-esb/esel-esb/…
  // a tiše by spadl na 404 (chycený v mapBatched, výsledek by vyšel prázdný).
  return getJsonLd(path.replace(/^esel-esb\//, ""));
}

async function fetchFragmentText(fragmentContentId, attempt = 1) {
  // fragmentContentId je už tvaru "esel-esb/právní-akt-fragment/12345"
  const relative = fragmentContentId.replace(/^esel-esb\//, "");
  const data = await getJsonLd(relative);
  const raw = data["l-sgov-dat-sbirka-pojem:text-fragmentu"] || "";
  // Prázdný text-fragmentu s HTTP 200 nastal v praxi (viz komentář u getJsonLd)
  // bez chyby, kterou by šlo chytit - zkusíme to znovu, než to prohlásíme za
  // skutečně prázdný fragment (existují, ale jsou vzácné).
  if (!raw.trim() && attempt < 3) {
    await new Promise((r) => setTimeout(r, 300 * attempt));
    return fetchFragmentText(fragmentContentId, attempt + 1);
  }
  // Odstraní <var>…</var> (číslování/označení) i případné vnořené odkazy
  // (např. křížové odkazy na jiné paragrafy jsou obalené v <a>…</a>).
  return raw.replace(/<[^>]+>/g, "").trim();
}

// Zpracuje pole promisů v dávkách, ať to nejede tisíc requestů najednou.
async function mapBatched(items, batchSize, fn) {
  const out = [];
  for (let i = 0; i < items.length; i += batchSize) {
    const batch = items.slice(i, i + batchSize);
    out.push(...(await Promise.all(batch.map(fn))));
  }
  return out;
}

const MAX_FRAGMENTS_PER_PARAGRAPH = 150; // pojistka proti extrémně dlouhému § (např. přechodná ustanovení)

/**
 * Zrekonstruuje plný text paragrafu z jeho fragmentového stromu.
 * Vrací null, pokud paragraf ve verzi nenajde nebo je moc velký na bezpečné zpracování.
 */
export async function reconstructParagraphText(lawCode, versionDate, paragraphNumber, allFragmentPaths) {
  const parPath = findParagraphFragmentPath(allFragmentPaths, paragraphNumber);
  if (!parPath) return null;

  const subtreePaths = allFragmentPaths.filter((p) => p === parPath || p.startsWith(parPath + "/"));
  if (subtreePaths.length > MAX_FRAGMENTS_PER_PARAGRAPH) {
    return { tooLarge: true, fragmentCount: subtreePaths.length };
  }

  // Metadata (pořadí + ukazatel na text) pro každý uzel podstromu.
  const metas = await mapBatched(subtreePaths, 6, async (p) => {
    try {
      const meta = await fetchFragmentMeta(p);
      return { path: p, poradi: meta["l-sgov-dat-sbirka-pojem:pořadí-fragmentu-znění-právního-aktu"], obsahuje: meta["obsahuje-fragment"] };
    } catch {
      return null;
    }
  });
  // Metadata fetch má vlastní retry (viz getJsonLd) - pokud selže i po nich,
  // NEPOKRAČOVAT s neúplnou stromovou strukturou. Radši nahlásit nespolehlivý
  // výsledek, než tiše vrátit uťatý text, který by mohl skončit jako "nové
  // znění zákona" v e-mailu ke schválení.
  if (metas.some((m) => m === null)) {
    return { unreliable: true, reason: "metadata_fetch_failed" };
  }

  // Vlastní text pro každý uzel (fetchFragmentText má vlastní retry na prázdný výsledek).
  const withText = await mapBatched(metas, 6, async (m) => {
    try {
      const text = await fetchFragmentText(m.obsahuje);
      return { ...m, text };
    } catch {
      return { ...m, text: "" };
    }
  });
  const stillEmpty = withText.filter((f) => !f.text.trim());
  if (stillEmpty.length) {
    return { unreliable: true, reason: "empty_fragment_text", paths: stillEmpty.map((f) => f.path) };
  }

  // Řazení podle pořadí-fragmentu-znění-právního-aktu - hex klíč navržený
  // e-Sbírkou přímo pro řazení prostým porovnáním řetězců (fractional-index
  // schéma: dítě má klíč rozšiřující klíč rodiče). Cesta samotná NENÍ
  // spolehlivý vodítko k pořadí - např. "odst_7/frag_2443215" (nepojmenovaná
  // závěrečná věta odstavce, "Způsob uplatnění výdajů…") má podle abecedy
  // "f" před "pism_a"..."pism_d", ale ve skutečném textu patří AŽ ZA ně;
  // ověřeno živě 2026-07-31 na § 7 zákona 586/1992 Sb.
  withText.sort((a, b) => (a.poradi < b.poradi ? -1 : a.poradi > b.poradi ? 1 : 0));

  return withText.map((f) => f.text).filter(Boolean).join("\n");
}

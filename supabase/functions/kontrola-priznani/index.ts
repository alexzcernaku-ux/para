// supabase/functions/kontrola-priznani/index.ts
//
// Fáze 10 — kontrola přiznání k dani z příjmů fyzických osob (DAP). Tahle
// funkce dělá JEN extrakci hodnot z nahraného PDF/fotky tiskopisu (Claude
// vision, stejný princip jako kontrola-dokladu ve Fázi 6 — žádná OCR
// služba navíc). Vlastní ověření vzorců (jestli řádky sedí) NEDĚLÁ model —
// počítá ho web/assets/js/dap-check.js na klientovi stejnou funkcí, jakou
// používá i cesta s nahraným XML z EPO. Model tady jen "přečte čísla",
// aritmetiku má na starosti deterministický kód, ne LLM.
//
// Právně/daňově citlivá fáze — výstup je vždy srovnání s tím, co plyne
// z formulářem předepsaných vzorců, nikdy posouzení správnosti daňového
// přiznání jako celku (viz disclaimer v UI).
//
// Nasazení: supabase functions deploy kontrola-priznani
// Secrets: žádné nové — používá stejný ANTHROPIC_API_KEY jako zakon-query.

const ANTHROPIC_KEY = Deno.env.get("ANTHROPIC_API_KEY")!;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const MAX_BASE64_LENGTH = 12_000_000; // ~9 MB souboru po dekódování z base64

// Popisky řádků — stejné, jaké kontroluje dap-check.js (viz tam komentář
// s odkazem na tiskopisy 25 5405 vzor 30 a 25 5405/P1 vzor 22, oba pro 2026).
const RADKY_POPIS = `
Příloha č. 1 (Výpočet dílčího základu daně ze samostatné činnosti, § 7 zákona):
- ř. 101 Příjmy podle § 7 zákona
- ř. 102 Výdaje související s příjmy podle § 7 zákona
- ř. 104 Rozdíl mezi příjmy a výdaji (nebo výsledek hospodaření)
- ř. 105 Úhrn částek podle § 5, § 23 zákona zvyšující
- ř. 106 Úhrn částek podle § 5, § 23 zákona snižující
- ř. 107 Část příjmů rozdělovaná na spolupracující osobu
- ř. 108 Část výdajů rozdělovaná na spolupracující osobu
- ř. 109 Část příjmů připadající na Vás jako spolupracující osobu
- ř. 110 Část výdajů připadající na Vás jako spolupracující osobu
- ř. 112 Podíl společníka v. o. s. / komplementáře k. s.
- ř. 113 Dílčí základ daně (ztráta) z příjmů podle § 7 zákona

Hlavní tiskopis (Přiznání k dani z příjmů fyzických osob), 2. a 3. oddíl:
- ř. 36 Dílčí základ daně ze závislé činnosti (§ 6)
- ř. 37 Dílčí základ daně/ztráta ze samostatné činnosti (§ 7)
- ř. 38 Dílčí základ daně z kapitálového majetku (§ 8)
- ř. 39 Dílčí základ daně/ztráta z nájmu (§ 9)
- ř. 40 Dílčí základ daně z ostatních příjmů (§ 10)
- ř. 41 Úhrn řádků (ř. 37 + ř. 38 + ř. 39 + ř. 40)
- ř. 42 Základ daně
- ř. 44 Uplatňovaná výše ztráty
- ř. 45 Základ daně po odečtení ztráty
- ř. 54 Úhrn nezdanitelných částí a odčitatelných položek
- ř. 55 Základ daně snížený o nezdanitelné části
- ř. 56 Základ daně zaokrouhlený na celá sta Kč dolů
- ř. 57 Daň podle § 16 zákona
- ř. 64 Základní sleva na poplatníka (§ 35ba odst. 1 písm. a)
`.trim();

const SYSTEM_PROMPT = `Jsi asistent, který z nahraného obrázku nebo PDF přečte hodnoty konkrétních řádků
českého daňového tiskopisu "Přiznání k dani z příjmů fyzických osob" (25 5405) a jeho
Přílohy č. 1. Tvůj úkol je ČISTĚ přepsat čísla, která jsou v tiskopisu vyplněná — žádné
výpočty, žádné posuzování správnosti.

Formulář má u řádků ve 2. oddílu a v Příloze č. 1 dva sloupce: "poplatník" a "finanční úřad".
Čti VŽDY jen sloupec "poplatník" (levý/první sloupec, který vyplňuje daňový subjekt) —
sloupec "finanční úřad" je pro úřední záznam a při podání bývá prázdný.

Řádky, které máš hledat:
${RADKY_POPIS}

Vrať ČISTĚ JSON (žádný text mimo JSON) v této struktuře:
{
  "radky": { "101": 500000, "102": 300000, "104": null, ... },
  "nejiste": ["104"],
  "poznamka": "1-2 věty, pokud je dokument nečitelný, useknutý, nebo to není tenhle tiskopis"
}

Do "radky" zahrň KAŽDÝ řádek ze seznamu výše jako klíč (číslo řádku jako string). Pokud
řádek na dokumentu není vyplněný, nebo dokument tuhle část vůbec neobsahuje (např. chybí
Příloha č. 1), dej hodnotu null. Čísla piš jako čistá čísla bez mezer a bez "Kč" (např. 500000,
ne "500 000 Kč"). Záporné částky (ztráta) piš se znaménkem minus. Do "nejiste" dej čísla
řádků, kde sis hodnotou nebyl jistý (rozmazané, přeškrtnuté, dvojznačné). Nikdy si hodnotu
nevymýšlej — když nejde přečíst, patří tam null, ne odhad.`;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const { image, mediaType } = await req.json();
    if (!image || typeof image !== "string") {
      return new Response(JSON.stringify({ error: "Chybí 'image' (base64) v těle požadavku." }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (image.length > MAX_BASE64_LENGTH) {
      return new Response(JSON.stringify({ error: "Soubor je moc velký (limit ~9 MB)." }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const isPdf = mediaType === "application/pdf";
    const allowedImageTypes = ["image/jpeg", "image/png", "image/webp"];
    if (!isPdf && !allowedImageTypes.includes(mediaType)) {
      return new Response(JSON.stringify({ error: `Nepodporovaný formát souboru: ${mediaType}` }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const contentBlock = isPdf
      ? { type: "document", source: { type: "base64", media_type: "application/pdf", data: image } }
      : { type: "image", source: { type: "base64", media_type: mediaType, data: image } };

    const claudeRes = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": ANTHROPIC_KEY,
        "anthropic-version": "2023-06-01",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "claude-sonnet-5",
        max_tokens: 2048,
        system: SYSTEM_PROMPT,
        messages: [
          {
            role: "user",
            content: [
              contentBlock,
              { type: "text", text: "Přečti hodnoty řádků podle instrukcí a vrať JSON." },
            ],
          },
        ],
      }),
    });

    if (!claudeRes.ok) {
      const errText = await claudeRes.text();
      throw new Error(`Anthropic API error: ${claudeRes.status} ${errText}`);
    }

    const claudeData = await claudeRes.json();
    const textBlock = claudeData.content?.find((b: any) => b.type === "text");
    const raw = textBlock?.text ?? "{}";

    let parsed;
    try {
      const cleaned = raw.trim().replace(/^```json\s*/i, "").replace(/^```\s*/i, "").replace(/```\s*$/i, "");
      parsed = JSON.parse(cleaned);
    } catch {
      return new Response(
        JSON.stringify({ error: "Nepodařilo se zpracovat odpověď modelu.", raw }),
        { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    return new Response(JSON.stringify(parsed), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

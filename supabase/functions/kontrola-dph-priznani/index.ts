// supabase/functions/kontrola-dph-priznani/index.ts
//
// Kontrola přiznání k DPH (25 5401) — vision extrakce, stejný princip jako
// kontrola-priznani.ts (DPFO, Fáze 10). Model jen "přečte čísla" ze
// zadaných řádků, aritmetiku (sazby, součty) počítá deterministicky
// web/assets/js/dph-check.js na klientovi.
//
// Nasazení: supabase functions deploy kontrola-dph-priznani
// Secrets: žádné nové — používá stejný ANTHROPIC_API_KEY jako zakon-query.

const ANTHROPIC_KEY = Deno.env.get("ANTHROPIC_API_KEY")!;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const MAX_BASE64_LENGTH = 12_000_000;

const RADKY_POPIS = `
I. Zdanitelná plnění (Dodání zboží nebo poskytnutí služby s místem plnění v tuzemsku):
- ř. 1 základní sazba — sloupce "Základ daně" a "Daň na výstupu"
- ř. 2 snížená sazba — sloupce "Základ daně" a "Daň na výstupu"

IV. Nárok na odpočet daně (Z přijatých zdanitelných plnění od plátců):
- ř. 40 základní sazba — sloupec "V plné výši" (ne "Krácený odpočet")
- ř. 41 snížená sazba — sloupec "V plné výši"
- ř. 46 Odpočet daně celkem — sloupec "V plné výši"

VI. Výpočet daně:
- ř. 62 Daň na výstupu
- ř. 63 Odpočet daně
- ř. 64 Vlastní daň
- ř. 65 Nadměrný odpočet
`.trim();

const SYSTEM_PROMPT = `Jsi asistent, který z nahraného obrázku nebo PDF přečte hodnoty konkrétních řádků
českého tiskopisu "Přiznání k dani z přidané hodnoty" (25 5401). Tvůj úkol je ČISTĚ přepsat
čísla, která jsou v tiskopisu vyplněná — žádné výpočty, žádné posuzování správnosti.

U řádků 40, 41 a 46 čti VŽDY jen sloupec "V plné výši" — sloupec "Krácený odpočet" je pro
plátce, kteří krátí nárok na odpočet (§ 76), a v jednodušších přiznáních bývá prázdný.

Řádky, které máš hledat:
${RADKY_POPIS}

Vrať ČISTĚ JSON (žádný text mimo JSON) v této struktuře:
{
  "hodnoty": { "zaklad1": 500000, "dan1": 105000, "zaklad2": null, "dan2": null, "40": 120000, "41": null, "46": 120000, "62": 105000, "63": 120000, "64": null, "65": 15000 },
  "nejiste": [],
  "poznamka": "1-2 věty, pokud je dokument nečitelný nebo to není tenhle tiskopis"
}

Do "hodnoty" zahrň KAŽDÝ klíč ze seznamu výše. Pokud řádek/sloupec na dokumentu není
vyplněný, dej hodnotu null. Čísla piš jako čistá čísla bez mezer a bez "Kč". Do "nejiste" dej
klíče, kde sis hodnotou nebyl jistý. Nikdy si hodnotu nevymýšlej — když nejde přečíst, patří
tam null, ne odhad.`;

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
        max_tokens: 1536,
        system: SYSTEM_PROMPT,
        messages: [
          {
            role: "user",
            content: [contentBlock, { type: "text", text: "Přečti hodnoty řádků podle instrukcí a vrať JSON." }],
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
      return new Response(JSON.stringify({ error: "Nepodařilo se zpracovat odpověď modelu.", raw }), {
        status: 502,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify(parsed), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

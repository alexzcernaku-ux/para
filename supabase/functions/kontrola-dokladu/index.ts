// supabase/functions/kontrola-dokladu/index.ts
//
// Fáze 6 - kontrola náležitostí faktury/dokladu podle § 29 zákona o DPH
// (235/2004 Sb.). Žádná samostatná OCR služba - Claude čte obrázek/PDF
// přímo (vision), v jednom kroku "přečte" doklad i posoudí náležitosti.
// Rozhodnutí zdůvodněné v konverzaci s uživatelem: jednodušší architektura,
// žádný další účet/API klíč, dost dobrá přesnost na strukturovaný dokument.
//
// Právně citlivá fáze - výstup je vždy POPIS STAVU dokladu vůči zákonu,
// nikdy závazná právní rada (viz SYSTEM_PROMPT a disclaimer v UI).
//
// Nasazení: supabase functions deploy kontrola-dokladu
// Secrets: žádné nové - používá stejný ANTHROPIC_API_KEY jako zakon-query.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
);

const ANTHROPIC_KEY = Deno.env.get("ANTHROPIC_API_KEY")!;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const MAX_BASE64_LENGTH = 12_000_000; // ~9 MB souboru po dekódování z base64

// Natáhne přesné aktuální znění §29/29a/30/30a přímo z nahraného zákona -
// ne staticky zkopírované do promptu, ať se to samo nerozejde s DB při novele.
async function fetchDphNalezitosti(): Promise<string> {
  const { data, error } = await supabase
    .from("law_chunks")
    .select("section_ref, content")
    .eq("law_code", "235/2004 Sb.")
    .in("section_ref", ["§ 29", "§ 29a", "§ 30", "§ 30a"])
    .order("id");
  if (error) throw error;
  return data.map((r: any) => r.content).join("\n\n");
}

const SYSTEM_PROMPT_TEMPLATE = (lawText: string) => `Jsi asistent, který kontroluje formální náležitosti daňového dokladu (faktury)
podle českého zákona o DPH. Dostaneš obrázek nebo PDF dokladu. Tvůj úkol:

1. Přečti z dokladu viditelné údaje (dodavatel, odběratel, DIČ, IČO, evidenční číslo,
   datum vystavení, datum uskutečnění plnění, popis plnění, jednotková cena, základ daně,
   sazba DPH, výše DPH, celková částka).
2. Urči, jestli jde o zjednodušený daňový doklad (celková částka do 10 000 Kč včetně daně)
   nebo plný daňový doklad - podle § 30 má na to vliv jen celková částka, ne to, kdo doklad
   vystavil. Zjednodušený doklad nemusí mít náležitosti podle § 30a odst. 1.
3. Porovnej přítomné údaje s náležitostmi podle zákona níže a vrať ČISTĚ JSON (žádný text
   mimo JSON, žádné odřádkování před/po) v této struktuře:

{
  "typDokladu": "plny" | "zjednoduseny" | "nejisty",
  "celkovaCastka": "částka jak je uvedená na dokladu (jen číslo, bez měny a mezer, desetinná tečka), nebo null",
  "datumVystaveni": "datum vystavení ve formátu YYYY-MM-DD, nebo null",
  "dodavatel": "název/jméno dodavatele tak, jak je na dokladu, nebo null",
  "odberatel": "název/jméno odběratele tak, jak je na dokladu, nebo null",
  "evidencniCislo": "evidenční/pořadové číslo dokladu, nebo null",
  "shrnuti": "1-2 věty lidsky, co je/není v pořádku",
  "polozky": [
    { "klic": "kratky_identifikator", "popis": "název náležitosti česky", "stav": "ano" | "chybi" | "nejiste", "poznamka": "co přesně je/chybí, nebo proč nejisté", "paragraf": "§ 29 odst. 1 písm. a)" }
  ]
}

Do "polozky" zahrň JEN náležitosti, které se na tenhle konkrétní doklad podle zákona
vztahují (u zjednodušeného dokladu vynech ty, co podle § 30a odst. 1 nemusí být, a
nepočítej to jako "chybí"). "nejiste" použij, když je obrázek nečitelný/useknutý na tom
místě, ne když si nejsi jistý výkladem zákona.

Nikdy nepiš nic mimo ten JSON. Nikdy nedávej právní radu nad rámec popisu, co doklad
podle textu zákona obsahuje nebo neobsahuje - to je popis stavu, ne stanovisko k tomu,
jestli je doklad "platný" v širším smyslu (to je na daňovém poradci).

ZNĚNÍ ZÁKONA (zákon č. 235/2004 Sb., o dani z přidané hodnoty):
${lawText}`;

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

    const lawText = await fetchDphNalezitosti();

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
        // 12 položek s vlastní poznámkou (zvlášť u problematických dokladů, kde
        // model píše delší vysvětlení) se do 2048 tokenů občas nevejde a JSON
        // se utne uprostřed - 4096 dává rozumnou rezervu.
        max_tokens: 4096,
        system: SYSTEM_PROMPT_TEMPLATE(lawText),
        messages: [
          {
            role: "user",
            content: [
              contentBlock,
              { type: "text", text: "Zkontroluj náležitosti tohoto dokladu a vrať JSON podle instrukcí." },
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
      // Claude občas obalí JSON do ```json bloku i přes instrukci - ošetřit.
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

// Sdílený seznam kategorií evidence + jednoduchá heuristika pro návrh
// kategorie podle popisu/dodavatele - používá evidence.html (psaní popisu)
// i kontrola-dokladu.html (rozpoznaný dodavatel z účtenky). Klíčová slova
// místo AI volání záměrně - kategorie je pevná malá množina, keyword match
// je okamžitý (bez network roundtripu) a dost přesný na to, aby ušetřil
// klikání, i když se čas od času netrefí (uživatel si vždy může vybrat jinak).

export const CATEGORIES = {
  prijem: ["Tržby/služby", "Prodej zboží", "Úroky a ostatní výnosy", "Jiné"],
  vydaj: [
    "Materiál a zboží",
    "Služby",
    "Mzdy a odměny",
    "Nájem",
    "Doprava a PHM",
    "Vybavení a kancelář",
    "Pojištění",
    "Bankovní poplatky",
    "Jiné",
  ],
};

const RULES = {
  vydaj: [
    { category: "Doprava a PHM", keywords: ["benzín", "nafta", "phm", "čerpací", "shell", "omv", "mol ", "orlen", "tank", "parking", "parkování", "dálniční", "mýtné", "eurowag"] },
    { category: "Nájem", keywords: ["nájem", "pronájem", "nájemné"] },
    { category: "Pojištění", keywords: ["pojištění", "pojistné", "allianz", "generali", "kooperativa", "česká pojišťovna", "uniqa"] },
    { category: "Bankovní poplatky", keywords: ["poplatek", "vedení účtu", "úrok z úvěru"] },
    { category: "Mzdy a odměny", keywords: ["mzda", "mzdy", "odměna", "výplata", "dpp", "dpč"] },
    { category: "Vybavení a kancelář", keywords: ["kancelář", "papír", "tiskárna", "notebook", "počítač", "monitor", "nábytek", "alza", "datart", "czc"] },
    { category: "Služby", keywords: ["konzultace", "předplatné", "software", "hosting", "doména", "licence", "účetní", "právní", "marketing", "reklama"] },
    { category: "Materiál a zboží", keywords: ["materiál", "zboží", "dodávka", "sklad", "velkoobchod"] },
  ],
  prijem: [
    { category: "Prodej zboží", keywords: ["prodej", "zboží", "eshop", "e-shop"] },
    { category: "Úroky a ostatní výnosy", keywords: ["úrok", "výnos", "dividend"] },
  ],
};

export function suggestCategory(type, text) {
  const norm = (text || "").toLowerCase();
  if (!norm.trim()) return null;
  for (const rule of RULES[type] || []) {
    if (rule.keywords.some((k) => norm.includes(k))) return rule.category;
  }
  return null;
}

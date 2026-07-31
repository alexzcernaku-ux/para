// Fáze 10 — kontrola přiznání k dani z příjmů fyzických osob (DAP, tiskopis
// 25 5405, vzor č. 30 pro rok 2026) a Přílohy č. 1 (výpočet dílčího základu
// daně ze samostatné činnosti, § 7 zákona, tiskopis 25 5405/P1 vzor č. 22).
//
// Řádky/vzorce ověřené přímo z aktuálních tiskopisů financnisprava.gov.cz
// (staženo 2026-07-31), NE z paměti — viz komentáře u každé kontroly.
// Rozsah je záměrně omezený na řádky, které se dají ověřit s jistotou:
// výpočet dílčího základu daně ze samostatné činnosti (§ 7 — nejdůležitější
// pro OSVČ, cílovou skupinu appky) a navazující výpočet základu daně a daně.
// Neřeší oddíly pro zaměstnance, zahraniční příjmy, slevy na děti/manžela
// ani placení daně (zálohy, bonusy) — tam by šlo o odhad, ne o kontrolu.
//
// Použití: parseDapXml() pro XML z EPO, nebo edge function kontrola-priznani
// (vision) vrací STEJNÝ tvar řádků → obě cesty se ověřují stejnou funkcí
// checkDapConsistency(), aby se logika výpočtu nepsala dvakrát.

import {
  DAN_SAZBA_NIZSI,
  DAN_SAZBA_VYSSI,
  DAN_HRANICE_VYSSI_SAZBA_ODHAD,
  SLEVA_NA_POPLATNIKA,
  PAUSALNI_VYDAJE,
} from "./tax-constants.js";

export const RADEK_LABEL = {
  101: "Příjmy podle § 7 zákona",
  102: "Výdaje související s příjmy podle § 7 zákona",
  104: "Rozdíl mezi příjmy a výdaji (ř. 101 − ř. 102)",
  105: "Úhrn částek podle § 5, § 23 zákona zvyšující",
  106: "Úhrn částek podle § 5, § 23 zákona snižující",
  107: "Část příjmů rozdělovaná na spolupracující osobu",
  108: "Část výdajů rozdělovaná na spolupracující osobu",
  109: "Část příjmů připadající na Vás jako spolupracující osobu",
  110: "Část výdajů připadající na Vás jako spolupracující osobu",
  112: "Podíl společníka v. o. s. / komplementáře k. s.",
  113: "Dílčí základ daně (ztráta) z příjmů podle § 7 zákona",
  36: "Dílčí základ daně ze závislé činnosti (§ 6)",
  37: "Dílčí základ daně/ztráta ze samostatné činnosti (§ 7, ř. 113 přílohy)",
  38: "Dílčí základ daně z kapitálového majetku (§ 8)",
  39: "Dílčí základ daně/ztráta z nájmu (§ 9)",
  40: "Dílčí základ daně z ostatních příjmů (§ 10)",
  41: "Úhrn řádků (ř. 37 + ř. 38 + ř. 39 + ř. 40)",
  42: "Základ daně (ř. 36 + kladná hodnota z ř. 41)",
  44: "Uplatňovaná výše ztráty",
  45: "Základ daně po odečtení ztráty (ř. 42 − ř. 44)",
  54: "Úhrn nezdanitelných částí a odčitatelných položek",
  55: "Základ daně snížený o nezdanitelné části (ř. 45 − ř. 54)",
  56: "Základ daně zaokrouhlený na celá sta Kč dolů",
  57: "Daň podle § 16 zákona",
  64: "Základní sleva na poplatníka (§ 35ba odst. 1 písm. a)",
};

function round0(n) {
  return Math.round(n);
}
function floorToHundred(n) {
  return Math.floor(n / 100) * 100;
}
function num(v) {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(String(v).replace(/\s/g, "").replace(",", "."));
  return Number.isFinite(n) ? n : null;
}
function or0(v) {
  const n = num(v);
  return n === null ? 0 : n;
}

// Výpočet daně podle § 16 zákona: 15 % do hranice (36násobek průměrné mzdy),
// 23 % nad ní. Hranice je jen ODHAD (viz tax-constants.js) — proto se tahle
// kontrola hlásí jen při výrazném rozdílu, ne na Kč přesně.
function vypocetDan16(zaklad) {
  const hranice = DAN_HRANICE_VYSSI_SAZBA_ODHAD;
  if (zaklad <= hranice) return round0(zaklad * DAN_SAZBA_NIZSI);
  return round0(hranice * DAN_SAZBA_NIZSI + (zaklad - hranice) * DAN_SAZBA_VYSSI);
}

function pushCheck(list, radek, ocekavano, uvedeno, extra = {}) {
  const label = RADEK_LABEL[radek] || `ř. ${radek}`;
  if (uvedeno === null) {
    list.push({ radek, popis: label, stav: "chybi", poznamka: "Řádek nebyl v dokumentu nalezen.", ...extra });
    return;
  }
  const diff = Math.abs(ocekavano - uvedeno);
  const tolerance = extra.tolerance ?? 1;
  const stav = diff <= tolerance ? "ano" : "nesedi";
  list.push({
    radek,
    popis: label,
    stav,
    ocekavano,
    uvedeno,
    poznamka:
      stav === "ano"
        ? null
        : `Podle vzorce vychází ${ocekavano.toLocaleString("cs-CZ")} Kč, v přiznání je uvedeno ${uvedeno.toLocaleString("cs-CZ")} Kč.`,
    ...extra,
  });
}

/**
 * Dopočítá celou kaskádu odvozených řádků ze surových vstupů — používá
 * Generátor přiznání (Fáze 11) k předvyplnění PDF. Stejné vzorce jako
 * checkDapConsistency(), jen ve směru "spočítej", ne "ověř".
 * @param {object} v vstupy: 101,102,105,106,107,108,109,110,112 (příloha 1),
 *   36,38,39,40,44,54 (hlavní část) — všechny volitelné, chybějící = 0
 */
export function computeDapCascade(v) {
  const g = (k) => or0(v[k]);
  const r104 = g(101) - g(102);
  const r113 = r104 + g(105) - g(106) - g(107) + g(108) + g(109) - g(110) + g(112);
  const r41 = r113 + g(38) + g(39) + g(40);
  const r42 = g(36) + Math.max(r41, 0);
  const r45 = r42 - g(44);
  const r55 = r45 - g(54);
  const r56 = floorToHundred(Math.max(r55, 0));
  const r57 = vypocetDan16(r56);
  return { 104: r104, 113: r113, 37: r113, 41: r41, 42: r42, 45: r45, 55: r55, 56: r56, 57: r57 };
}

/**
 * @param {Record<string, number|null>} r řádky DAP (klíč = číslo řádku jako string nebo number)
 * @param {object} [profile] profil uživatele (pro info-only poznámky, ne tvrdé kontroly)
 */
export function checkDapConsistency(r, profile) {
  const get = (radek) => (radek in r ? num(r[radek]) : null);
  const results = [];

  // --- Příloha č. 1 — dílčí základ daně ze samostatné činnosti (§ 7) -------
  const r101 = get(101);
  const r102 = get(102);
  if (r101 !== null || r102 !== null) {
    const r104 = get(104);
    pushCheck(results, 104, or0(r101) - or0(r102), r104);

    const r113 = get(113);
    const r104v = r104 !== null ? r104 : or0(r101) - or0(r102);
    const ocekavano113 =
      r104v + or0(get(105)) - or0(get(106)) - or0(get(107)) + or0(get(108)) + or0(get(109)) - or0(get(110)) + or0(get(112));
    pushCheck(results, 113, ocekavano113, r113);

    // Info: pokud uplatňuje paušál, ať sazba odpovídá aktuálním limitům (jen upozornění, ne "chyba").
    if (r101 && r102 && profile?.legal_form?.startsWith("osvc_pausal")) {
      const pomerVydaju = r101 !== 0 ? r102 / r101 : 0;
      const znameSazby = Object.values(PAUSALNI_VYDAJE).map((p) => p.procento);
      const sedi = znameSazby.some((s) => Math.abs(s - pomerVydaju) < 0.01);
      if (!sedi) {
        results.push({
          radek: "102-info",
          popis: "Poměr výdajů k příjmům u paušálních výdajů",
          stav: "nejiste",
          poznamka: `Výdaje (ř. 102) odpovídají ${Math.round(pomerVydaju * 100)} % příjmů — žádný z aktuálních paušálů (80 %/60 %/40 %/30 %) tomu přesně neodpovídá. Zkontrolujte limit max. výdajů podle typu činnosti.`,
        });
      }
    }
  }

  // --- Hlavní část — základ daně, daň -------------------------------------
  const r37 = get(37);
  const r113forCheck = get(113);
  if (r37 !== null && r113forCheck !== null) {
    pushCheck(results, 37, r113forCheck, r37);
  }

  const r38 = or0(get(38));
  const r39 = or0(get(39));
  const r40 = or0(get(40));
  const r41 = get(41);
  if (r37 !== null || r38 || r39 || r40) {
    const ocek41 = or0(r37) + r38 + r39 + r40;
    pushCheck(results, 41, ocek41, r41);

    const r36 = or0(get(36));
    const r42 = get(42);
    const ocek42 = r36 + Math.max(ocek41, 0);
    pushCheck(results, 42, ocek42, r42);

    const r44 = or0(get(44));
    const r45 = get(45);
    if (r42 !== null || r44) {
      const ocek45 = (r42 !== null ? r42 : ocek42) - r44;
      pushCheck(results, 45, ocek45, r45);

      const r54 = or0(get(54));
      const r55 = get(55);
      const ocek55 = ocek45 - r54;
      pushCheck(results, 55, ocek55, r55);

      const r56 = get(56);
      const zaklad56 = r55 !== null ? r55 : ocek55;
      const ocek56 = floorToHundred(Math.max(zaklad56, 0));
      pushCheck(results, 56, ocek56, r56, { tolerance: 0 });

      const r57 = get(57);
      if (r57 !== null) {
        const zakladProDan = r56 !== null ? r56 : ocek56;
        const ocek57 = vypocetDan16(zakladProDan);
        // Hranice 15/23 % je odhad (viz tax-constants.js) — tolerantnější kontrola.
        pushCheck(results, 57, ocek57, r57, {
          tolerance: Math.max(500, Math.round(ocek57 * 0.03)),
          poznamkaOdhad: "Hranice pro 23% pásmo je odhad (36násobek průměrné mzdy pro 2026 ještě nemusí být přesně ověřený) — kontrola je proto tolerantnější.",
        });
      }
    }
  }

  // --- Sleva na poplatníka — informativní srovnání se známou částkou -------
  const r64 = get(64);
  if (r64 !== null && r64 !== SLEVA_NA_POPLATNIKA) {
    results.push({
      radek: 64,
      popis: RADEK_LABEL[64],
      stav: r64 < SLEVA_NA_POPLATNIKA ? "nejiste" : "nesedi",
      uvedeno: r64,
      ocekavano: SLEVA_NA_POPLATNIKA,
      poznamka: `Standardní roční částka je ${SLEVA_NA_POPLATNIKA.toLocaleString("cs-CZ")} Kč. Nižší částka může být v pořádku (např. úmrtí poplatníka v průběhu roku), jinak zkontrolujte.`,
    });
  } else if (r64 !== null) {
    results.push({ radek: 64, popis: RADEK_LABEL[64], stav: "ano", uvedeno: r64, ocekavano: SLEVA_NA_POPLATNIKA });
  }

  return results;
}

// --- XML z EPO (elektronické podání) ---------------------------------------
//
// Schéma ověřené přímo z aktuálního XSD publikovaného finanční správou
// (adisspr.mfcr.cz/adis/jepo/schema/dpfdp7_epo2.xsd, staženo 2026-07-31,
// kořenový element DPFDP7 — aktuální schéma pro tiskopis 25 5405 vzor 30).
// Mapování atributů na čísla řádků je vzaté přímo z textu <xs:documentation>
// jednotlivých atributů v tomto XSD (např. atribut "kc_zd7" má dokumentaci
// "Přeneste údaj z ř. 113 Přílohy č. 1 DAP.").
const XML_ATTR_TO_RADEK = {
  // Příloha č. 1 (§ 7)
  kc_prij7: 101,
  kc_vyd7: 102,
  kc_hosp_rozd: 104,
  kc_uhzvys: 105,
  kc_uhsniz: 106,
  kc_pod_so: 107,
  kc_vyd_so: 108,
  kc_pod_vaso: 109,
  kc_vyd_vaso: 110,
  kc_pod_komp: 112,
  kc_zd7p: 113,
  // Hlavní část
  kc_zd6: 36,
  kc_zd7: 37,
  kc_zd9: 39,
  kc_zd10: 40,
  kc_uhrn: 41,
  kc_zakldan23: 42,
  kc_ztrata2: 44,
  kc_zakldan: 45,
  kc_odcelk: 54,
  kc_zdsniz: 55,
  kc_zdzaokr: 56,
  da_dan16: 57,
  kc_op15_1a: 64,
};

/**
 * Rozparsuje XML podání EPO (kořen <Pisemnost><DPFDP7>...) a vrátí objekt
 * { [cisloRadku]: hodnota }. Hledá atributy ve VŠECH elementech dokumentu
 * (VetaO i VetaT), protože stejné jméno atributu se v různých větách
 * nepoužívá dvakrát s jiným významem.
 */
export function parseDapXml(xmlText) {
  const doc = new DOMParser().parseFromString(xmlText, "application/xml");
  const parserError = doc.querySelector("parsererror");
  if (parserError) throw new Error("XML soubor se nepodařilo přečíst — není to platné XML.");

  const radky = {};
  const walk = (el) => {
    if (el.attributes) {
      for (const attr of el.attributes) {
        const radek = XML_ATTR_TO_RADEK[attr.name];
        if (radek !== undefined && attr.value !== "") radky[radek] = attr.value;
      }
    }
    for (const child of el.children) walk(child);
  };
  walk(doc.documentElement);

  if (Object.keys(radky).length === 0) {
    throw new Error("V XML se nenašly žádné očekávané položky přiznání — je to opravdu podání DPFO (25 5405)?");
  }
  return radky;
}

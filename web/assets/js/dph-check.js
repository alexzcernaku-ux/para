// DPH přiznání - kontrola + výpočet (tiskopis 25 5401, vzor č. 26, 2026;
// zákon č. 235/2004 Sb.). Stejný princip jako dap-check.js pro DPFO: řádky
// a vzorce ověřené přímo z aktuálního tiskopisu a pokynů (financnisprava.gov.cz
// / adisspr.mfcr.cz, staženo 2026-07-31), NE z paměti. Sazby (21 % základní,
// 12 % snížená) ověřené přímo v §47 zákona v našem law_chunks.
//
// Rozsah je záměrně omezený na řádky, které samotný tiskopis označuje jako
// "vyplňované běžnými plátci" (tmavě zelené řádky v pokynech) - plátce, který
// neuskutečňuje osvobozená plnění bez nároku na odpočet (§51) a obchoduje jen
// tuzemsky: ř. 1, 2 (uskutečněná plnění), ř. 40, 41, 46 (nárok na odpočet),
// ř. 62–65 (výpočet daně). Přeshraniční obchod, krácený odpočet, vypořádání
// koeficientu atd. nejsou pokryté - to by u typického malého OSVČ/s.r.o.
// klienta appky byl spíš odhad než kontrola.

import { DPH_SAZBA_ZAKLADNI, DPH_SAZBA_SNIZENA } from "./tax-constants.js";

export const RADEK_LABEL_DPH = {
  1: "Dodání zboží/služby v tuzemsku - základní sazba",
  2: "Dodání zboží/služby v tuzemsku - snížená sazba",
  40: "Přijatá zdanitelná plnění od plátců - základní sazba",
  41: "Přijatá zdanitelná plnění od plátců - snížená sazba",
  46: "Odpočet daně celkem (V plné výši)",
  62: "Daň na výstupu",
  63: "Odpočet daně",
  64: "Vlastní daň (62 − 63)",
  65: "Nadměrný odpočet (63 − 62)",
};

function num(v) {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(String(v).replace(/\s/g, "").replace(",", "."));
  return Number.isFinite(n) ? n : null;
}
function or0(v) {
  const n = num(v);
  return n === null ? 0 : n;
}
function round0(n) {
  return Math.round(n);
}

/**
 * Dopočítá kaskádu z (základ1, základ2, odpočet40, odpočet41) - pro Generátor.
 */
export function computeDphCascade(v) {
  const dan1 = round0(or0(v.zaklad1) * DPH_SAZBA_ZAKLADNI);
  const dan2 = round0(or0(v.zaklad2) * DPH_SAZBA_SNIZENA);
  const r46 = or0(v.odp40) + or0(v.odp41);
  const r62 = dan1 + dan2;
  const r63 = r46;
  const r64 = Math.max(r62 - r63, 0);
  const r65 = Math.max(r63 - r62, 0);
  return { dan1, dan2, 46: r46, 62: r62, 63: r63, 64: r64, 65: r65 };
}

function pushCheck(list, radek, ocekavano, uvedeno, extra = {}) {
  const label = RADEK_LABEL_DPH[radek] || `ř. ${radek}`;
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
 * @param {Record<string, number|null>} r řádky DPH přiznání (klíč = číslo řádku, "zaklad1"/"zaklad2" pro základ daně ř.1/2)
 */
export function checkDphConsistency(r) {
  const get = (k) => (k in r ? num(r[k]) : null);
  const results = [];

  const zaklad1 = get("zaklad1");
  const dan1 = get(1);
  if (zaklad1 !== null) {
    pushCheck(results, 1, round0(zaklad1 * DPH_SAZBA_ZAKLADNI), dan1, {
      poznamkaOdhad: `Kontrola počítá se sazbou ${Math.round(DPH_SAZBA_ZAKLADNI * 100)} % (§ 47 zákona o DPH).`,
    });
  }
  const zaklad2 = get("zaklad2");
  const dan2 = get(2);
  if (zaklad2 !== null) {
    pushCheck(results, 2, round0(zaklad2 * DPH_SAZBA_SNIZENA), dan2, {
      poznamkaOdhad: `Kontrola počítá se sazbou ${Math.round(DPH_SAZBA_SNIZENA * 100)} % (§ 47 zákona o DPH).`,
    });
  }

  const r40 = or0(get(40));
  const r41 = or0(get(41));
  const r46 = get(46);
  if (get(40) !== null || get(41) !== null) {
    pushCheck(results, 46, r40 + r41, r46);
  }

  const r1dan = or0(dan1);
  const r2dan = or0(dan2);
  const r62 = get(62);
  if (dan1 !== null || dan2 !== null) {
    pushCheck(results, 62, r1dan + r2dan, r62);
  }

  const r46v = r46 !== null ? r46 : r40 + r41;
  const r63 = get(63);
  if (r46 !== null) {
    pushCheck(results, 63, r46v, r63);
  }

  const r62v = r62 !== null ? r62 : r1dan + r2dan;
  const r64 = get(64);
  const r65 = get(65);
  if (r62 !== null && r63 !== null) {
    const ocek64 = Math.max(r62v - r46v, 0);
    const ocek65 = Math.max(r46v - r62v, 0);
    if (r64 !== null || ocek64 > 0) pushCheck(results, 64, ocek64, r64);
    if (r65 !== null || ocek65 > 0) pushCheck(results, 65, ocek65, r65);
  }

  return results;
}

// --- XML z EPO ---------------------------------------------------------
//
// Schéma ověřené přímo z aktuálního XSD (adisspr.mfcr.cz/adis/jepo/schema/
// dphdp3_epo2.xsd, staženo 2026-07-31, kořenový element DPHDP3). Sufixy
// "23"/"5" v názvech atributů jsou legacy interní kódy finanční správy pro
// základní/sníženou sazbu (potvrzeno pořadím v XSD i oficiálním popisem
// struktury na adisspr.mfcr.cz/dpr/adis/idpr_pub/epo2_info) - NE aktuální
// procentní sazby.
const XML_ATTR_TO_FIELD_DPH = {
  obrat23: "zaklad1",
  dan23: 1,
  obrat5: "zaklad2",
  dan5: 2,
  odp_tuz23: 40,
  odp_tuz5: 41,
  odp_sum_kr: 46,
  dan_zocelk: 62,
  odp_zocelk: 63,
  dano_da: 64,
  dano_no: 65,
};

export function parseDphXml(xmlText) {
  const doc = new DOMParser().parseFromString(xmlText, "application/xml");
  if (doc.querySelector("parsererror")) throw new Error("XML soubor se nepodařilo přečíst - není to platné XML.");

  const radky = {};
  const walk = (el) => {
    if (el.attributes) {
      for (const attr of el.attributes) {
        const field = XML_ATTR_TO_FIELD_DPH[attr.name];
        if (field !== undefined && attr.value !== "") radky[field] = attr.value;
      }
    }
    for (const child of el.children) walk(child);
  };
  walk(doc.documentElement);

  if (Object.keys(radky).length === 0) {
    throw new Error("V XML se nenašly žádné očekávané položky přiznání k DPH - je to opravdu podání DPHDP3 (25 5401)?");
  }
  return radky;
}

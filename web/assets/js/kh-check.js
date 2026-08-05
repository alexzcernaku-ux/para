// Kontrolní hlášení DPH (tiskopis 25 5411; zákon č. 235/2004 Sb., § 101c
// a násl.) - kontrola vnitřní konzistence. Na rozdíl od DPFO/DPH přiznání
// NENÍ kontrolní hlášení výpočtová kaskáda s pár řádky - je to REGISTR
// jednotlivých dokladů (oddíly A.1–A.5 uskutečněná plnění, B.1–B.3 přijatá
// plnění), a oddíl C jsou součtové/kontrolní údaje, které se (podle pokynů
// k tiskopisu) musí shodovat se součtem řádků v detailních/souhrnných
// oddílech A.4+A.5 (výstup) a B.2+B.3 (vstup).
//
// Z toho plyne jiný typ kontroly než u DPFO/DPH: neověřujeme vzorec, ale
// jestli oddíl C (deklarované součty) sedí na sečtené jednotlivé řádky ze
// STEJNÉHO souboru. Kontrolní hlášení se podává výhradně elektronicky jako
// XML (papírové podání není přípustné), takže tahle stránka na rozdíl od
// DPFO/DPH kontroly nemá "nahrát foto" variantu.
//
// Kvůli tomu, že jde o registr jednotlivých dokladů, ne o pár součtových
// řádků, tu (zatím) není ani "Generátor" - smysluplně by šel postavit až
// na evidenci vystavených a přijatých faktur (nápad "Sledování faktur"),
// odkud by se řádky A/B daly vzít automaticky.
//
// XML schéma ověřené přímo z aktuálního XSD (adisspr.mfcr.cz/adis/jepo/
// schema/dphkh1_epo2.xsd, staženo 2026-07-31, kořenový element DPHKH1).

function num(v) {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(String(v).replace(/\s/g, "").replace(",", "."));
  return Number.isFinite(n) ? n : null;
}
function or0(v) {
  const n = num(v);
  return n === null ? 0 : n;
}

const ROW_LABEL = {
  obrat23_zaklad: "Souhrn A.4+A.5 - základ daně, základní sazba (oddíl C vs. ř. 1 přiznání k DPH)",
  obrat23_dan: "Souhrn A.4+A.5 - daň, základní sazba",
  obrat5_zaklad: "Souhrn A.4+A.5 - základ daně, snížená sazba (oddíl C vs. ř. 2 přiznání k DPH)",
  obrat5_dan: "Souhrn A.4+A.5 - daň, snížená sazba",
  pln23_zaklad: "Souhrn B.2+B.3 - základ daně, základní sazba (oddíl C vs. ř. 40 přiznání k DPH)",
  pln23_dan: "Souhrn B.2+B.3 - daň, základní sazba",
  pln5_zaklad: "Souhrn B.2+B.3 - základ daně, snížená sazba (oddíl C vs. ř. 41 přiznání k DPH)",
  pln5_dan: "Souhrn B.2+B.3 - daň, snížená sazba",
};

/**
 * Rozparsuje XML podání KH (kořen <Pisemnost><DPHKH1>...) a vrátí
 * { radky: [...VetaA4/A5 řádky], prijate: [...VetaB2/B3 řádky], soucty: {obrat23, obrat5, pln23, pln5, ...} }.
 */
export function parseKhXml(xmlText) {
  const doc = new DOMParser().parseFromString(xmlText, "application/xml");
  if (doc.querySelector("parsererror")) throw new Error("XML soubor se nepodařilo přečíst - není to platné XML.");

  const uskutecnena = []; // A.4 + A.5
  const prijata = []; // B.2 + B.3
  let soucty = null; // VetaC

  const walk = (el) => {
    const tag = el.tagName;
    if (tag === "VetaA4" || tag === "VetaA5") {
      uskutecnena.push({
        zaklad1: el.getAttribute("zakl_dane1"),
        dan1: el.getAttribute("dan1"),
        zaklad2: el.getAttribute("zakl_dane2"),
        dan2: el.getAttribute("dan2"),
      });
    } else if (tag === "VetaB2" || tag === "VetaB3") {
      prijata.push({
        zaklad1: el.getAttribute("zakl_dane1"),
        dan1: el.getAttribute("dan1"),
        zaklad2: el.getAttribute("zakl_dane2"),
        dan2: el.getAttribute("dan2"),
      });
    } else if (tag === "VetaC") {
      soucty = {
        obrat23: el.getAttribute("obrat23"),
        obrat5: el.getAttribute("obrat5"),
        pln23: el.getAttribute("pln23"),
        pln5: el.getAttribute("pln5"),
      };
    }
    for (const child of el.children) walk(child);
  };
  walk(doc.documentElement);

  if (!soucty && uskutecnena.length === 0 && prijata.length === 0) {
    throw new Error("V XML se nenašly žádné očekávané položky kontrolního hlášení - je to opravdu podání DPHKH1 (25 5411)?");
  }
  return { uskutecnena, prijata, soucty };
}

function sumField(rows, field) {
  return rows.reduce((acc, r) => acc + or0(r[field]), 0);
}

function pushCheck(list, key, ocekavano, uvedeno) {
  const label = ROW_LABEL[key] || key;
  if (uvedeno === null) {
    list.push({ radek: key, popis: label, stav: "chybi", poznamka: "V oddílu C nebyla nalezena odpovídající hodnota." });
    return;
  }
  const diff = Math.abs(ocekavano - uvedeno);
  const stav = diff <= 1 ? "ano" : "nesedi";
  list.push({
    radek: key,
    popis: label,
    stav,
    ocekavano,
    uvedeno,
    poznamka:
      stav === "ano"
        ? null
        : `Součet jednotlivých řádků vychází na ${ocekavano.toLocaleString("cs-CZ")} Kč, oddíl C uvádí ${uvedeno.toLocaleString("cs-CZ")} Kč.`,
  });
}

/**
 * @param {{uskutecnena: object[], prijata: object[], soucty: object|null}} parsed výstup parseKhXml()
 */
export function checkKhConsistency({ uskutecnena, prijata, soucty }) {
  const results = [];
  if (!soucty) {
    results.push({
      radek: "oddil-c",
      popis: "Oddíl C (souhrnné údaje)",
      stav: "chybi",
      poznamka: "V dokumentu chybí oddíl C - nejde ověřit součty proti jednotlivým řádkům.",
    });
    return results;
  }

  const zaklad1Sum = sumField(uskutecnena, "zaklad1");
  const dan1Sum = sumField(uskutecnena, "dan1");
  const zaklad2Sum = sumField(uskutecnena, "zaklad2");
  const dan2Sum = sumField(uskutecnena, "dan2");
  const pZaklad1Sum = sumField(prijata, "zaklad1");
  const pDan1Sum = sumField(prijata, "dan1");
  const pZaklad2Sum = sumField(prijata, "zaklad2");
  const pDan2Sum = sumField(prijata, "dan2");

  pushCheck(results, "obrat23_zaklad", zaklad1Sum, num(soucty.obrat23));
  pushCheck(results, "obrat5_zaklad", zaklad2Sum, num(soucty.obrat5));
  pushCheck(results, "pln23_zaklad", pZaklad1Sum, num(soucty.pln23));
  pushCheck(results, "pln5_zaklad", pZaklad2Sum, num(soucty.pln5));

  results.push({
    radek: "info-pocty",
    popis: "Počet načtených řádků",
    stav: "nejiste",
    poznamka: `Uskutečněná plnění (A.4+A.5): ${uskutecnena.length} řádků, součet daně ${dan1Sum.toLocaleString("cs-CZ")} + ${dan2Sum.toLocaleString("cs-CZ")} Kč. Přijatá plnění (B.2+B.3): ${prijata.length} řádků, součet daně ${pDan1Sum.toLocaleString("cs-CZ")} + ${pDan2Sum.toLocaleString("cs-CZ")} Kč.`,
  });

  return results;
}

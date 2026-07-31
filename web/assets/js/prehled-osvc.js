// Přehled o příjmech a výdajích OSVČ za rok 2025 (ČSSZ, tiskopis 89 324 24,
// verze I/2026, podle § 15 zákona č. 589/1992 Sb.) + souběžný přehled pro
// zdravotní pojišťovnu (§ 24 odst. 2 zákona č. 592/1992 Sb.) — obě podání
// vycházejí ze stejného daňového základu, proto se počítají společně.
//
// Ověřeno přímo z aktuálního tiskopisu ČSSZ (eportal.cssz.cz, staženo
// 2026-07-31) a z textu zákonů 589/1992 a 592/1992 Sb. (soubory v laws/),
// NE z paměti. Zdroj každého vzorce je uvedený u příslušné konstanty.
//
// Záměrně omezený rozsah (jako u DAP/DPH generátoru — viz jejich komentáře):
// - Řeší JEN jeden režim SVČ za rok (jen hlavní, nebo jen vedlejší) — ne
//   souběh obou v jednom roce (tiskopis pak vyžaduje řádky 24/26 "Rozdělení
//   daňového základu", které jsou samy o sobě samostatnou kapitolou pokynů).
// - Neřeší souběh se zaměstnáním (ř. 29 "Vyměřovací základ ze zaměstnání"),
//   slevu na pojistném pro pracující důchodce (ř. 32.2), spolupracující
//   osobu (oddíl J), opravný přehled (oddíl I) ani nemocenské pojištění
//   (dobrovolné, řádek 37 sekce F — výši si určuje OSVČ sama, nejde spočítat).

import {
  SOCIALNI_SAZBA,
  SOCIALNI_ZAKLAD_PODIL,
  SOCIALNI_MIN_ZAKLAD_MESICNE,
  SOCIALNI_MIN_ZAKLAD_MESICNE_NOVA,
  SOCIALNI_MIN_ZAKLAD_MESICNE_VEDLEJSI,
  ZDRAVOTNI_SAZBA,
  ZDRAVOTNI_ZAKLAD_PODIL,
  ZDRAVOTNI_MIN_ZAKLAD_MESICNE,
  PRUMERNA_MZDA,
} from "./tax-constants.js";

// ⚠️ DŮLEŽITÉ: tento přehled SETTLUJE ROK 2025 (přiznání/přehled podávané
// v roce 2026 vždy vyhodnocuje uplynulý kalendářní rok), takže oddíl D
// (skutečné pojistné za rok 2025) musí počítat s minimy PLATNÝMI PRO 2025 —
// ne s aktuálními 2026 hodnotami z tax-constants.js (ty se použijí jen v
// sekci F pro novou zálohu na rok 2026). Průměrná mzda pro 2025 = 46 557 Kč
// (43 682 Kč × koeficient 1,0658) — ověřeno cssz.gov.cz, "Přehled
// nejdůležitějších údajů pro sociální zabezpečení v roce 2025". Minima
// dopočtená stejným vzorcem jako v tax-constants.js (§ 14 odst. 5, ceil):
// 35 % → 16 295 Kč, 25 % → 11 640 Kč, 11 % → 5 122 Kč — všechny 3 hodnoty
// křížově ověřené i jako zveřejněné hotové částky na cssz.gov.cz.
// Math.ceil(450000 * 0.55) === 247501 v JS, i když matematicky přesný
// výsledek je 247500 (binární reprezentace 0.55 není přesná — 450000*0.55
// vyjde jako 247500.00000000003). Bez epsilon by se na reálný tiskopis
// dostalo chybné číslo. 1e-6 je bezpečně pod jakýmkoli skutečným haléřovým
// zbytkem, který má smysl zaokrouhlovat nahoru.
const ceilKc = (n) => Math.ceil(n - 1e-6);

const PRUMERNA_MZDA_2025 = 46_557;
const SOCIALNI_MIN_ZAKLAD_MESICNE_2025 = ceilKc(PRUMERNA_MZDA_2025 * 0.35);
const SOCIALNI_MIN_ZAKLAD_MESICNE_NOVA_2025 = ceilKc(PRUMERNA_MZDA_2025 * 0.25);
const SOCIALNI_MIN_ZAKLAD_MESICNE_VEDLEJSI_2025 = ceilKc(PRUMERNA_MZDA_2025 * 0.11);
// § 15a odst. 5 — 48-násobek průměrné mzdy 2025, ověřeno cssz.gov.cz (2 234 736 Kč).
const SOCIALNI_MAX_ZAKLAD_ROCNE_2025 = PRUMERNA_MZDA_2025 * 48;
// § 3a odst. 2 zákona 592/1992 Sb. — stejný vzorec jako ZDRAVOTNI_MIN_ZAKLAD_MESICNE
// v tax-constants.js, jen dosazená průměrná mzda za rok 2025.
const ZDRAVOTNI_MIN_ZAKLAD_MESICNE_2025 = PRUMERNA_MZDA_2025 * 0.5;

// § 10 odst. 2 zákona č. 155/1995 Sb., o důchodovém pojištění — rozhodná
// částka pro povinnou účast na důchodovém pojištění při vedlejší SVČ, za
// rok 2025 (rozhodné pro TENTO přehled — settluje se rok 2025). Ověřeno
// (mesec.cz, cssz.gov.cz): 111 736 Kč za celý rok, poměrně se snižuje podle
// počtu měsíců vedlejší činnosti.
export const ROZHODNA_CASTKA_VEDLEJSI_2025 = 111_736;
// Stejná částka pro rok 2026 (pro dopočet zálohy v sekci F, pokud OSVČ
// pokračuje ve vedlejší činnosti) — ověřeno (superfaktura.cz, přepočet
// 2,4 × 46 278 Kč × 1,0581): 117 521 Kč.
export const ROZHODNA_CASTKA_VEDLEJSI_2026 = 117_521;

/**
 * Hlavní výpočet — jádro přehledu ČSSZ (sociální pojištění).
 * @param {object} p
 * @param {number} p.zakladDane - ř. 20, daňový základ (dílčí ZD ze samostatné činnosti za rok 2025)
 * @param {"hlavni"|"vedlejsi"} p.typ
 * @param {number} p.pocetMesicu - ř. 22, počet měsíců výkonu SVČ v roce 2025 (1–12)
 * @param {boolean} [p.novaFirma] - jen pro "hlavni": nárok na sníženou minimální VZ 25 % (první 3 roky podnikání)
 * @param {boolean} [p.ucastVedlejsi] - jen pro "vedlejsi": zda vznikla účast na DP (příjem ≥ rozhodná částka, nebo dobrovolné přihlášení)
 * @param {number} p.zalohyZaplacene - ř. 33, úhrn zaplacených záloh na DP za rok 2025
 */
export function computePrehledSocialni({ zakladDane, typ, pocetMesicu, novaFirma, ucastVedlejsi, zalohyZaplacene }) {
  const zd = Math.max(0, Number(zakladDane) || 0);
  const m = Math.min(12, Math.max(1, Number(pocetMesicu) || 12));

  if (typ === "vedlejsi" && !ucastVedlejsi) {
    return {
      ucast: false,
      r20: zd,
      r22: m,
      poznamka:
        "Při vedlejší činnosti bez povinné (nebo dobrovolné) účasti na důchodovém pojištění se sociální pojistné neplatí a přehled ČSSZ v podstatě jen tuto skutečnost oznamuje — oddíl D se nevyplňuje.",
    };
  }

  const r23 = zd / m; // průměrný měsíční daňový základ (informativní řádek)
  // ř. 25: "Součin ř. 20 a čísla 0,55 zaokrouhleno na celé koruny SMĚREM NAHORU"
  // (pokyny ČSSZ k ř. 25) — ne běžné zaokrouhlení, proto ceil, ne round.
  const r25 = ceilKc(zd * SOCIALNI_ZAKLAD_PODIL);

  // Minima PRO ROK 2025 (settlovaný rok) — viz konstanty *_2025 nahoře.
  let minMesicni;
  if (typ === "hlavni") {
    minMesicni = novaFirma ? SOCIALNI_MIN_ZAKLAD_MESICNE_NOVA_2025 : SOCIALNI_MIN_ZAKLAD_MESICNE_2025;
  } else {
    minMesicni = SOCIALNI_MIN_ZAKLAD_MESICNE_VEDLEJSI_2025;
  }
  // ř. 27 minimální VZ = vyšší z (ř. 25, zákonné minimum poměrně za odpracované
  // měsíce), se stropem na maximální roční VZ (pokyny ČSSZ k ř. 27).
  const r27 = Math.min(Math.max(r25, minMesicni * m), SOCIALNI_MAX_ZAKLAD_ROCNE_2025);

  // ř. 28 určený VZ: OSVČ si smí zvolit i vyšší částku (ovlivňuje budoucí
  // důchod), Para defaultně nabízí zákonné minimum — nejběžnější volba.
  const r28 = r27;
  const r30 = r28; // + ř.29 (ze zaměstnání) = 0, mimo rozsah
  const r31 = r30; // vyměřovací základ ze SVČ

  const r32_1 = ceilKc(r31 * SOCIALNI_SAZBA); // pojistné na DP
  const r32_3 = r32_1; // po slevě — sleva pro pracující důchodce mimo rozsah
  const r33 = Math.max(0, Number(zalohyZaplacene) || 0);
  const r34 = r32_3 - r33; // kladné = doplatek, záporné = přeplatek

  return {
    ucast: true,
    r20: zd,
    r22: m,
    r23,
    r25,
    r27,
    r28,
    r30,
    r31,
    r32_1,
    r32_3,
    r33,
    r34,
    doplatek: r34 > 0 ? r34 : 0,
    preplatek: r34 < 0 ? -r34 : 0,
    zastropovano: r25 > SOCIALNI_MAX_ZAKLAD_ROCNE_2025,
  };
}

/**
 * Nová měsíční záloha na DP pro rok 2026 (sekce F, § 14 odst. 2) — 55 % z
 * průměrného měsíčního daňového základu za právě settlovaný rok, nejméně
 * ale zákonné minimum platné pro režim zvolený PRO ROK 2026 (může se lišit
 * od roku 2025, např. konec tříletého zvýhodnění nové firmy).
 * @param {object} p
 * @param {number} p.zakladDane
 * @param {number} p.pocetMesicu
 * @param {"hlavni"|"vedlejsi"} p.typ2026
 * @param {boolean} [p.novaFirma2026]
 */
export function computeNovaZalohaSocialni({ zakladDane, pocetMesicu, typ2026, novaFirma2026 }) {
  const zd = Math.max(0, Number(zakladDane) || 0);
  const m = Math.min(12, Math.max(1, Number(pocetMesicu) || 12));
  const prumerMesicni = zd / m;

  let minMesicni;
  if (typ2026 === "hlavni") {
    minMesicni = novaFirma2026 ? SOCIALNI_MIN_ZAKLAD_MESICNE_NOVA : SOCIALNI_MIN_ZAKLAD_MESICNE;
  } else {
    minMesicni = SOCIALNI_MIN_ZAKLAD_MESICNE_VEDLEJSI;
  }

  // Maximální měsíční VZ = 48-násobek průměrné mzdy 2026 / 12 (pokyny ČSSZ k ř. 35).
  const maxMesicni = ceilKc((PRUMERNA_MZDA * 48) / 12);
  const r35 = Math.min(Math.max(ceilKc(prumerMesicni * SOCIALNI_ZAKLAD_PODIL), minMesicni), maxMesicni);
  const r36 = ceilKc(r35 * SOCIALNI_SAZBA);
  return { r35, r36 };
}

/**
 * Zdravotní pojištění (přehled pro zdravotní pojišťovnu) — na rozdíl od
 * ČSSZ nerozlišuje hlavní/vedlejší SVČ; místo toho existují jmenovité
 * výjimky z minimálního vyměřovacího základu (§ 3a odst. 3 zákona
 * č. 592/1992 Sb.: současné zaměstnání s odvodem aspoň z minima, stát je
 * plátcem pojistného za OSVČ apod.) — na uživateli je posoudit, zda se ho
 * některá týká.
 * @param {object} p
 * @param {number} p.zakladDane
 * @param {number} p.pocetMesicu
 * @param {boolean} p.vyjimkaZMinima
 * @param {number} p.zalohyZaplacene
 */
export function computePrehledZdravotni({ zakladDane, pocetMesicu, vyjimkaZMinima, zalohyZaplacene }) {
  const zd = Math.max(0, Number(zakladDane) || 0);
  const m = Math.min(12, Math.max(1, Number(pocetMesicu) || 12));

  // Zákon (§ 3a odst. 1) nepředepisuje zaokrouhlení tohoto mezivýsledku,
  // jen výsledného pojistného (§ 2 odst. 5: "Pojistné se zaokrouhluje na
  // celé koruny směrem nahoru") — ponecháno přesně, aby se chyba nekupila.
  const vzVypocteny = zd * ZDRAVOTNI_ZAKLAD_PODIL;
  // Settluje se rok 2025 → minimum platné pro 2025 (viz konstanty nahoře), ne aktuální 2026.
  const vzMinimalni = vyjimkaZMinima ? 0 : ZDRAVOTNI_MIN_ZAKLAD_MESICNE_2025 * m;
  const vzUrceny = Math.max(vzVypocteny, vzMinimalni);

  const pojistne = ceilKc(vzUrceny * ZDRAVOTNI_SAZBA);
  const zalohy = Math.max(0, Number(zalohyZaplacene) || 0);
  const rozdil = pojistne - zalohy;

  return {
    vzVypocteny,
    vzMinimalni,
    vzUrceny,
    pojistne,
    zalohy,
    rozdil,
    doplatek: rozdil > 0 ? rozdil : 0,
    preplatek: rozdil < 0 ? -rozdil : 0,
  };
}

/** Nová měsíční záloha na zdravotní pojištění pro rok 2026. */
export function computeNovaZalohaZdravotni({ zakladDane, pocetMesicu, vyjimkaZMinima }) {
  const zd = Math.max(0, Number(zakladDane) || 0);
  const m = Math.min(12, Math.max(1, Number(pocetMesicu) || 12));
  const prumerMesicni = (zd / m) * ZDRAVOTNI_ZAKLAD_PODIL;
  const zaklad = vyjimkaZMinima ? prumerMesicni : Math.max(prumerMesicni, ZDRAVOTNI_MIN_ZAKLAD_MESICNE);
  return { zaklad, zaloha: ceilKc(zaklad * ZDRAVOTNI_SAZBA) };
}

// § 10 odst. 2 zákona 155/1995 Sb., přesně podle pokynů ČSSZ k ř. 25:
// "Tato částka se sníží o částku 9 312 Kč za každý kalendářní měsíc, v němž
// nebyla vykonávána vedlejší SVČ" — odečítá se, nepočítá se poměrem.
const ROZHODNA_CASTKA_SNIZENI_MESIC_2025 = 9_312;

/** Poměrná rozhodná částka pro účast vedlejší SVČ na DP za rok 2025, podle počtu měsíců. */
export function rozhodnaCastkaVedlejsi(pocetMesicu) {
  const m = Math.min(12, Math.max(1, Number(pocetMesicu) || 12));
  return ROZHODNA_CASTKA_VEDLEJSI_2025 - ROZHODNA_CASTKA_SNIZENI_MESIC_2025 * (12 - m);
}

export function formatKc(n) {
  if (n === null || n === undefined || Number.isNaN(n)) return "0 Kč";
  return `${Math.round(n).toLocaleString("cs-CZ")} Kč`;
}

export { PRUMERNA_MZDA };

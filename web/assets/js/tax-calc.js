// Výpočetní jádro kalkuleček - čisté funkce, žádné DOM/UI. Sazby a limity
// viz tax-constants.js (jediné místo, kde se mění, když se zákon novelizuje).
//
// Zjednodušení, která si kalkulačka dovoluje (a proč):
// - Předpokládá se OSVČ vykonávající hlavní činnost celý rok (žádné poměrné
//   snižování minimálního vyměřovacího základu za částečný rok).
// - U s.r.o. se počítá s celým ziskem vyplaceným jako podíl na zisku
//   (dividenda) bez mzdy jednatele - v praxi se často kombinuje mzda +
//   dividenda pro optimalizaci, to už je nad rámec orientační kalkulačky.
// - DPH se do "čistého zisku" nepočítá (je to průběžná položka pro stát,
//   ne příjem/výdaj OSVČ) - jen se zobrazí jako informační poznámka.

import {
  DAN_SAZBA_NIZSI,
  DAN_SAZBA_VYSSI,
  DAN_HRANICE_VYSSI_SAZBA_ODHAD,
  SLEVA_NA_POPLATNIKA,
  PAUSALNI_VYDAJE,
  DAN_PO_SAZBA,
  SRAZKOVA_DAN_DIVIDENDA,
  SOCIALNI_SAZBA,
  SOCIALNI_ZAKLAD_PODIL,
  SOCIALNI_MIN_ZAKLAD_MESICNE,
  ZDRAVOTNI_SAZBA,
  ZDRAVOTNI_ZAKLAD_PODIL,
  ZDRAVOTNI_MIN_ZAKLAD_MESICNE,
} from "./tax-constants.js";

const floorTo = (n, step) => Math.floor(n / step) * step;
const round0 = (n) => Math.round(n);
// Math.ceil(450000 * 0.55) === 247501 v JS místo matematicky přesných
// 247500 (binární reprezentace desetinných sazeb typu 0.55/0.292/0.135 není
// přesná). Epsilon 1e-6 tuhle chybu opraví, aniž by ovlivnil skutečné
// haléřové zbytky, které se opravdu mají zaokrouhlit nahoru.
const ceilKc = (n) => Math.ceil(n - 1e-6);

// § 16 ZDP: základ zaokrouhlený na celá sta dolů, pak 15 %/23 % podle
// hranice, minus základní sleva na poplatníka, nikdy pod nulu.
export function vypocetDanFO(zaklad) {
  const zdanitelny = Math.max(0, floorTo(zaklad, 100));
  const vNizsim = Math.min(zdanitelny, DAN_HRANICE_VYSSI_SAZBA_ODHAD);
  const vVyssim = Math.max(0, zdanitelny - DAN_HRANICE_VYSSI_SAZBA_ODHAD);
  const danPredSlevou = vNizsim * DAN_SAZBA_NIZSI + vVyssim * DAN_SAZBA_VYSSI;
  return Math.max(0, round0(danPredSlevou) - SLEVA_NA_POPLATNIKA);
}

// § 5b/589 a § 3a/592: vyměřovací základ = 50 % ze základu daně (nikdy
// méně než zákonné minimum), pojistné = sazba × základ, zaokrouhleno nahoru.
export function vypocetPojistneOSVC(zakladDane) {
  const kladny = Math.max(0, zakladDane);
  const socialniZaklad = Math.max(kladny * SOCIALNI_ZAKLAD_PODIL, SOCIALNI_MIN_ZAKLAD_MESICNE * 12);
  const zdravotniZaklad = Math.max(kladny * ZDRAVOTNI_ZAKLAD_PODIL, ZDRAVOTNI_MIN_ZAKLAD_MESICNE * 12);
  return {
    socialni: ceilKc(socialniZaklad * SOCIALNI_SAZBA),
    zdravotni: ceilKc(zdravotniZaklad * ZDRAVOTNI_SAZBA),
  };
}

/**
 * @param {object} p
 * @param {number} p.prijem - hrubý roční příjem (Kč)
 * @param {"pausal"|"skutecne"} p.rezim
 * @param {keyof typeof PAUSALNI_VYDAJE} [p.pausalTyp] - povinné pro rezim "pausal"
 * @param {number} [p.skutecneVydaje] - povinné pro rezim "skutecne"
 */
export function vypocetOSVC({ prijem, rezim, pausalTyp, skutecneVydaje }) {
  const prijemN = Math.max(0, Number(prijem) || 0);
  let vydaje = 0;
  let vydajeJsouFiktivni = false;

  if (rezim === "pausal") {
    const def = PAUSALNI_VYDAJE[pausalTyp];
    vydaje = Math.min(prijemN * def.procento, def.maxVydaje);
    vydajeJsouFiktivni = true; // paušál nesnižuje skutečně vyplacenou hotovost
  } else {
    vydaje = Math.max(0, Number(skutecneVydaje) || 0);
  }

  const zaklad = Math.max(0, prijemN - vydaje);
  const dan = vypocetDanFO(zaklad);
  const { socialni, zdravotni } = vypocetPojistneOSVC(zaklad);
  const odvody = dan + socialni + zdravotni;

  // Fiktivní (paušální) výdaje se reálně nevyplácí - v kapse zůstávají.
  const cistyZisk = vydajeJsouFiktivni ? prijemN - odvody : prijemN - vydaje - odvody;

  return {
    rezim,
    prijem: prijemN,
    vydaje,
    zaklad,
    dan,
    socialni,
    zdravotni,
    odvody,
    cistyZisk,
  };
}

/**
 * Zjednodušený model s.r.o.: firma zdaní zisk 21 %, celý zisk po zdanění
 * vyplatí jako podíl na zisku se srážkovou daní 15 %.
 * @param {object} p
 * @param {number} p.prijem
 * @param {number} p.vydaje - skutečné náklady firmy (s.r.o. paušál nemá)
 */
export function vypocetSRO({ prijem, vydaje }) {
  const prijemN = Math.max(0, Number(prijem) || 0);
  const vydajeN = Math.max(0, Number(vydaje) || 0);
  const ziskPredZdanenim = Math.max(0, prijemN - vydajeN);

  const danPO = floorTo(ziskPredZdanenim, 1000) * DAN_PO_SAZBA;
  const danPORounded = round0(danPO);
  const ziskPoZdaneni = ziskPredZdanenim - danPORounded;

  const srazkovaDan = round0(ziskPoZdaneni * SRAZKOVA_DAN_DIVIDENDA);
  const cistyPrijem = ziskPoZdaneni - srazkovaDan;

  return {
    rezim: "sro",
    prijem: prijemN,
    vydaje: vydajeN,
    zaklad: ziskPredZdanenim,
    danPO: danPORounded,
    ziskPoZdaneni,
    srazkovaDan,
    odvody: danPORounded + srazkovaDan,
    cistyZisk: cistyPrijem,
  };
}

export function formatKc(n) {
  return `${Math.round(n).toLocaleString("cs-CZ")} Kč`;
}

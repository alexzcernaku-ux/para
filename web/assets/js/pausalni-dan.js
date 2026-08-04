// Paušální daň (§ 7a zákona č. 586/1992 Sb.) — samostatný režim od normálního
// výdajového paušálu (to je jen procentuální odečet výdajů v § 7 odst. 7,
// pořád v běžném přiznání). Paušální daň nahrazuje daň z příjmů + sociální
// i zdravotní pojistné JEDNOU měsíční platbou a hlavně: kdo se do ní zaregis-
// truje a splní podmínky, obvykle vůbec nepodává daňové přiznání ani Přehled
// OSVČ pro ČSSZ/zdravotní pojišťovnu.
//
// Částky a pásma ověřené z financnisprava.gov.cz ("Informace k institutu
// paušální daně pro rok 2025 a 2026", stejné příjmové limity pro 2026 jako
// 2025) a z dobových zpráv o vyhlášených měsíčních částkách pro 2026
// (9 984 / 16 745 / 27 139 Kč) — ověřeno 2026-08-04, ne z paměti.

// Měsíční platba podle pásma (daň + sociální + zdravotní pojistné dohromady).
export const PASMO_MESICNE = { 1: 9_984, 2: 16_745, 3: 27_139 };

// § 2a odst. 2 zákona 586/1992 Sb. — absolutní strop příjmů pro vstup do
// paušálního režimu, bez ohledu na typ činnosti.
export const PAUSALNI_DAN_MAX_PRIJEM = 2_000_000;

// Typy výdajového paušálu, které se počítají do "≥ 75 % příjmů" pravidla
// pro zvýhodněné (nižší) pásmo — jen 80% a 60% paušál, ne 40%/30%.
const BOOST_ELIGIBLE_TYPES = new Set(["remeslo", "zivnost"]);

/**
 * Určí nejlevnější pásmo, do kterého OSVČ s daným příjmem a (jediným) typem
 * činnosti spadá — nebo null, pokud přesahuje 2 mil. Kč a do režimu vůbec
 * nemůže vstoupit. Zjednodušeno na jeden zdroj příjmu (100 % jedním typem
 * paušálu), což pro orientační srovnání stačí — v realitě se pravidlo
 * "≥ 75 % příjmů" počítá ze součtu více druhů činností.
 */
export function determinePasmo(prijem, pausalTyp) {
  if (prijem > PAUSALNI_DAN_MAX_PRIJEM) return null;
  const boost = BOOST_ELIGIBLE_TYPES.has(pausalTyp);
  const boost80only = pausalTyp === "remeslo";

  if (prijem <= 1_000_000) return 1;
  if (prijem <= 1_500_000) return boost ? 1 : 2;
  // prijem <= 2_000_000
  if (boost80only) return 1;
  if (boost) return 2;
  return 3;
}

/**
 * @param {object} p
 * @param {number} p.prijem - hrubý roční příjem
 * @param {"remeslo"|"zivnost"|"jine"|"najem"} p.pausalTyp
 */
export function vypocetPausalniDan({ prijem, pausalTyp }) {
  const prijemN = Math.max(0, Number(prijem) || 0);
  const pasmo = determinePasmo(prijemN, pausalTyp);
  if (pasmo === null) {
    return { eligible: false, pasmo: null, rocniPlatba: null, cistyZisk: null };
  }
  const mesicniPlatba = PASMO_MESICNE[pasmo];
  const rocniPlatba = mesicniPlatba * 12;
  return {
    eligible: true,
    pasmo,
    mesicniPlatba,
    rocniPlatba,
    cistyZisk: prijemN - rocniPlatba,
  };
}

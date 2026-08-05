// Sazby a limity pro rok 2026 - VŠECHNY na jednom místě, podle zadání.
// Ověřeno přímo v textu nahraných zákonů v databázi (law_chunks), ne z paměti.
// U každé konstanty je uvedený zdrojový paragraf, ať se to dá kdykoliv
// zpětně dohledat/ověřit.
//
// Průměrná mzda pro rok 2026 (viz PRUMERNA_MZDA níže) byla stanovena
// nařízením vlády č. 365/2025 Sb. (všeobecný vyměřovací základ za rok 2024:
// 46 278 Kč × přepočítací koeficient 1,0581 = 48 967 Kč) - ověřeno přes
// cssz.gov.cz a vzp.cz, oba shodně. Z ní se odvozují minimální vyměřovací
// základy níže.

export const TAX_YEAR = 2026;

// --- Daň z příjmů fyzických osob (zákon 586/1992 Sb.) ---------------------
// § 16 odst. 1
export const DAN_SAZBA_NIZSI = 0.15;
export const DAN_SAZBA_VYSSI = 0.23;
// § 16 odst. 1 - hranice = 36-násobek průměrné mzdy (48 967 Kč) pro rok 2026.
// Ponechán název "_ODHAD" kvůli zpětné kompatibilitě importů, hodnota je ale
// ověřená (36 × 48 967 = 1 762 812 Kč).
export const DAN_HRANICE_VYSSI_SAZBA_ODHAD = 1_762_812;

// § 35b odst. 2 písm. a) - základní sleva na poplatníka (roční, na celý rok)
export const SLEVA_NA_POPLATNIKA = 30_840;

// § 7 odst. 7 - výdajové paušály: procento z příjmů a max. částka výdajů
export const PAUSALNI_VYDAJE = {
  remeslo: { label: "Řemeslné živnosti, zemědělství (80 %)", procento: 0.8, maxVydaje: 1_600_000 },
  zivnost: { label: "Ostatní živnosti (60 %)", procento: 0.6, maxVydaje: 1_200_000 },
  jine: { label: "Jiná samostatná činnost, svobodná povolání (40 %)", procento: 0.4, maxVydaje: 800_000 },
  najem: { label: "Nájem majetku v obchodním majetku (30 %)", procento: 0.3, maxVydaje: 600_000 },
};

// --- Daň z příjmů právnických osob - s.r.o. (zákon 586/1992 Sb.) ----------
// § 21 odst. 1
export const DAN_PO_SAZBA = 0.21;
// § 36 - srážková daň z podílu na zisku (dividendy) vyplaceného společníkovi
export const SRAZKOVA_DAN_DIVIDENDA = 0.15;

// --- Sociální pojištění OSVČ (zákon 589/1992 Sb.) --------------------------
// § 7 odst. 1 písm. e) bod 1
export const SOCIALNI_SAZBA = 0.292;
// § 5b odst. 1 - vyměřovací základ = "nejméně 50 % daňového základu před
// rokem 2024 a od roku 2024 55 % daňového základu" (konsolidační balíček
// zvýšil podíl z 50 % na 55 % od roku 2024 - dřívější konstanta 0.5 byla
// zastaralá, opraveno).
export const SOCIALNI_ZAKLAD_PODIL = 0.55;
// Průměrná mzda pro rok 2026 = 48 967 Kč (viz komentář nahoře souboru).
export const PRUMERNA_MZDA = 48_967;
// Zachováno kvůli zpětné kompatibilitě importů pod starým názvem.
export const PRUMERNA_MZDA_ODHAD = PRUMERNA_MZDA;
// § 14 odst. 5 věta první - minimální měsíční vyměřovací základ (hlavní
// činnost) = 35 % průměrné mzdy, zaokrouhleno na celé koruny nahoru
// (§ 14 odst. 13). Pro nově zahájenou hlavní činnost (první 3 kalendářní
// roky) platí 25 % - viz SOCIALNI_MIN_ZAKLAD_MESICNE_NOVA; pro vedlejší
// činnost 11 % - viz SOCIALNI_MIN_ZAKLAD_MESICNE_VEDLEJSI.
// Epsilon kvůli binární nepřesnosti desetinných sazeb (viz ceilKc v
// tax-calc.js/prehled-osvc.js - stejný jev, tady jen jednorázově inline).
const EPS = 1e-6;
export const SOCIALNI_MIN_ZAKLAD_MESICNE = Math.ceil(PRUMERNA_MZDA * 0.35 - EPS);
export const SOCIALNI_MIN_ZAKLAD_MESICNE_NOVA = Math.ceil(PRUMERNA_MZDA * 0.25 - EPS);
export const SOCIALNI_MIN_ZAKLAD_MESICNE_VEDLEJSI = Math.ceil(PRUMERNA_MZDA * 0.11 - EPS);
// § 15a odst. 5 - maximální roční vyměřovací základ OSVČ = 48-násobek
// průměrné mzdy (stejný násobek jako u zaměstnanců, odst. 1).
export const SOCIALNI_MAX_ZAKLAD_ROCNE = PRUMERNA_MZDA * 48;

// --- Zdravotní pojištění OSVČ (zákon 592/1992 Sb.) -------------------------
// § 2 odst. 1
export const ZDRAVOTNI_SAZBA = 0.135;
// § 3a odst. 1 - vyměřovací základ = 50 % základu daně (na rozdíl od
// sociálního pojištění se tento podíl konsolidačním balíčkem neměnil)
export const ZDRAVOTNI_ZAKLAD_PODIL = 0.5;
// § 3a odst. 2 - minimální vyměřovací základ = 12 × 50 % průměrné mzdy
// (roční); měsíčně tedy přesně 50 % průměrné mzdy, BEZ zaokrouhlení na celé
// koruny (zákon zaokrouhlení předepisuje jen pro dopočtené pojistné, ne pro
// tento mezivýsledek - reálná hodnota 24 483,50 Kč má halíře).
export const ZDRAVOTNI_MIN_ZAKLAD_MESICNE = PRUMERNA_MZDA * 0.5;

// --- DPH (zákon 235/2004 Sb.) ------------------------------------------
// § 6 odst. 1 - obrat, od kterého se osoba povinná k dani stává plátcem
export const DPH_LIMIT_OBRAT = 2_000_000;
// § 47 odst. 1 - sazby daně
export const DPH_SAZBA_ZAKLADNI = 0.21;
export const DPH_SAZBA_SNIZENA = 0.12;

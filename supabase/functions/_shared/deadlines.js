// ⚠️ Zrcadlí web/assets/js/deadlines.js - Deno edge function nemůže snadno
// importovat mimo supabase/functions/, takže je to kopie, ne symlink. Změníš
// termín/lhůtu na jednom místě, oprav i to druhé.
//
// Termínovník - počítá povinnosti podle profilu uživatele. Čisté funkce,
// žádné DOM. Lhůty ověřené přímo v textu nahraných zákonů (viz komentář
// u každé položky), ne z paměti.
//
// Zjednodušení (a proč):
// - Daňové přiznání se počítá s "řádnou" lhůtou 3 měsíce po konci roku
//   (papírově/bez poradce) - prodloužení na 4/6 měsíců (elektronicky bez
//   výzvy / s daňovým poradcem nebo auditem) záleží na volbě uživatele,
//   která se dnes v profilu netrackuje. Zobrazujeme nejbližší řádný termín,
//   je vždy nejpřísnější (ostatní varianty jsou později, nikdy dřív).
// - DPH termíny počítáme jako měsíční (§ 99 ZDPH - výchozí zdaňovací
//   období), protože profil zatím neeviduje čtvrtletní volbu (§ 99a).
// - s.r.o. nemá OSVČ přehledy ani měsíční zálohy na pojistné OSVČ - to
//   platí jen fyzická osoba.

const DAY_MS = 24 * 60 * 60 * 1000;

function d(year, monthIndex, day) {
  return new Date(year, monthIndex, day, 12, 0, 0); // poledne, ať nevadí časové pásmo
}

function addMonths(date, months) {
  return new Date(date.getFullYear(), date.getMonth() + months, date.getDate(), 12, 0, 0);
}

function lastDayOfMonth(year, monthIndex) {
  return new Date(year, monthIndex + 1, 0, 12, 0, 0);
}

// Rozdíl v celých kalendářních dnech - porovnává jen rok/měsíc/den, ne
// přesný čas. Bez tohohle by "now" o půlnoci a termín nastavený na poledne
// (viz d()/lastDayOfMonth()) dávaly o den víc, než je ve skutečnosti - a
// e-mailová připomínka "3 dny předem" by ve skutečnosti chodila 4 dny předem.
function daysUntil(date, from) {
  const a = Date.UTC(date.getFullYear(), date.getMonth(), date.getDate());
  const b = Date.UTC(from.getFullYear(), from.getMonth(), from.getDate());
  return Math.round((a - b) / DAY_MS);
}

/**
 * @param {{legal_form?: string, vat_payer?: boolean}} profile
 * @param {Date} [now]
 * @param {object} [opts]
 * @param {number} [opts.horizonDays] - jak daleko dopředu hledat termíny (musí
 *   pokrýt aspoň roční cyklus, jinak by profil bez měsíčních povinností -
 *   typicky s.r.o. bez DPH - část roku neviděl vůbec žádný termín, i když
 *   mu jedno (daňové přiznání) reálně hrozí, jen je zrovna dál než pár týdnů)
 * @param {number} [opts.maxItems] - strop počtu položek pro husté profily
 *   (OSVČ plátce DPH má 3 měsíční povinnosti najednou)
 */
export function computeDeadlines(profile, now = new Date(), opts = {}) {
  const { horizonDays = 400, maxItems = 20 } = opts;
  const items = [];
  const isSro = profile?.legal_form === "sro";
  const isVatPayer = !!profile?.vat_payer;
  const years = [now.getFullYear() - 1, now.getFullYear(), now.getFullYear() + 1];

  for (const y of years) {
    // Daňové přiznání za rok (y-1), řádná lhůta = 3 měsíce po konci
    // zdaňovacího období (daňový řád § 136 odst. 1) → 1. duben roku y.
    const dpDeadline = d(y, 3, 1);
    items.push({
      key: `dp-${y}`,
      title: isSro ? "Daňové přiznání k dani z příjmů právnických osob" : "Daňové přiznání k dani z příjmů",
      date: dpDeadline,
      popis: `Za rok ${y - 1}. Řádná lhůta (papírově) - elektronicky +1 měsíc, s daňovým poradcem/auditem do 1. 7.`,
      zdroj: "Daňový řád, § 136 odst. 1",
      kategorie: "prizna",
    });

    if (!isSro) {
      // Přehled OSVČ pro ČSSZ a zdravotní pojišťovnu - do 1 měsíce od
      // lhůty pro daňové přiznání (§ 15 zák. 589/1992, § 24 zák. 592/1992).
      const prehledDeadline = addMonths(dpDeadline, 1);
      items.push({
        key: `prehled-socialni-${y}`,
        title: "Přehled o příjmech a výdajích - sociální pojištění (ČSSZ)",
        date: prehledDeadline,
        popis: `Za rok ${y - 1}.`,
        zdroj: "Zákon 589/1992 Sb., § 15",
        kategorie: "prehled",
      });
      items.push({
        key: `prehled-zdravotni-${y}`,
        title: "Přehled o příjmech a výdajích - zdravotní pojištění",
        date: prehledDeadline,
        popis: `Za rok ${y - 1}, podává se každé zdravotní pojišťovně, u které jste byli pojištěni.`,
        zdroj: "Zákon 592/1992 Sb., § 24",
        kategorie: "prehled",
      });
    }
  }

  if (!isSro) {
    // Měsíční zálohy OSVČ na pojistné.
    for (const y of [now.getFullYear(), now.getFullYear() + 1]) {
      for (let m = 0; m < 12; m++) {
        // Sociální: splatná do posledního dne měsíce, za který se platí (§ 14a zák. 589/1992).
        items.push({
          key: `zaloha-socialni-${y}-${m}`,
          title: "Záloha na sociální pojištění",
          date: lastDayOfMonth(y, m),
          popis: `Za ${monthName(m)} ${y}.`,
          zdroj: "Zákon 589/1992 Sb., § 14a",
          kategorie: "zaloha",
        });
        // Zdravotní: splatná do 8. dne následujícího měsíce (§ 7 zák. 592/1992).
        const zdrav = addMonths(d(y, m, 8), 1);
        items.push({
          key: `zaloha-zdravotni-${y}-${m}`,
          title: "Záloha na zdravotní pojištění",
          date: zdrav,
          popis: `Za ${monthName(m)} ${y}.`,
          zdroj: "Zákon 592/1992 Sb., § 7",
          kategorie: "zaloha",
        });
      }
    }
  }

  if (isVatPayer) {
    // DPH přiznání + kontrolní hlášení - do 25 dnů po konci měsíce
    // (daňový řád § 136 odst. 4; § 101e zák. o DPH pro kontrolní hlášení).
    for (const y of [now.getFullYear(), now.getFullYear() + 1]) {
      for (let m = 0; m < 12; m++) {
        const dphDeadline = addMonths(d(y, m, 25), 1);
        items.push({
          key: `dph-${y}-${m}`,
          title: "DPH přiznání + kontrolní hlášení",
          date: dphDeadline,
          popis: `Za ${monthName(m)} ${y}. Počítáno jako měsíční plátce - pokud máte čtvrtletní období, termín je jiný.`,
          zdroj: "Daňový řád § 136 odst. 4; zákon 235/2004 Sb. § 101e",
          kategorie: "dph",
        });
      }
    }
  }

  // Prostý "nejbližších N" napříč kategoriemi by u OSVČ plátce DPH (3
  // měsíční povinnosti = zálohy + DPH) vytlačil roční termíny (přiznání,
  // přehledy ČSSZ/zdravotní) úplně mimo okno - ty jsou přitom důležitější
  // (vyšší sankce) než mírně opožděná měsíční záloha. Proto se nejdřív
  // omezí, kolik nejbližších výskytů STEJNÉHO titulu smí projít (u ročních
  // titulů to nikdy nesklouzne, těch je v horizontu jen pár), a teprve pak
  // se aplikuje celkový strop.
  const perTitleLimit = 4;
  const seenPerTitle = new Map();

  return items
    .map((item) => ({ ...item, zbyvaDni: daysUntil(item.date, now) }))
    .filter((item) => item.zbyvaDni >= -1 && item.zbyvaDni <= horizonDays)
    .sort((a, b) => a.date - b.date)
    .filter((item) => {
      const count = seenPerTitle.get(item.title) || 0;
      if (count >= perTitleLimit) return false;
      seenPerTitle.set(item.title, count + 1);
      return true;
    })
    .slice(0, maxItems);
}

function monthName(monthIndex) {
  return [
    "leden", "únor", "březen", "duben", "květen", "červen",
    "červenec", "srpen", "září", "říjen", "listopad", "prosinec",
  ][monthIndex];
}

export function urgencyLevel(zbyvaDni) {
  if (zbyvaDni <= 7) return "urgent";
  if (zbyvaDni <= 21) return "soon";
  return "later";
}

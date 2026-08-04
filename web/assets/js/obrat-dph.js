// Hlídání obratu pro povinnou registraci k DPH (§ 6 odst. 1 zákona
// č. 235/2004 Sb.): osoba povinná k dani je plátcem od prvního dne druhého
// měsíce následujícího po měsíci, ve kterém překročila obrat 2 000 000 Kč
// za nejvýše 12 bezprostředně předcházejících po sobě jdoucích kalendářních
// měsíců (NE kalendářní rok — proto klouzavé okno, ne součet za rok).
//
// Limit sdílený s dph-check.js/dph-generator-page.js (DPH_LIMIT_OBRAT z
// tax-constants.js), aby se číslo neopakovalo na dvou místech.

import { DPH_LIMIT_OBRAT } from "./tax-constants.js";

/**
 * @param {Array<{type: string, amount: number, entry_date: string}>} entries
 * @param {Date} [now]
 */
export function computeObratStatus(entries, now = new Date()) {
  const windowStart = new Date(now.getFullYear(), now.getMonth() - 11, 1);
  const obrat12m = entries
    .filter((e) => e.type === "prijem")
    .filter((e) => new Date(e.entry_date) >= windowStart)
    .reduce((sum, e) => sum + Number(e.amount), 0);

  const percent = Math.min(999, Math.round((obrat12m / DPH_LIMIT_OBRAT) * 100));

  return {
    obrat12m,
    limit: DPH_LIMIT_OBRAT,
    percent,
    prekrocen: obrat12m >= DPH_LIMIT_OBRAT,
    blizkoLimitu: percent >= 80 && obrat12m < DPH_LIMIT_OBRAT,
  };
}

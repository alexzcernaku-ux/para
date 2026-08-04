// Kniha jízd — výpočet náhrady za použití vlastního vozidla při skutečných
// výdajích (§ 24 odst. 2 písm. k) bod 1 zákona č. 586/1992 Sb.): základní
// náhrada za 1 km + náhrada za spotřebované pohonné hmoty. Alternativou je
// paušál na dopravu (§ 24 odst. 2 písm. zt) — ten žádnou knihu jízd
// nevyžaduje, a proto tu není řešený.
//
// Sazby ověřené přímo z vyhlášky MPSV č. 573/2025 Sb. (platná od 1. 1. 2026,
// ppropo.mpsv.cz, ověřeno 2026-08-04), NE z paměti.

export const ZAKLADNI_NAHRADA_KM = 5.9; // Kč/km, osobní silniční motorové vozidlo
export const ZAKLADNI_NAHRADA_KM_MOTO = 1.6; // Kč/km, jednostopá vozidla a tříkolky

export const PRUMERNA_CENA_PHM = {
  benzin95: 34.7,
  benzin98: 39.0,
  nafta: 44.5,
  elektrina: 7.2, // Kč/kWh — spotřeba se pak zadává v kWh/100 km místo l/100 km
};

export const FUEL_LABELS = {
  benzin95: "Benzin 95",
  benzin98: "Benzin 98",
  nafta: "Motorová nafta",
  elektrina: "Elektřina",
  vlastni_cena: "Vlastní cena (doklad o koupi)",
};

/**
 * @param {object} trip
 * @param {number} trip.distance_km
 * @param {number} [trip.consumption_l_100km] - spotřeba dle technického průkazu (l nebo kWh/100 km)
 * @param {string} [trip.fuel_type] - "benzin95"|"benzin98"|"nafta"|"elektrina"|"vlastni_cena"
 * @param {number} [trip.fuel_price_override] - cena za litr/kWh, pokud se dokládá skutečným dokladem
 */
export function computeTripReimbursement(trip) {
  const km = Number(trip.distance_km) || 0;
  const zakladniNahrada = km * ZAKLADNI_NAHRADA_KM;

  const spotreba = Number(trip.consumption_l_100km) || 0;
  let cenaZaLitr = 0;
  if (trip.fuel_type === "vlastni_cena") {
    cenaZaLitr = Number(trip.fuel_price_override) || 0;
  } else if (trip.fuel_type && PRUMERNA_CENA_PHM[trip.fuel_type] !== undefined) {
    cenaZaLitr = PRUMERNA_CENA_PHM[trip.fuel_type];
  }
  const nahradaPhm = km * (spotreba / 100) * cenaZaLitr;

  return {
    zakladniNahrada,
    nahradaPhm,
    celkem: zakladniNahrada + nahradaPhm,
  };
}

export function sumTrips(trips) {
  let distanceKm = 0;
  let zakladniNahrada = 0;
  let nahradaPhm = 0;
  for (const trip of trips) {
    const r = computeTripReimbursement(trip);
    distanceKm += Number(trip.distance_km) || 0;
    zakladniNahrada += r.zakladniNahrada;
    nahradaPhm += r.nahradaPhm;
  }
  return { distanceKm, zakladniNahrada, nahradaPhm, celkem: zakladniNahrada + nahradaPhm };
}

export function formatKc(n) {
  if (n === null || n === undefined || Number.isNaN(n)) return "0 Kč";
  return `${Math.round(n).toLocaleString("cs-CZ")} Kč`;
}

// QR Platba (SPD - Short Payment Descriptor) pro faktury z generator-dokumentu.html.
// Formát ověřen z primárního zdroje: qr-platba.cz/pro-vyvojare/specifikace-formatu
// (Česká bankovní asociace) - SPD*1.0*ACC:<IBAN>*AM:<částka>*CC:CZK*X-VS:...*MSG:...
//
// Vstupní číslo účtu je ale v běžném českém tvaru "předčíslí-číslo/kód banky",
// ne IBAN - ten se musí dopočítat. Algoritmus (ISO 13616, kontrolní součet
// mod-97-10 podle ISO 7064) ověřen na oficiálním testovacím páru
// 19-2000145399/0800 -> CZ6508000000192000145399 (viz cnb.cz / ibantest.com).

// A=10 ... Z=35 pro výpočet kontrolních číslic IBAN.
function letterToDigits(letter) {
  return String(letter.charCodeAt(0) - 55);
}

// Vydělí velké číslo (jako string) číslem 97 po částech - v JS by číslo o
// 20+ cifrách přesáhlo bezpečný rozsah čísel, počítá se proto postupně jako
// na papíře (zbytek po každém kroku se "táhne" k dalším cifrám).
function mod97(numStr) {
  let remainder = 0;
  for (const digit of numStr) {
    remainder = (remainder * 10 + Number(digit)) % 97;
  }
  return remainder;
}

// Převede české číslo účtu (s volitelným předčíslím) na IBAN. Vrací null,
// pokud vstup nejde rozumně naparsovat (např. už je to IBAN, nebo je
// formát jinak neplatný) - QR se pak prostě nevygeneruje, ať appka
// nikdy netiskne vymyšlený/špatný IBAN na fakturu.
export function csAccountToIban(rawAccount) {
  if (!rawAccount) return null;
  const cleaned = rawAccount.replace(/\s+/g, "");
  if (/^CZ\d{22}$/i.test(cleaned)) return cleaned.toUpperCase(); // už je to IBAN

  const match = /^(?:(\d{1,6})-)?(\d{2,10})\/(\d{4})$/.exec(cleaned);
  if (!match) return null;
  const [, prefix, account, bankCode] = match;

  const bban = bankCode.padStart(4, "0") + (prefix || "").padStart(6, "0") + account.padStart(10, "0");
  const rearranged =
    bban +
    letterToDigits("C") +
    letterToDigits("Z") +
    "00";
  const checkDigits = String(98 - mod97(rearranged)).padStart(2, "0");
  return `CZ${checkDigits}${bban}`;
}

// SPD hodnoty nesmí obsahovat "*" (odděluje pole) - v MSG/RN se to v praxi
// nestává (jde o krátký text), pro jistotu se ale i tak escapuje na %2A
// přesně podle specifikace.
function escapeSpdValue(value) {
  return String(value).replace(/\*/g, "%2A");
}

export function buildSpdString({ iban, amountKc, variableSymbol, message }) {
  const parts = [`ACC:${iban}`, `AM:${Number(amountKc).toFixed(2)}`, "CC:CZK"];
  if (variableSymbol) parts.push(`X-VS:${variableSymbol.replace(/\D/g, "").slice(0, 10)}`);
  if (message) parts.push(`MSG:${escapeSpdValue(message).slice(0, 60)}`);
  return `SPD*1.0*${parts.join("*")}`;
}

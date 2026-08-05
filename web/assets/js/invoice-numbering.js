// Sdílené mezi generator-page.js a faktury-page.js - obojí umí založit
// fakturu a obojí by mělo navrhovat číslo stejným způsobem, ať si
// neujíždí (dvě různá čísla pro "další fakturu" podle toho, kde ji zrovna
// založíte, by matlo víc, než kdyby appka nenavrhovala nic).
export function suggestNextInvoiceNumber(invoices, year) {
  const yearPrefix = String(year);
  let maxSeq = 0;
  for (const inv of invoices) {
    const num = String(inv.number || "");
    if (!num.startsWith(yearPrefix)) continue;
    const seq = Number(num.slice(yearPrefix.length));
    if (Number.isInteger(seq) && seq > maxSeq) maxSeq = seq;
  }
  return `${yearPrefix}${String(maxSeq + 1).padStart(3, "0")}`;
}

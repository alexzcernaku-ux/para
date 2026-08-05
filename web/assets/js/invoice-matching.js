// Sdílená heuristika pro párování transakce (import výpisu) nebo ručně
// zapsaného příjmu (evidence.html) s nezaplacenou vystavenou fakturou -
// podle částky, u víc shod se stejnou částkou podle jména protistrany
// v popisu. Bez shody na jméno u víc stejných částek radši nehádá, ať
// neoznačí špatnou fakturu jako uhrazenou.

export function normalizeText(s) {
  return (s || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function findInvoiceMatch(entry, unpaidInvoices) {
  if (entry.type !== "prijem") return null;
  const candidates = unpaidInvoices.filter((inv) => Math.abs(Number(inv.amount) - entry.amount) < 1);
  if (!candidates.length) return null;
  if (candidates.length === 1) return candidates[0];
  const normDesc = normalizeText(entry.description);
  return (
    candidates.find((inv) => {
      const firstWord = normalizeText(inv.counterparty_name).split(" ")[0];
      return firstWord.length > 2 && normDesc.includes(firstWord);
    }) || null
  );
}

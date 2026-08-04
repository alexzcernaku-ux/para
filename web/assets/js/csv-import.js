// Parser bankovních výpisů (CSV) — banky v ČR exportují CSV s různým
// oddělovačem (čárka/středník) a různým desetinným oddělovačem (tečka/čárka),
// proto se oba detekují z obsahu souboru místo pevného nastavení. Sloupce se
// hádají podle typických českých názvů hlaviček (Fio, ČSOB, KB, Raiffeisen
// apod. používají různé názvy, ale významově podobné) — pokud se to nepovede
// spolehlivě, nechá se to na uživateli v UI (mapování sloupců ručně).

function detectDelimiter(sampleLine) {
  const semi = (sampleLine.match(/;/g) || []).length;
  const comma = (sampleLine.match(/,/g) || []).length;
  return semi >= comma ? ";" : ",";
}

function parseCsvLine(line, delimiter) {
  const cells = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"' && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else if (ch === '"') {
        inQuotes = false;
      } else {
        cur += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === delimiter) {
      cells.push(cur);
      cur = "";
    } else {
      cur += ch;
    }
  }
  cells.push(cur);
  return cells.map((c) => c.trim());
}

function parseAmount(raw) {
  if (!raw) return null;
  const cleaned = raw
    .replace(/\s/g, "")
    .replace(/Kč/gi, "")
    .replace(/\./g, (m, offset, str) => (str.indexOf(",") === -1 ? "" : m)) // tečka jako oddělovač tisíců, pokud je i čárka jako desetinná
    .replace(",", ".");
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

function parseDate(raw) {
  if (!raw) return null;
  const trimmed = raw.trim();
  // DD.MM.YYYY nebo DD.MM.YY
  let m = trimmed.match(/^(\d{1,2})\.(\d{1,2})\.(\d{2,4})$/);
  if (m) {
    let [, d, mo, y] = m;
    if (y.length === 2) y = `20${y}`;
    return `${y}-${mo.padStart(2, "0")}-${d.padStart(2, "0")}`;
  }
  // YYYY-MM-DD (už ISO)
  if (/^\d{4}-\d{2}-\d{2}/.test(trimmed)) return trimmed.slice(0, 10);
  return null;
}

const DATE_HEADERS = ["datum", "datum provedení", "datum splatnosti", "date"];
const AMOUNT_HEADERS = ["částka", "objem", "castka", "amount", "částka transakce"];
const DESC_HEADERS = [
  "název protiúčtu", "poznámka", "zpráva pro příjemce", "popis", "komentář",
  "description", "message", "text", "variabilní symbol", "typ transakce",
];

function guessColumnIndex(headers, candidates) {
  const lower = headers.map((h) => h.toLowerCase());
  for (const cand of candidates) {
    const idx = lower.findIndex((h) => h.includes(cand));
    if (idx !== -1) return idx;
  }
  return -1;
}

/**
 * @param {string} text - obsah CSV souboru
 * @returns {{headers: string[], rows: object[], columnGuess: {date: number, amount: number, description: number}}}
 */
export function parseBankCsv(text) {
  const lines = text.split(/\r\n|\n|\r/).filter((l) => l.trim() !== "");
  if (!lines.length) throw new Error("Soubor je prázdný.");

  const delimiter = detectDelimiter(lines[0]);
  const headers = parseCsvLine(lines[0], delimiter);
  const dataLines = lines.slice(1);

  const columnGuess = {
    date: guessColumnIndex(headers, DATE_HEADERS),
    amount: guessColumnIndex(headers, AMOUNT_HEADERS),
    description: guessColumnIndex(headers, DESC_HEADERS),
  };

  const rows = dataLines.map((line) => parseCsvLine(line, delimiter));
  return { headers, rows, columnGuess };
}

export function buildEntriesFromRows(rows, columnMap) {
  return rows
    .map((row) => {
      const rawDate = row[columnMap.date];
      const rawAmount = row[columnMap.amount];
      const rawDesc = columnMap.description >= 0 ? row[columnMap.description] : "";
      const date = parseDate(rawDate);
      const amount = parseAmount(rawAmount);
      if (!date || amount === null) return null;
      return {
        entryDate: date,
        type: amount >= 0 ? "prijem" : "vydaj",
        amount: Math.abs(amount),
        description: rawDesc || "",
        category: "Bankovní import",
      };
    })
    .filter(Boolean);
}

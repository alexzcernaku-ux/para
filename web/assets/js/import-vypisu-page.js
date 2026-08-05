import { requireOnboardedProfile, signOut, insertLedgerEntriesBulk, listInvoices, setInvoicePaid } from "./supabase-client.js";
import { parseBankCsv, buildEntriesFromRows } from "./csv-import.js";

const loadingEl = document.getElementById("page-loading");
const shellEl = document.getElementById("page-shell");
const signoutBtn = document.getElementById("signout-btn");
const dropzone = document.getElementById("dropzone");
const fileInput = document.getElementById("file-input");
const mappingCard = document.getElementById("mapping-card");
const mapDate = document.getElementById("map-date");
const mapAmount = document.getElementById("map-amount");
const mapDescription = document.getElementById("map-description");
const parsedCount = document.getElementById("parsed-count");
const previewTbody = document.getElementById("preview-tbody");
const importBtn = document.getElementById("import-btn");
const importStatus = document.getElementById("import-status");

signoutBtn.addEventListener("click", () => signOut());

function formatKc(n) {
  return `${Math.round(n).toLocaleString("cs-CZ")} Kč`;
}

let userId = null;
let parsed = null; // { headers, rows, columnGuess }
let unpaidInvoices = [];
let previewEntries = []; // poslední výsledek renderPreview(), se spárovanými fakturami
const confirmedMatchIndexes = new Set();

// Spáruje příjem z výpisu s nezaplacenou vystavenou fakturou - jen podle
// částky (a u víc shod podle jména protistrany v popisu transakce), ať se
// nemusí platby k fakturám dohledávat ručně. Bez shody na jméno u víc
// stejných částek radši nehádá, ať neoznačí špatnou fakturu jako uhrazenou.
function normalizeText(s) {
  return (s || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function findInvoiceMatch(entry) {
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

function populateColumnSelects() {
  const opts = parsed.headers.map((h, i) => `<option value="${i}">${h}</option>`).join("");
  mapDate.innerHTML = opts;
  mapAmount.innerHTML = opts;
  mapDescription.innerHTML = `<option value="-1">- žádný -</option>${opts}`;
  mapDate.value = parsed.columnGuess.date >= 0 ? parsed.columnGuess.date : 0;
  mapAmount.value = parsed.columnGuess.amount >= 0 ? parsed.columnGuess.amount : 0;
  mapDescription.value = parsed.columnGuess.description;
}

function currentColumnMap() {
  return {
    date: Number(mapDate.value),
    amount: Number(mapAmount.value),
    description: Number(mapDescription.value),
  };
}

function renderPreview() {
  const entries = buildEntriesFromRows(parsed.rows, currentColumnMap());
  previewEntries = entries;
  confirmedMatchIndexes.clear();
  entries.forEach((e, i) => {
    const match = findInvoiceMatch(e);
    e.matchedInvoice = match;
    if (match) confirmedMatchIndexes.add(i);
  });

  const matchedCount = entries.filter((e) => e.matchedInvoice).length;
  parsedCount.textContent = matchedCount
    ? `Rozpoznáno ${entries.length} z ${parsed.rows.length} řádků, ${matchedCount} spárováno s nezaplacenou fakturou. Zkontrolujte prvních pár řádků níže.`
    : `Rozpoznáno ${entries.length} z ${parsed.rows.length} řádků. Zkontrolujte prvních pár řádků níže.`;

  previewTbody.innerHTML = entries
    .slice(0, 20)
    .map((e, i) => {
      const cls = e.type === "prijem" ? "pos" : "neg";
      const sign = e.type === "prijem" ? "+" : "−";
      const matchCell = e.matchedInvoice
        ? `<label style="display:flex; align-items:center; gap:6px; font-size:12.5px; white-space:nowrap;">
             <input type="checkbox" data-match-idx="${i}" checked />
             č. ${e.matchedInvoice.number || "?"} (${e.matchedInvoice.counterparty_name})
           </label>`
        : "-";
      return `<tr>
        <td data-label="Datum">${e.entryDate}</td>
        <td data-label="Typ">${e.type === "prijem" ? "Příjem" : "Výdaj"}</td>
        <td data-label="Popis">${e.description || "-"}</td>
        <td data-label="Částka" class="amount ${cls}">${sign} ${formatKc(e.amount)}</td>
        <td data-label="Faktura">${matchCell}</td>
      </tr>`;
    })
    .join("");
  if (entries.length > 20) {
    previewTbody.innerHTML += `<tr><td colspan="5" style="text-align:center; color:#94a3b8;">… a dalších ${entries.length - 20} řádků</td></tr>`;
  }

  previewTbody.querySelectorAll("[data-match-idx]").forEach((cb) => {
    cb.addEventListener("change", () => {
      const idx = Number(cb.dataset.matchIdx);
      if (cb.checked) confirmedMatchIndexes.add(idx);
      else confirmedMatchIndexes.delete(idx);
    });
  });

  importBtn.dataset.count = entries.length;
  return entries;
}

function handleFile(file) {
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    try {
      parsed = parseBankCsv(String(reader.result));
      populateColumnSelects();
      renderPreview();
      mappingCard.classList.remove("hidden");
      importStatus.textContent = "";
    } catch (err) {
      alert(`Nepodařilo se přečíst soubor (${err.message}).`);
    }
  };
  reader.readAsText(file, "utf-8");
}

dropzone.addEventListener("click", () => fileInput.click());
fileInput.addEventListener("change", () => handleFile(fileInput.files[0]));
["dragenter", "dragover"].forEach((evt) => dropzone.addEventListener(evt, (e) => { e.preventDefault(); dropzone.classList.add("dragover"); }));
["dragleave", "drop"].forEach((evt) => dropzone.addEventListener(evt, (e) => { e.preventDefault(); dropzone.classList.remove("dragover"); }));
dropzone.addEventListener("drop", (e) => { const f = e.dataTransfer.files[0]; if (f) handleFile(f); });

[mapDate, mapAmount, mapDescription].forEach((sel) => sel.addEventListener("change", renderPreview));

importBtn.addEventListener("click", async () => {
  const entries = previewEntries;
  if (!entries.length) {
    importStatus.textContent = "Nic k importu.";
    return;
  }
  importBtn.disabled = true;
  importStatus.textContent = "Importuji…";
  try {
    await insertLedgerEntriesBulk(
      userId,
      entries.map(({ matchedInvoice, ...e }) => e)
    );

    const toMarkPaid = entries.filter((e, i) => e.matchedInvoice && confirmedMatchIndexes.has(i));
    let paidCount = 0;
    for (const e of toMarkPaid) {
      try {
        await setInvoicePaid(e.matchedInvoice.id, true);
        paidCount++;
      } catch (err) {
        console.error("Nepodařilo se označit fakturu jako uhrazenou:", err.message);
      }
    }

    importStatus.textContent = paidCount
      ? `Hotovo - naimportováno ${entries.length} záznamů, ${paidCount} faktur označeno jako uhrazeno.`
      : `Hotovo - naimportováno ${entries.length} záznamů do evidence.`;
  } catch (err) {
    importStatus.textContent = `Nepodařilo se importovat (${err.message}).`;
  } finally {
    importBtn.disabled = false;
  }
});

(async () => {
  const result = await requireOnboardedProfile();
  if (!result) return;
  userId = result.session.user.id;

  try {
    const invoices = await listInvoices(userId);
    unpaidInvoices = invoices.filter((i) => i.direction === "vystavena" && !i.paid);
  } catch (err) {
    console.error("Nepodařilo se načíst faktury pro párování plateb:", err.message);
    unpaidInvoices = [];
  }

  loadingEl.classList.add("hidden");
  shellEl.classList.remove("hidden");
})();

import { requireOnboardedProfile, signOut, insertLedgerEntriesBulk, listInvoices, setInvoicePaid, listLedgerEntries } from "./supabase-client.js";
import { parseBankCsv, buildEntriesFromRows } from "./csv-import.js";
import { findInvoiceMatch } from "./invoice-matching.js";

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
let existingEntries = [];
let previewEntries = []; // poslední výsledek renderPreview(), se spárovanými fakturami a duplicitami
const confirmedMatchIndexes = new Set();
const forceDuplicateIndexes = new Set();

// Stejný výpis (nebo dva výpisy s překrývajícím se obdobím) se dá nahrát
// omylem dvakrát - bez tyhle kontroly by to potichu zdvojilo každý řádek.
// Shoda na datum + typ + částku není neomylná (dvě různé platby stejný den
// za stejnou částku se stát můžou), proto se to jen navrhne k přeskočení,
// ne rovnou tvrdě zablokuje - viz checkbox "přesto importovat" v náhledu.
function isDuplicateEntry(entry) {
  return existingEntries.some(
    (e) => e.entry_date === entry.entryDate && e.type === entry.type && Math.abs(Number(e.amount) - entry.amount) < 1
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
  forceDuplicateIndexes.clear();
  entries.forEach((e, i) => {
    const match = findInvoiceMatch(e, unpaidInvoices);
    e.matchedInvoice = match;
    if (match) confirmedMatchIndexes.add(i);
    e.isDuplicate = isDuplicateEntry(e);
  });

  const matchedCount = entries.filter((e) => e.matchedInvoice).length;
  const duplicateCount = entries.filter((e) => e.isDuplicate).length;
  const notes = [];
  if (matchedCount) notes.push(`${matchedCount} spárováno s nezaplacenou fakturou`);
  if (duplicateCount) notes.push(`${duplicateCount} vypadá jako už dřív importované (přeskočeno)`);
  parsedCount.textContent = notes.length
    ? `Rozpoznáno ${entries.length} z ${parsed.rows.length} řádků, ${notes.join(", ")}. Zkontrolujte prvních pár řádků níže.`
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
      const statusCell = e.isDuplicate
        ? `<label style="display:flex; align-items:center; gap:6px; font-size:12.5px; white-space:nowrap; color:var(--danger);">
             <input type="checkbox" data-dup-idx="${i}" />
             Už v evidenci - přesto importovat
           </label>`
        : "-";
      return `<tr>
        <td data-label="Datum">${e.entryDate}</td>
        <td data-label="Typ">${e.type === "prijem" ? "Příjem" : "Výdaj"}</td>
        <td data-label="Popis">${e.description || "-"}</td>
        <td data-label="Částka" class="amount ${cls}">${sign} ${formatKc(e.amount)}</td>
        <td data-label="Faktura">${matchCell}</td>
        <td data-label="Stav">${statusCell}</td>
      </tr>`;
    })
    .join("");
  if (entries.length > 20) {
    previewTbody.innerHTML += `<tr><td colspan="6" style="text-align:center; color:#94a3b8;">… a dalších ${entries.length - 20} řádků</td></tr>`;
  }

  previewTbody.querySelectorAll("[data-match-idx]").forEach((cb) => {
    cb.addEventListener("change", () => {
      const idx = Number(cb.dataset.matchIdx);
      if (cb.checked) confirmedMatchIndexes.add(idx);
      else confirmedMatchIndexes.delete(idx);
    });
  });
  previewTbody.querySelectorAll("[data-dup-idx]").forEach((cb) => {
    cb.addEventListener("change", () => {
      const idx = Number(cb.dataset.dupIdx);
      if (cb.checked) forceDuplicateIndexes.add(idx);
      else forceDuplicateIndexes.delete(idx);
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
  const allEntries = previewEntries;
  if (!allEntries.length) {
    importStatus.textContent = "Nic k importu.";
    return;
  }
  const entries = allEntries.filter((e, i) => !e.isDuplicate || forceDuplicateIndexes.has(i));
  const skippedCount = allEntries.length - entries.length;
  if (!entries.length) {
    importStatus.textContent = "Všechny řádky vypadají jako duplicity - nic se neimportovalo.";
    return;
  }

  importBtn.disabled = true;
  importStatus.textContent = "Importuji…";
  try {
    await insertLedgerEntriesBulk(
      userId,
      entries.map(({ matchedInvoice, isDuplicate, ...e }) => e)
    );

    const toMarkPaid = entries.filter((e) => e.matchedInvoice && confirmedMatchIndexes.has(allEntries.indexOf(e)));
    let paidCount = 0;
    for (const e of toMarkPaid) {
      try {
        await setInvoicePaid(e.matchedInvoice.id, true);
        paidCount++;
      } catch (err) {
        console.error("Nepodařilo se označit fakturu jako uhrazenou:", err.message);
      }
    }

    const parts = [`naimportováno ${entries.length} záznamů`];
    if (paidCount) parts.push(`${paidCount} faktur označeno jako uhrazeno`);
    if (skippedCount) parts.push(`${skippedCount} duplicit přeskočeno`);
    importStatus.textContent = `Hotovo - ${parts.join(", ")}.`;
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

  try {
    existingEntries = await listLedgerEntries(userId);
  } catch (err) {
    console.error("Nepodařilo se načíst evidenci pro kontrolu duplicit:", err.message);
    existingEntries = [];
  }

  loadingEl.classList.add("hidden");
  shellEl.classList.remove("hidden");
})();

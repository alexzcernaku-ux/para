import { requireOnboardedProfile, signOut, insertLedgerEntriesBulk } from "./supabase-client.js";
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

function populateColumnSelects() {
  const opts = parsed.headers.map((h, i) => `<option value="${i}">${h}</option>`).join("");
  mapDate.innerHTML = opts;
  mapAmount.innerHTML = opts;
  mapDescription.innerHTML = `<option value="-1">— žádný —</option>${opts}`;
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
  parsedCount.textContent = `Rozpoznáno ${entries.length} z ${parsed.rows.length} řádků. Zkontrolujte prvních pár řádků níže.`;
  previewTbody.innerHTML = entries
    .slice(0, 20)
    .map((e) => {
      const cls = e.type === "prijem" ? "pos" : "neg";
      const sign = e.type === "prijem" ? "+" : "−";
      return `<tr>
        <td data-label="Datum">${e.entryDate}</td>
        <td data-label="Typ">${e.type === "prijem" ? "Příjem" : "Výdaj"}</td>
        <td data-label="Popis">${e.description || "—"}</td>
        <td data-label="Částka" class="amount ${cls}">${sign} ${formatKc(e.amount)}</td>
      </tr>`;
    })
    .join("");
  if (entries.length > 20) {
    previewTbody.innerHTML += `<tr><td colspan="4" style="text-align:center; color:#94a3b8;">… a dalších ${entries.length - 20} řádků</td></tr>`;
  }
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
  const entries = buildEntriesFromRows(parsed.rows, currentColumnMap());
  if (!entries.length) {
    importStatus.textContent = "Nic k importu.";
    return;
  }
  importBtn.disabled = true;
  importStatus.textContent = "Importuji…";
  try {
    await insertLedgerEntriesBulk(userId, entries);
    importStatus.textContent = `Hotovo — naimportováno ${entries.length} záznamů do evidence.`;
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

  loadingEl.classList.add("hidden");
  shellEl.classList.remove("hidden");
})();

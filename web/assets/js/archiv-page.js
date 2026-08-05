import { requireOnboardedProfile, signOut, listGeneratedDocuments, getDocumentDownloadUrl, deleteGeneratedDocument } from "./supabase-client.js";

const loadingEl = document.getElementById("page-loading");
const shellEl = document.getElementById("page-shell");
const signoutBtn = document.getElementById("signout-btn");
const tbody = document.getElementById("archive-tbody");
const tableEl = document.getElementById("archive-table");
const emptyEl = document.getElementById("archive-empty");

signoutBtn.addEventListener("click", () => signOut());

const DOC_TYPE_LABEL = { faktura: "Faktura", storno: "Storno faktury", upominka: "Upomínka", smlouva: "Smlouva o dílo" };

function formatKc(n) {
  if (n === null || n === undefined) return "-";
  return `${Math.round(n).toLocaleString("cs-CZ")} Kč`;
}

let allDocs = [];

function renderTable() {
  if (!allDocs.length) {
    tableEl.classList.add("hidden");
    emptyEl.classList.remove("hidden");
    return;
  }
  emptyEl.classList.add("hidden");
  tableEl.classList.remove("hidden");
  tbody.innerHTML = allDocs
    .map(
      (d) => `
      <tr>
        <td data-label="Datum">${new Date(d.created_at).toLocaleDateString("cs-CZ")}</td>
        <td data-label="Typ"><span class="chip chip-indigo">${DOC_TYPE_LABEL[d.doc_type] || d.doc_type}</span></td>
        <td data-label="Číslo">${d.doc_number || "-"}</td>
        <td data-label="Klient">${d.counterparty_name || "-"}</td>
        <td data-label="Částka" class="amount">${formatKc(d.amount)}</td>
        <td data-label=""><button type="button" class="list-row-edit" data-download="${d.id}" aria-label="Stáhnout"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4" /><path d="M7 10l5 5 5-5M12 15V3" /></svg></button></td>
        <td data-label=""><button type="button" class="list-row-delete" data-del="${d.id}" aria-label="Smazat"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18" /></svg></button></td>
      </tr>`
    )
    .join("");

  tbody.querySelectorAll("[data-download]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const doc = allDocs.find((d) => d.id === Number(btn.dataset.download));
      if (!doc) return;
      btn.disabled = true;
      try {
        const url = await getDocumentDownloadUrl(doc.storage_path);
        window.open(url, "_blank");
      } catch (err) {
        alert(`Nepodařilo se stáhnout doklad (${err.message}).`);
      } finally {
        btn.disabled = false;
      }
    });
  });
  tbody.querySelectorAll("[data-del]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const id = Number(btn.dataset.del);
      const doc = allDocs.find((d) => d.id === id);
      if (!doc) return;
      if (!confirm("Smazat tento doklad z archivu? Stažené kopie zůstanou zachovány, tahle se ale nedá vrátit.")) return;
      btn.disabled = true;
      try {
        await deleteGeneratedDocument(id, doc.storage_path);
        allDocs = allDocs.filter((d) => d.id !== id);
        renderTable();
      } catch (err) {
        alert(`Nepodařilo se smazat doklad (${err.message}).`);
        btn.disabled = false;
      }
    });
  });
}

(async () => {
  const result = await requireOnboardedProfile();
  if (!result) return;
  const { session } = result;

  try {
    allDocs = await listGeneratedDocuments(session.user.id);
  } catch (err) {
    console.error("Nepodařilo se načíst archiv dokladů:", err.message);
    allDocs = [];
  }
  renderTable();

  loadingEl.classList.add("hidden");
  shellEl.classList.remove("hidden");
})();

import { requireOnboardedProfile, signOut, listLedgerEntries, insertLedgerEntry, deleteLedgerEntry, listInvoices, setInvoicePaid } from "./supabase-client.js";
import { CATEGORIES, suggestCategory } from "./categorize.js";
import { findInvoiceMatch } from "./invoice-matching.js";

const loadingEl = document.getElementById("page-loading");
const shellEl = document.getElementById("page-shell");
const signoutBtn = document.getElementById("signout-btn");
const form = document.getElementById("entry-form");
const submitBtn = document.getElementById("entry-submit");
const yearFilter = document.getElementById("year-filter");
const tbody = document.getElementById("entries-tbody");
const tableEl = document.getElementById("entries-table");
const emptyEl = document.getElementById("entries-empty");

signoutBtn.addEventListener("click", () => signOut());

// Bez tohohle klik na Příjem/Výdaj funkčně prošel (radio se přepnul), ale
// vizuálně se nic nezměnilo - .calc-radio-chip.selected se nikde netoggluje
// samo, na rozdíl od stejné komponenty v kalkulacky-page.js apod. Vypadalo to,
// že přepínání nejde vůbec.
const typeGroup = document.getElementById("f-type-group");
const categorySelect = document.getElementById("f-category");

function renderCategoryOptions() {
  const type = typeGroup.querySelector('input[name="f-type"]:checked').value;
  const previous = categorySelect.value;
  categorySelect.innerHTML = CATEGORIES[type].map((c) => `<option>${c}</option>`).join("");
  if (CATEGORIES[type].includes(previous)) categorySelect.value = previous;
}
renderCategoryOptions();

typeGroup.addEventListener("change", () => {
  typeGroup.querySelectorAll(".calc-radio-chip").forEach((chip) => {
    chip.classList.toggle("selected", chip.querySelector("input").checked);
  });
  renderCategoryOptions();
  applyCategorySuggestion();
});

// Auto-návrh kategorie podle popisu (categorize.js) - jen dokud si uživatel
// kategorii sám ručně nezvolí, ať mu appka nepřepisuje vědomou volbu.
const descriptionInput = document.getElementById("f-description");
let categoryTouchedManually = false;
categorySelect.addEventListener("change", () => {
  categoryTouchedManually = true;
});
function applyCategorySuggestion() {
  if (categoryTouchedManually) return;
  const type = typeGroup.querySelector('input[name="f-type"]:checked').value;
  const suggestion = suggestCategory(type, descriptionInput.value);
  if (suggestion && CATEGORIES[type].includes(suggestion)) categorySelect.value = suggestion;
}
descriptionInput.addEventListener("input", applyCategorySuggestion);

function formatKc(n) {
  return `${Math.round(n).toLocaleString("cs-CZ")} Kč`;
}

let userId = null;
let allEntries = [];
let unpaidInvoices = [];

function currentYear() {
  return Number(yearFilter.value);
}

function entriesForYear() {
  const y = currentYear();
  return allEntries.filter((e) => new Date(e.entry_date).getFullYear() === y);
}

function renderSummary(entries) {
  const income = entries.filter((e) => e.type === "prijem").reduce((s, e) => s + Number(e.amount), 0);
  const expense = entries.filter((e) => e.type === "vydaj").reduce((s, e) => s + Number(e.amount), 0);
  document.getElementById("sum-income").textContent = formatKc(income);
  document.getElementById("sum-expense").textContent = formatKc(expense);
  const diffEl = document.getElementById("sum-diff");
  diffEl.textContent = formatKc(income - expense);
  diffEl.parentElement.classList.remove("pos", "neg");
  diffEl.parentElement.classList.add(income - expense >= 0 ? "pos" : "neg");
}

function renderTable(entries) {
  if (!entries.length) {
    tableEl.classList.add("hidden");
    emptyEl.classList.remove("hidden");
    return;
  }
  emptyEl.classList.add("hidden");
  tableEl.classList.remove("hidden");
  tbody.innerHTML = entries
    .map((e) => {
      const dateStr = new Date(e.entry_date).toLocaleDateString("cs-CZ");
      const sign = e.type === "prijem" ? "+" : "−";
      const cls = e.type === "prijem" ? "pos" : "neg";
      const match = e.type === "prijem" ? findInvoiceMatch({ type: e.type, amount: Number(e.amount), description: e.description }, unpaidInvoices) : null;
      const matchCell = match
        ? `<button type="button" class="recurring-action-btn" data-mark-paid="${match.id}">Faktura č. ${match.number || "?"} uhrazena</button>`
        : "-";
      return `
        <tr>
          <td data-label="Datum">${dateStr}</td>
          <td data-label="Kategorie">${e.category || "-"}</td>
          <td data-label="Popis">${e.description || "-"}</td>
          <td data-label="Částka" class="amount ${cls}">${sign} ${formatKc(e.amount)}</td>
          <td data-label="Faktura">${matchCell}</td>
          <td data-label=""><button type="button" class="list-row-delete" data-id="${e.id}" aria-label="Smazat"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18" /></svg></button></td>
        </tr>`;
    })
    .join("");
  tbody.querySelectorAll(".list-row-delete").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const id = Number(btn.dataset.id);
      btn.disabled = true;
      try {
        await deleteLedgerEntry(id);
        allEntries = allEntries.filter((e) => e.id !== id);
        rerender();
      } catch (err) {
        alert(`Nepodařilo se smazat záznam (${err.message}).`);
        btn.disabled = false;
      }
    });
  });
  tbody.querySelectorAll("[data-mark-paid]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const invoiceId = Number(btn.dataset.markPaid);
      btn.disabled = true;
      try {
        await setInvoicePaid(invoiceId, true);
        unpaidInvoices = unpaidInvoices.filter((i) => i.id !== invoiceId);
        rerender();
      } catch (err) {
        alert(`Nepodařilo se označit fakturu jako uhrazenou (${err.message}).`);
        btn.disabled = false;
      }
    });
  });
}

function renderYoy() {
  const yoyCard = document.getElementById("yoy-card");
  const byYear = new Map();
  for (const e of allEntries) {
    const y = new Date(e.entry_date).getFullYear();
    if (!byYear.has(y)) byYear.set(y, { income: 0, expense: 0 });
    const bucket = byYear.get(y);
    if (e.type === "prijem") bucket.income += Number(e.amount);
    else bucket.expense += Number(e.amount);
  }
  if (byYear.size < 2) {
    yoyCard.classList.add("hidden");
    return;
  }
  yoyCard.classList.remove("hidden");
  const years = [...byYear.keys()].sort((a, b) => b - a);
  document.getElementById("yoy-tbody").innerHTML = years
    .map((y) => {
      const { income, expense } = byYear.get(y);
      const diff = income - expense;
      const cls = diff >= 0 ? "pos" : "neg";
      return `<tr>
        <td data-label="Rok"><strong>${y}</strong></td>
        <td data-label="Příjmy" class="amount pos">${formatKc(income)}</td>
        <td data-label="Výdaje" class="amount neg">${formatKc(expense)}</td>
        <td data-label="Rozdíl" class="amount ${cls}">${formatKc(diff)}</td>
      </tr>`;
    })
    .join("");
}

function rerender() {
  const entries = entriesForYear();
  renderSummary(entries);
  renderTable(entries);
  renderYoy();
}

function populateYearFilter() {
  const years = new Set(allEntries.map((e) => new Date(e.entry_date).getFullYear()));
  years.add(new Date().getFullYear());
  const sorted = [...years].sort((a, b) => b - a);
  yearFilter.innerHTML = sorted.map((y) => `<option value="${y}">${y}</option>`).join("");
  yearFilter.value = String(new Date().getFullYear());
}

yearFilter.addEventListener("change", rerender);

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  submitBtn.disabled = true;
  const original = submitBtn.textContent;
  submitBtn.textContent = "Ukládám…";
  try {
    const type = form.querySelector('input[name="f-type"]:checked').value;
    const entry = await insertLedgerEntry(userId, {
      entryDate: document.getElementById("f-date").value,
      type,
      amount: Number(document.getElementById("f-amount").value),
      category: document.getElementById("f-category").value,
      description: document.getElementById("f-description").value.trim(),
    });
    allEntries.unshift(entry);
    const entryYear = String(new Date(entry.entry_date).getFullYear());
    if (![...yearFilter.options].some((o) => o.value === entryYear)) {
      populateYearFilter();
      yearFilter.value = entryYear;
    }
    rerender();
    form.reset();
    document.getElementById("f-date").value = "";
    categoryTouchedManually = false;
    renderCategoryOptions();
  } catch (err) {
    alert(`Nepodařilo se uložit záznam (${err.message}).`);
  } finally {
    submitBtn.disabled = false;
    submitBtn.textContent = original;
  }
});

(async () => {
  const result = await requireOnboardedProfile();
  if (!result) return;
  userId = result.session.user.id;

  try {
    allEntries = await listLedgerEntries(userId);
  } catch (err) {
    console.error("Nepodařilo se načíst evidenci:", err.message);
    allEntries = [];
  }
  try {
    const invoices = await listInvoices(userId);
    unpaidInvoices = invoices.filter((i) => i.direction === "vystavena" && !i.paid);
  } catch (err) {
    console.error("Nepodařilo se načíst faktury pro párování:", err.message);
    unpaidInvoices = [];
  }
  populateYearFilter();
  rerender();

  loadingEl.classList.add("hidden");
  shellEl.classList.remove("hidden");
})();

import {
  requireOnboardedProfile,
  signOut,
  listInvoices,
  insertInvoice,
  deleteInvoice,
  setInvoicePaid,
  listClients,
  upsertClientByName,
} from "./supabase-client.js";
import { suggestNextInvoiceNumber } from "./invoice-numbering.js";

const loadingEl = document.getElementById("page-loading");
const shellEl = document.getElementById("page-shell");
const signoutBtn = document.getElementById("signout-btn");
const form = document.getElementById("invoice-form");
const submitBtn = document.getElementById("invoice-submit");
const tbody = document.getElementById("invoices-tbody");
const tableEl = document.getElementById("invoices-table");
const emptyEl = document.getElementById("invoices-empty");
const directionTabs = document.getElementById("direction-tabs");
const formTitle = document.getElementById("form-title");
const counterpartyLabel = document.getElementById("f-counterparty-label");
const thCounterparty = document.getElementById("th-counterparty");
const counterpartyInput = document.getElementById("f-counterparty");
const counterpartyIcoInput = document.getElementById("f-counterparty-ico");
const clientsDatalist = document.getElementById("clients-datalist");

signoutBtn.addEventListener("click", () => signOut());

let knownClients = [];

// Vybere-li uživatel jméno, které už v klientech je (z datalistu, nebo jen
// přesná shoda při psaní), doplní IČO samo - ať to nemusí hledat znovu.
counterpartyInput.addEventListener("input", () => {
  const match = knownClients.find((c) => c.name.toLowerCase() === counterpartyInput.value.trim().toLowerCase());
  if (match && !counterpartyIcoInput.value) counterpartyIcoInput.value = match.ico || "";
});

function formatKc(n) {
  return `${Math.round(n).toLocaleString("cs-CZ")} Kč`;
}

let userId = null;
let allInvoices = [];
let direction = "vystavena";

const today = new Date().toISOString().slice(0, 10);

function statusOf(inv) {
  if (inv.paid) return "paid";
  if (inv.due_date && inv.due_date < today) return "overdue";
  return "unpaid";
}
const STATUS_LABEL = { paid: "Uhrazeno", unpaid: "Neuhrazeno", overdue: "Po splatnosti" };

directionTabs.querySelectorAll(".doctype-tab").forEach((btn) => {
  btn.addEventListener("click", () => {
    direction = btn.dataset.dir;
    directionTabs.querySelectorAll(".doctype-tab").forEach((b) => b.classList.toggle("active", b === btn));
    const isVystavena = direction === "vystavena";
    formTitle.textContent = isVystavena ? "Přidat vystavenou fakturu" : "Přidat přijatou fakturu";
    counterpartyLabel.textContent = isVystavena ? "Odběratel" : "Dodavatel";
    thCounterparty.textContent = isVystavena ? "Odběratel" : "Dodavatel";
    rerender();
  });
});

function invoicesForDirection() {
  return allInvoices.filter((i) => i.direction === direction);
}

function renderSummary(invoices) {
  const total = invoices.reduce((s, i) => s + Number(i.amount), 0);
  const paid = invoices.filter((i) => statusOf(i) === "paid").reduce((s, i) => s + Number(i.amount), 0);
  const overdue = invoices.filter((i) => statusOf(i) === "overdue").reduce((s, i) => s + Number(i.amount), 0);
  const unpaid = invoices.filter((i) => statusOf(i) !== "paid").reduce((s, i) => s + Number(i.amount), 0);
  document.getElementById("sum-total").textContent = formatKc(total);
  document.getElementById("sum-paid").textContent = formatKc(paid);
  document.getElementById("sum-unpaid").textContent = formatKc(unpaid);
  document.getElementById("sum-overdue").textContent = formatKc(overdue);
}

function renderTable(invoices) {
  if (!invoices.length) {
    tableEl.classList.add("hidden");
    emptyEl.classList.remove("hidden");
    return;
  }
  emptyEl.classList.add("hidden");
  tableEl.classList.remove("hidden");
  tbody.innerHTML = invoices
    .map((inv) => {
      const status = statusOf(inv);
      const issueStr = new Date(inv.issue_date).toLocaleDateString("cs-CZ");
      const dueStr = inv.due_date ? new Date(inv.due_date).toLocaleDateString("cs-CZ") : "-";
      const canRemind = direction === "vystavena" && status === "overdue";
      const remindHref = canRemind
        ? `generator-dokumentu.html?${new URLSearchParams({
            tab: "upominka",
            customerName: inv.counterparty_name || "",
            amount: String(inv.amount),
            originalDocNumber: inv.number || "",
            originalIssueDate: inv.issue_date || "",
            originalDueDate: inv.due_date || "",
          })}`
        : null;
      return `
        <tr>
          <td data-label="Číslo">${inv.number || "-"}</td>
          <td data-label="Firma">${inv.counterparty_name || "-"}</td>
          <td data-label="Vystaveno">${issueStr}</td>
          <td data-label="Splatnost">${dueStr}</td>
          <td data-label="Částka" class="amount">${formatKc(inv.amount)}</td>
          <td data-label="Stav"><button type="button" class="list-status-toggle ${status}" data-id="${inv.id}" data-paid="${inv.paid}">${STATUS_LABEL[status]}</button></td>
          <td data-label="">${canRemind ? `<a href="${remindHref}" target="_blank" class="list-remind-link">Upomínka</a>` : ""}</td>
          <td data-label=""><button type="button" class="list-row-edit" data-duplicate="${inv.id}" aria-label="Duplikovat (fakturovat znovu)" title="Fakturovat znovu"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" /><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1" /></svg></button></td>
          <td data-label=""><button type="button" class="list-row-delete" data-del="${inv.id}" aria-label="Smazat"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18" /></svg></button></td>
        </tr>`;
    })
    .join("");

  tbody.querySelectorAll(".list-status-toggle").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const id = Number(btn.dataset.id);
      const willBePaid = btn.dataset.paid !== "true";
      btn.disabled = true;
      try {
        await setInvoicePaid(id, willBePaid);
        const inv = allInvoices.find((i) => i.id === id);
        inv.paid = willBePaid;
        rerender();
      } catch (err) {
        alert(`Nepodařilo se změnit stav (${err.message}).`);
        btn.disabled = false;
      }
    });
  });
  tbody.querySelectorAll("[data-del]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const id = Number(btn.dataset.del);
      btn.disabled = true;
      try {
        await deleteInvoice(id);
        allInvoices = allInvoices.filter((i) => i.id !== id);
        rerender();
      } catch (err) {
        alert(`Nepodařilo se smazat fakturu (${err.message}).`);
        btn.disabled = false;
      }
    });
  });
  tbody.querySelectorAll("[data-duplicate]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const inv = allInvoices.find((i) => i.id === Number(btn.dataset.duplicate));
      if (!inv) return;
      counterpartyInput.value = inv.counterparty_name || "";
      counterpartyIcoInput.value = inv.counterparty_ico || "";
      document.getElementById("f-amount").value = inv.amount;
      document.getElementById("f-vat").value = inv.vat_amount || "";
      document.getElementById("f-issue").value = today;
      document.getElementById("f-due").value = "";
      document.getElementById("f-number").value = suggestNextInvoiceNumber(
        allInvoices.filter((i) => i.direction === direction),
        new Date().getFullYear()
      );
      form.scrollIntoView({ behavior: "smooth", block: "start" });
      document.getElementById("f-due").focus();
    });
  });
}

function rerender() {
  const invoices = invoicesForDirection();
  renderSummary(invoices);
  renderTable(invoices);
}

function renderClientsDatalist() {
  clientsDatalist.innerHTML = knownClients.map((c) => `<option value="${c.name}"></option>`).join("");
}

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  submitBtn.disabled = true;
  const original = submitBtn.textContent;
  submitBtn.textContent = "Ukládám…";
  try {
    const counterpartyName = counterpartyInput.value.trim();
    const counterpartyIco = counterpartyIcoInput.value.trim();
    const invoice = await insertInvoice(userId, {
      direction,
      number: document.getElementById("f-number").value.trim(),
      counterpartyName,
      counterpartyIco,
      issueDate: document.getElementById("f-issue").value,
      dueDate: document.getElementById("f-due").value,
      amount: Number(document.getElementById("f-amount").value),
      vatAmount: document.getElementById("f-vat").value ? Number(document.getElementById("f-vat").value) : 0,
    });
    allInvoices.unshift(invoice);
    rerender();
    form.reset();

    // Tiše uloží/aktualizuje klienta podle jména - příště se sám nabídne v
    // datalistu, uživatel o to nemusí nijak žádat (viz klienti.html).
    if (counterpartyName) {
      try {
        await upsertClientByName(userId, { name: counterpartyName, ico: counterpartyIco });
        knownClients = await listClients(userId);
        renderClientsDatalist();
      } catch (err) {
        console.error("Nepodařilo se uložit klienta do databáze:", err.message);
      }
    }
  } catch (err) {
    alert(`Nepodařilo se uložit fakturu (${err.message}).`);
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
    allInvoices = await listInvoices(userId);
  } catch (err) {
    console.error("Nepodařilo se načíst faktury:", err.message);
    allInvoices = [];
  }
  rerender();

  try {
    knownClients = await listClients(userId);
    renderClientsDatalist();
  } catch (err) {
    console.error("Nepodařilo se načíst klienty:", err.message);
  }

  loadingEl.classList.add("hidden");
  shellEl.classList.remove("hidden");
})();

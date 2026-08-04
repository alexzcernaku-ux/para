import { requireOnboardedProfile, signOut, listInvoices, insertInvoice, deleteInvoice, setInvoicePaid } from "./supabase-client.js";

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

signoutBtn.addEventListener("click", () => signOut());

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
      const dueStr = inv.due_date ? new Date(inv.due_date).toLocaleDateString("cs-CZ") : "—";
      return `
        <tr>
          <td data-label="Číslo">${inv.number || "—"}</td>
          <td data-label="Firma">${inv.counterparty_name || "—"}</td>
          <td data-label="Vystaveno">${issueStr}</td>
          <td data-label="Splatnost">${dueStr}</td>
          <td data-label="Částka" class="amount">${formatKc(inv.amount)}</td>
          <td data-label="Stav"><button type="button" class="list-status-toggle ${status}" data-id="${inv.id}" data-paid="${inv.paid}">${STATUS_LABEL[status]}</button></td>
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
}

function rerender() {
  const invoices = invoicesForDirection();
  renderSummary(invoices);
  renderTable(invoices);
}

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  submitBtn.disabled = true;
  const original = submitBtn.textContent;
  submitBtn.textContent = "Ukládám…";
  try {
    const invoice = await insertInvoice(userId, {
      direction,
      number: document.getElementById("f-number").value.trim(),
      counterpartyName: document.getElementById("f-counterparty").value.trim(),
      issueDate: document.getElementById("f-issue").value,
      dueDate: document.getElementById("f-due").value,
      amount: Number(document.getElementById("f-amount").value),
      vatAmount: document.getElementById("f-vat").value ? Number(document.getElementById("f-vat").value) : 0,
    });
    allInvoices.unshift(invoice);
    rerender();
    form.reset();
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

  loadingEl.classList.add("hidden");
  shellEl.classList.remove("hidden");
})();

import {
  requireOnboardedProfile,
  signOut,
  listInvoices,
  insertInvoice,
  deleteInvoice,
  setInvoicePaid,
  listClients,
  upsertClientByName,
  listRecurringInvoices,
  insertRecurringInvoice,
  setRecurringInvoiceActive,
  deleteRecurringInvoice,
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

const cashflowTitleEl = document.getElementById("cashflow-title");
const cashflowRowsEl = document.getElementById("cashflow-rows");
const cashflowEmptyEl = document.getElementById("cashflow-empty");

// Rozdělí neuhrazené faktury podle splatnosti do měsíčních "kbelíků" -
// po splatnosti, tento a další dva měsíce, a pak souhrnně později/bez data.
function cashflowBuckets(invoices) {
  const unpaid = invoices.filter((i) => !i.paid);
  const now = new Date();
  const monthKeys = [0, 1, 2].map((offset) => {
    const d = new Date(now.getFullYear(), now.getMonth() + offset, 1);
    return { key: `${d.getFullYear()}-${d.getMonth()}`, label: d.toLocaleDateString("cs-CZ", { month: "long", year: "numeric" }) };
  });

  const buckets = [
    { key: "overdue", label: "Po splatnosti", amount: 0, overdue: true },
    ...monthKeys.map((m) => ({ key: m.key, label: m.label, amount: 0, overdue: false })),
    { key: "later", label: "Později", amount: 0, overdue: false },
  ];

  for (const inv of unpaid) {
    const amount = Number(inv.amount);
    if (!inv.due_date) {
      buckets.find((b) => b.key === "later").amount += amount;
      continue;
    }
    if (inv.due_date < today) {
      buckets.find((b) => b.key === "overdue").amount += amount;
      continue;
    }
    const d = new Date(inv.due_date);
    const key = `${d.getFullYear()}-${d.getMonth()}`;
    const target = buckets.find((b) => b.key === key);
    (target || buckets.find((b) => b.key === "later")).amount += amount;
  }

  return buckets.filter((b) => b.amount > 0);
}

function renderCashflow(invoices) {
  cashflowTitleEl.textContent = direction === "vystavena" ? "Výhled plateb od klientů" : "Výhled plateb dodavatelům";
  const buckets = cashflowBuckets(invoices);
  if (!buckets.length) {
    cashflowRowsEl.innerHTML = "";
    cashflowEmptyEl.classList.remove("hidden");
    return;
  }
  cashflowEmptyEl.classList.add("hidden");
  const max = Math.max(...buckets.map((b) => b.amount));
  cashflowRowsEl.innerHTML = buckets
    .map(
      (b) => `
      <div class="cashflow-row">
        <span class="cashflow-row-label">${b.label}</span>
        <div class="cashflow-bar"><div class="cashflow-bar-fill ${b.overdue ? "overdue" : ""}" style="width:${Math.max(4, (b.amount / max) * 100)}%"></div></div>
        <span class="cashflow-row-amount">${formatKc(b.amount)}</span>
      </div>`
    )
    .join("");
}

function rerender() {
  const invoices = invoicesForDirection();
  renderSummary(invoices);
  renderCashflow(invoices);
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

// --- Opakující se faktury (27_schema_recurring_invoices.sql) ---------------
// Šablona pro pravidelného klienta - denní cron (recurring-invoices-run)
// založí evidenční záznam a pošle připomínku, samotné PDF appka negeneruje
// automaticky (viz komentář v migraci), takže tenhle panel jen spravuje
// šablony, ne hotové doklady.

const INTERVAL_LABEL = { monthly: "Měsíčně", quarterly: "Čtvrtletně", yearly: "Ročně" };
let allRecurring = [];
const recurringForm = document.getElementById("recurring-form");
const recurringListEl = document.getElementById("recurring-list");

function renderRecurringList() {
  if (!allRecurring.length) {
    recurringListEl.innerHTML = `<p class="form-hint">Zatím žádné opakování nastaveno.</p>`;
    return;
  }
  recurringListEl.innerHTML = allRecurring
    .map(
      (r) => `
      <div class="recurring-row">
        <span>${r.counterparty_name} · ${formatKc(r.amount)} · ${INTERVAL_LABEL[r.interval_unit]} · příště ${new Date(r.next_run_date).toLocaleDateString("cs-CZ")}${r.active ? "" : " · pozastaveno"}</span>
        <span class="recurring-actions">
          <button type="button" class="recurring-action-btn" data-toggle="${r.id}">${r.active ? "Pozastavit" : "Obnovit"}</button>
          <button type="button" class="list-row-delete" data-del-recurring="${r.id}" aria-label="Smazat"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18" /></svg></button>
        </span>
      </div>`
    )
    .join("");

  recurringListEl.querySelectorAll("[data-toggle]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const id = Number(btn.dataset.toggle);
      const r = allRecurring.find((x) => x.id === id);
      if (!r) return;
      btn.disabled = true;
      try {
        await setRecurringInvoiceActive(id, !r.active);
        r.active = !r.active;
        renderRecurringList();
      } catch (err) {
        alert(`Nepodařilo se změnit stav opakování (${err.message}).`);
        btn.disabled = false;
      }
    });
  });
  recurringListEl.querySelectorAll("[data-del-recurring]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const id = Number(btn.dataset.delRecurring);
      if (!confirm("Zrušit toto opakování?")) return;
      btn.disabled = true;
      try {
        await deleteRecurringInvoice(id);
        allRecurring = allRecurring.filter((x) => x.id !== id);
        renderRecurringList();
      } catch (err) {
        alert(`Nepodařilo se smazat opakování (${err.message}).`);
        btn.disabled = false;
      }
    });
  });
}

recurringForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  const btn = document.getElementById("recurring-submit");
  btn.disabled = true;
  const original = btn.textContent;
  btn.textContent = "Ukládám…";
  try {
    const counterpartyName = document.getElementById("r-counterparty").value.trim();
    const counterpartyIco = document.getElementById("r-counterparty-ico").value.trim();
    const created = await insertRecurringInvoice(userId, {
      counterpartyName,
      counterpartyIco,
      amount: Number(document.getElementById("r-amount").value),
      vatAmount: document.getElementById("r-vat").value ? Number(document.getElementById("r-vat").value) : 0,
      intervalUnit: document.getElementById("r-interval").value,
      dueDays: Number(document.getElementById("r-due-days").value) || 14,
      nextRunDate: document.getElementById("r-next-date").value,
    });
    allRecurring.push(created);
    allRecurring.sort((a, b) => new Date(a.next_run_date) - new Date(b.next_run_date));
    renderRecurringList();
    recurringForm.reset();
    document.getElementById("r-due-days").value = 14;
    document.getElementById("r-next-date").value = today;

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
    alert(`Nepodařilo se nastavit opakování (${err.message}).`);
  } finally {
    btn.disabled = false;
    btn.textContent = original;
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

  document.getElementById("r-next-date").value = today;
  try {
    allRecurring = await listRecurringInvoices(userId);
  } catch (err) {
    console.error("Nepodařilo se načíst opakující se faktury:", err.message);
    allRecurring = [];
  }
  renderRecurringList();

  loadingEl.classList.add("hidden");
  shellEl.classList.remove("hidden");
})();

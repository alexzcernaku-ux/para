import { requireOnboardedProfile, signOut, listLedgerEntries, listClients, listInvoices, listVehicleTrips, listQueryHistory } from "./supabase-client.js";
import { jsPDF } from "https://esm.sh/jspdf@2.5.1";
import { PLUS_JAKARTA_SANS_NORMAL_BASE64 } from "./fonts/plus-jakarta-sans-normal.js";
import { PLUS_JAKARTA_SANS_BOLD_BASE64 } from "./fonts/plus-jakarta-sans-bold.js";

const loadingEl = document.getElementById("page-loading");
const shellEl = document.getElementById("page-shell");
const signoutBtn = document.getElementById("signout-btn");
const yearSelect = document.getElementById("year-select");
const pdfBtn = document.getElementById("pdf-btn");
const csvBtn = document.getElementById("csv-btn");

signoutBtn.addEventListener("click", () => signOut());

function formatKc(n) {
  return `${Math.round(n).toLocaleString("cs-CZ")} Kč`;
}

let profile = null;
let userId = null;
let allEntries = [];

function entriesForYear(y) {
  return allEntries.filter((e) => new Date(e.entry_date).getFullYear() === y).sort((a, b) => new Date(a.entry_date) - new Date(b.entry_date));
}

function renderPreview() {
  const y = Number(yearSelect.value);
  const entries = entriesForYear(y);
  const income = entries.filter((e) => e.type === "prijem").reduce((s, e) => s + Number(e.amount), 0);
  const expense = entries.filter((e) => e.type === "vydaj").reduce((s, e) => s + Number(e.amount), 0);
  document.getElementById("p-income").textContent = formatKc(income);
  document.getElementById("p-expense").textContent = formatKc(expense);
  document.getElementById("p-diff").textContent = formatKc(income - expense);
  document.getElementById("p-count").textContent = String(entries.length);
}

function populateYears() {
  const years = new Set(allEntries.map((e) => new Date(e.entry_date).getFullYear()));
  years.add(new Date().getFullYear());
  const sorted = [...years].sort((a, b) => b - a);
  yearSelect.innerHTML = sorted.map((y) => `<option value="${y}">${y}</option>`).join("");
  yearSelect.value = String(new Date().getFullYear());
}
yearSelect.addEventListener("change", renderPreview);

function registerFont(doc) {
  doc.addFileToVFS("PlusJakartaSans-Regular.ttf", PLUS_JAKARTA_SANS_NORMAL_BASE64);
  doc.addFont("PlusJakartaSans-Regular.ttf", "PlusJakartaSans", "normal");
  doc.addFileToVFS("PlusJakartaSans-Bold.ttf", PLUS_JAKARTA_SANS_BOLD_BASE64);
  doc.addFont("PlusJakartaSans-Bold.ttf", "PlusJakartaSans", "bold");
  doc.setFont("PlusJakartaSans", "normal");
}

pdfBtn.addEventListener("click", () => {
  const y = Number(yearSelect.value);
  const entries = entriesForYear(y);
  const income = entries.filter((e) => e.type === "prijem").reduce((s, e) => s + Number(e.amount), 0);
  const expense = entries.filter((e) => e.type === "vydaj").reduce((s, e) => s + Number(e.amount), 0);

  const doc = new jsPDF({ unit: "mm", format: "a4" });
  registerFont(doc);
  const MARGIN = 18;
  const WIDTH = 210;
  const PAGE_HEIGHT = 297;
  let y0 = MARGIN;

  doc.setFont("PlusJakartaSans", "bold");
  doc.setFontSize(17);
  doc.setTextColor(15, 23, 42);
  doc.text(`Podklad pro účetního - rok ${y}`, MARGIN, y0);
  y0 += 8;
  doc.setFont("PlusJakartaSans", "normal");
  doc.setFontSize(10);
  doc.setTextColor(51, 65, 85);
  const name = profile.company_name || "";
  const ico = profile.ico ? `IČO: ${profile.ico}` : "";
  doc.text([name, ico].filter(Boolean).join("  ·  "), MARGIN, y0);
  y0 += 10;

  doc.setFont("PlusJakartaSans", "bold");
  doc.setFontSize(11);
  doc.text(`Příjmy: ${formatKc(income)}`, MARGIN, y0);
  doc.text(`Výdaje: ${formatKc(expense)}`, MARGIN + 70, y0);
  doc.text(`Rozdíl: ${formatKc(income - expense)}`, MARGIN + 140, y0);
  y0 += 8;
  doc.setDrawColor(226, 232, 240);
  doc.line(MARGIN, y0, WIDTH - MARGIN, y0);
  y0 += 8;

  doc.setFontSize(9);
  const colX = { date: MARGIN, type: MARGIN + 22, category: MARGIN + 42, desc: MARGIN + 82, amount: WIDTH - MARGIN };
  doc.setFont("PlusJakartaSans", "bold");
  doc.text("Datum", colX.date, y0);
  doc.text("Typ", colX.type, y0);
  doc.text("Kategorie", colX.category, y0);
  doc.text("Popis", colX.desc, y0);
  doc.text("Částka", colX.amount, y0, { align: "right" });
  y0 += 6;
  doc.setFont("PlusJakartaSans", "normal");

  for (const e of entries) {
    if (y0 > PAGE_HEIGHT - 20) {
      doc.addPage();
      y0 = MARGIN;
    }
    doc.setTextColor(51, 65, 85);
    doc.text(new Date(e.entry_date).toLocaleDateString("cs-CZ"), colX.date, y0);
    doc.text(e.type === "prijem" ? "Příjem" : "Výdaj", colX.type, y0);
    doc.text((e.category || "-").slice(0, 22), colX.category, y0);
    doc.text((e.description || "-").slice(0, 34), colX.desc, y0);
    doc.setTextColor(e.type === "prijem" ? 21 : 185, e.type === "prijem" ? 128 : 28, e.type === "prijem" ? 61 : 28);
    doc.text(formatKc(e.amount), colX.amount, y0, { align: "right" });
    y0 += 6;
  }

  const totalPages = doc.internal.getNumberOfPages();
  for (let i = 1; i <= totalPages; i++) {
    doc.setPage(i);
    doc.setFont("PlusJakartaSans", "normal");
    doc.setFontSize(8);
    doc.setTextColor(148, 163, 184);
    doc.text("Para - podklad z evidence příjmů a výdajů, nenahrazuje účetnictví.", MARGIN, PAGE_HEIGHT - 12);
    doc.text(`${i} / ${totalPages}`, WIDTH - MARGIN, PAGE_HEIGHT - 12, { align: "right" });
  }

  doc.save(`para-podklad-${y}.pdf`);
});

// Sdílený CSV builder - středníky (ne čárky) a BOM na začátku, ať to jde
// bez potíží otevřít přímo v české lokalizaci Excelu (desetinná čárka by
// jinak kolidovala s čárkou jako oddělovačem).
function downloadCsv(filename, columns, rows) {
  const esc = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  const header = columns.join(";") + "\n";
  const body = rows.map((row) => row.map(esc).join(";")).join("\n");
  const blob = new Blob([`﻿${header}${body}`], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

csvBtn.addEventListener("click", () => {
  const y = Number(yearSelect.value);
  const entries = entriesForYear(y);
  downloadCsv(
    `para-evidence-${y}.csv`,
    ["Datum", "Typ", "Kategorie", "Popis", "Částka"],
    entries.map((e) => [e.entry_date, e.type === "prijem" ? "Příjem" : "Výdaj", e.category, e.description, String(e.amount).replace(".", ",")])
  );
});

// --- Kompletní export všech dat (GDPR přenositelnost, viz Obchodní podmínky čl. 8) ---

async function exportButton(btn, run) {
  const original = btn.textContent;
  btn.disabled = true;
  btn.textContent = "Připravuji…";
  try {
    await run();
  } catch (err) {
    alert(`Export se nepovedl (${err.message}).`);
  } finally {
    btn.disabled = false;
    btn.textContent = original;
  }
}

document.getElementById("export-clients-btn").addEventListener("click", (e) =>
  exportButton(e.currentTarget, async () => {
    const clients = await listClients(userId);
    downloadCsv(
      "para-klienti.csv",
      ["Název", "IČO", "DIČ", "Adresa", "E-mail", "Telefon", "Poznámka"],
      clients.map((c) => [c.name, c.ico, c.dic, c.address, c.email, c.phone, c.note])
    );
  })
);

document.getElementById("export-invoices-btn").addEventListener("click", (e) =>
  exportButton(e.currentTarget, async () => {
    const invoices = await listInvoices(userId);
    downloadCsv(
      "para-faktury.csv",
      ["Číslo", "Směr", "Odběratel/dodavatel", "IČO", "Vystaveno", "Splatnost", "Částka", "DPH", "Uhrazeno"],
      invoices.map((i) => [
        i.number,
        i.direction === "vystavena" ? "Vystavená" : "Přijatá",
        i.counterparty_name,
        i.counterparty_ico,
        i.issue_date,
        i.due_date,
        String(i.amount).replace(".", ","),
        String(i.vat_amount || 0).replace(".", ","),
        i.paid ? "Ano" : "Ne",
      ])
    );
  })
);

document.getElementById("export-trips-btn").addEventListener("click", (e) =>
  exportButton(e.currentTarget, async () => {
    const trips = await listVehicleTrips(userId);
    downloadCsv(
      "para-kniha-jizd.csv",
      ["Datum", "Účel", "Trasa", "Km", "Spotřeba l/100km", "Palivo"],
      trips.map((t) => [t.trip_date, t.purpose, t.route, t.distance_km, t.consumption_l_100km, t.fuel_type])
    );
  })
);

document.getElementById("export-history-btn").addEventListener("click", (e) =>
  exportButton(e.currentTarget, async () => {
    const history = await listQueryHistory(userId, 100000);
    downloadCsv(
      "para-historie-dotazu.csv",
      ["Datum", "Dotaz", "Odpověď"],
      history.map((h) => [new Date(h.created_at).toLocaleString("cs-CZ"), h.question, h.answer])
    );
  })
);

(async () => {
  const result = await requireOnboardedProfile();
  if (!result) return;
  profile = result.profile;
  userId = result.session.user.id;

  try {
    allEntries = await listLedgerEntries(userId);
  } catch (err) {
    console.error("Nepodařilo se načíst evidenci:", err.message);
    allEntries = [];
  }
  populateYears();
  renderPreview();

  loadingEl.classList.add("hidden");
  shellEl.classList.remove("hidden");
})();

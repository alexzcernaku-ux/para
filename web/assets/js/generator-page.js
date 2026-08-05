// Wiring pro generator-dokumentu.html (Fáze 9) - přepínání typu dokumentu,
// předvyplnění firemních údajů z profilu, dynamické řádky položek u faktury
// a odeslání dat do pdf-documents.js. Auth stejně jako terminy.html /
// kontrola-dokladu.html (requireOnboardedProfile guard).

import {
  requireOnboardedProfile,
  signOut,
  updateProfileBillingInfo,
  listClients,
  upsertClientByName,
  updateInvoiceBranding,
  insertInvoice,
  listInvoices,
} from "./supabase-client.js";
import { csAccountToIban, buildSpdString } from "./qr-platba.js";
import { suggestNextInvoiceNumber } from "./invoice-numbering.js";

let knownClients = [];

// QR Platba (SPD) - vygeneruje se, jen když jde číslo účtu spolehlivě
// převést na IBAN (viz csAccountToIban); jinak faktura vznikne prostě bez
// QR kódu, ne s nesmyslným/špatným kódem.
async function buildInvoiceQrCode({ accountNumber, amountKc, docNumber }) {
  if (!accountNumber) return null;
  const iban = csAccountToIban(accountNumber);
  if (!iban) return null;
  try {
    const QRCode = (await import("https://esm.sh/qrcode@1.5.3")).default;
    const spd = buildSpdString({ iban, amountKc, variableSymbol: docNumber, message: docNumber ? `FAKTURA ${docNumber}` : "" });
    return await QRCode.toDataURL(spd, { errorCorrectionLevel: "M", margin: 1, width: 300 });
  } catch (err) {
    console.error("Nepodařilo se vygenerovat QR platbu:", err.message);
    return null;
  }
}

function renderClientsDatalist() {
  const el = document.getElementById("clients-datalist");
  if (el) el.innerHTML = knownClients.map((c) => `<option value="${c.name}"></option>`).join("");
}

// Vybere-li uživatel jméno z databáze klientů (klienti.html), doplní zbytek
// polí sama - adresu/IČO/DIČ nemusí hledat a přepisovat znovu. Pole, která
// daný formulář nemá (např. upomínka nemá DIČ), se v mapě prostě vynechají.
function attachClientAutofill(nameId, fieldIds) {
  const nameEl = document.getElementById(nameId);
  if (!nameEl) return;
  nameEl.addEventListener("input", () => {
    const match = knownClients.find((c) => c.name.toLowerCase() === nameEl.value.trim().toLowerCase());
    if (!match) return;
    Object.entries(fieldIds).forEach(([field, id]) => {
      const el = document.getElementById(id);
      if (el && !el.value) el.value = match[field] || "";
    });
  });
}

// Tiše uloží/aktualizuje klienta podle jména po úspěšném vygenerování PDF -
// příště se sám nabídne v datalistu (viz upsertClientByName v supabase-client.js).
async function persistClient(userId, clientData) {
  if (!clientData.name) return;
  try {
    await upsertClientByName(userId, clientData);
    knownClients = await listClients(userId);
    renderClientsDatalist();
  } catch (err) {
    console.error("Nepodařilo se uložit klienta do databáze:", err.message);
  }
}

// --- Vzhled dokladů (24_schema_invoice_branding.sql) ------------------------
// Logo/barva/patička pro všechny 4 typy dokumentů - čte a ukládá se z
// jednoho společného panelu nahoře (branding-panel), viz initBrandingPanel().

let logoState = { dataUrl: null, width: null, height: null };

function currentBranding() {
  return {
    brandName: document.getElementById("brand-name-input").value.trim(),
    accentColor: document.getElementById("brand-color-input").value,
    logoDataUrl: logoState.dataUrl,
    logoWidth: logoState.width,
    logoHeight: logoState.height,
    footerNote: document.getElementById("footer-note-input").value.trim(),
  };
}

async function persistBranding(userId) {
  try {
    await updateInvoiceBranding(userId, currentBranding());
  } catch (err) {
    console.error("Nepodařilo se uložit vzhled dokladů:", err.message);
  }
}

function setLogoPreview(dataUrl) {
  const preview = document.getElementById("logo-preview");
  const removeBtn = document.getElementById("logo-remove-btn");
  if (dataUrl) {
    preview.innerHTML = `<img src="${dataUrl}" alt="Logo" />`;
    removeBtn.classList.remove("hidden");
  } else {
    preview.innerHTML =
      '<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" /><circle cx="8.5" cy="8.5" r="1.5" /><path d="M21 15l-5-5L5 21" /></svg>';
    removeBtn.classList.add("hidden");
  }
}

function setActiveSwatch(hex) {
  document.querySelectorAll(".branding-color-swatch").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.color.toLowerCase() === (hex || "").toLowerCase());
  });
}

// Zmenší nahraný obrázek na canvasu, ať base64 v profiles zbytečně
// nenabobtná (žádný Supabase Storage bucket, ukládá se přímo do sloupce,
// viz komentář v 24_schema_invoice_branding.sql) - poměr stran se zachová,
// aby logo v PDF nebylo zdeformované (viz docHeader v pdf-documents.js).
function resizeLogoFile(file) {
  const MAX_W = 300;
  const MAX_H = 100;
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("Nepodařilo se načíst soubor."));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error("Soubor není platný obrázek."));
      img.onload = () => {
        const scale = Math.min(1, MAX_W / img.width, MAX_H / img.height);
        const width = Math.round(img.width * scale);
        const height = Math.round(img.height * scale);
        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        canvas.getContext("2d").drawImage(img, 0, 0, width, height);
        resolve({ dataUrl: canvas.toDataURL("image/png"), width, height });
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}

function initBrandingPanel(profile) {
  document.getElementById("brand-name-input").value = profile.invoice_brand_name || "";
  document.getElementById("footer-note-input").value = profile.invoice_footer_note || "";
  const accentColor = profile.invoice_accent_color || "#6366f1";
  document.getElementById("brand-color-input").value = accentColor;
  setActiveSwatch(accentColor);

  if (profile.invoice_logo_data_url) {
    logoState = { dataUrl: profile.invoice_logo_data_url, width: profile.invoice_logo_width, height: profile.invoice_logo_height };
    setLogoPreview(logoState.dataUrl);
  }

  document.getElementById("color-swatches").addEventListener("click", (e) => {
    const btn = e.target.closest(".branding-color-swatch");
    if (!btn) return;
    document.getElementById("brand-color-input").value = btn.dataset.color;
    setActiveSwatch(btn.dataset.color);
  });
  document.getElementById("brand-color-input").addEventListener("input", (e) => setActiveSwatch(e.target.value));

  document.getElementById("logo-upload-btn").addEventListener("click", () => document.getElementById("logo-file").click());
  document.getElementById("logo-file").addEventListener("change", async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    try {
      logoState = await resizeLogoFile(file);
      setLogoPreview(logoState.dataUrl);
    } catch (err) {
      alert(`Nepodařilo se nahrát logo (${err.message}).`);
    }
    e.target.value = "";
  });
  document.getElementById("logo-remove-btn").addEventListener("click", () => {
    logoState = { dataUrl: null, width: null, height: null };
    setLogoPreview(null);
  });
}

const loadingEl = document.getElementById("page-loading");
const shellEl = document.getElementById("page-shell");
const signoutBtn = document.getElementById("signout-btn");

signoutBtn.addEventListener("click", () => signOut());

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}
function addDaysISO(days) {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}
function removeIconSvg() {
  return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M6 6l12 12M18 6L6 18" /></svg>';
}
function val(id) {
  return document.getElementById(id).value.trim();
}
function num(id) {
  return Number(document.getElementById(id).value) || 0;
}

function setStatus(el, text, isError) {
  el.textContent = text;
  el.classList.toggle("error", !!isError);
}

async function withPdfDownload(btn, statusEl, run) {
  const originalText = btn.textContent;
  btn.disabled = true;
  btn.textContent = "Generuji…";
  setStatus(statusEl, "");
  try {
    await run();
    setStatus(statusEl, "Staženo.");
  } catch (err) {
    console.error("Generování PDF selhalo:", err);
    setStatus(statusEl, `Nepovedlo se vygenerovat PDF (${err.message}).`, true);
  } finally {
    btn.disabled = false;
    btn.textContent = originalText;
  }
}

// --- Přepínání panelů podle vybraného typu dokumentu -----------------------
function initTabs() {
  const tabs = document.querySelectorAll(".doctype-tab");
  const panels = document.querySelectorAll(".doctype-panel");
  tabs.forEach((tab) => {
    tab.addEventListener("click", () => {
      tabs.forEach((t) => t.classList.toggle("active", t === tab));
      panels.forEach((p) => p.classList.toggle("hidden", p.dataset.doctype !== tab.dataset.doctype));
    });
  });
}

function prefillParty(prefix, profile) {
  const nameEl = document.getElementById(`${prefix}-name`);
  const addressEl = document.getElementById(`${prefix}-address`);
  const icoEl = document.getElementById(`${prefix}-ico`);
  const dicEl = document.getElementById(`${prefix}-dic`);
  if (nameEl) nameEl.value = profile.company_name || "";
  if (addressEl) addressEl.value = profile.address || "";
  if (icoEl) icoEl.value = profile.ico || "";
  if (dicEl) dicEl.value = profile.dic || "";
}

function persistBillingInfo(userId, { name, address, ico, dic }) {
  updateProfileBillingInfo(userId, { companyName: name, ico, dic, address }).catch((err) =>
    console.error("Nepodařilo se uložit firemní údaje do profilu:", err.message)
  );
}

// --- Faktura -----------------------------------------------------------
function initFaktura(profile, session, isVatPayer) {
  prefillParty("f-supplier", profile);
  attachClientAutofill("f-customer-name", { address: "f-customer-address", ico: "f-customer-ico", dic: "f-customer-dic" });
  document.getElementById("f-supplier-dic-field").classList.toggle("hidden", !isVatPayer && !profile.dic);
  document.getElementById("f-issue-date").value = todayISO();
  document.getElementById("f-tax-point-date").value = todayISO();
  document.getElementById("f-due-date").value = addDaysISO(14);
  if (!isVatPayer) document.getElementById("f-item-header").classList.add("no-vat");

  const itemsEl = document.getElementById("f-items");
  function addRow() {
    const row = document.createElement("div");
    row.className = `item-row${isVatPayer ? "" : " no-vat"}`;
    row.innerHTML = `
      <input class="text-input item-desc" placeholder="Popis položky" />
      <input type="number" class="text-input" min="0" step="1" value="1" />
      <input type="number" class="text-input" min="0" step="0.01" value="0" />
      ${isVatPayer ? '<select class="text-input"><option value="21">21 %</option><option value="12">12 %</option><option value="0">0 %</option></select>' : ""}
      <button type="button" class="item-row-remove" aria-label="Odebrat položku">${removeIconSvg()}</button>`;
    row.querySelector(".item-row-remove").addEventListener("click", () => {
      if (itemsEl.children.length > 1) row.remove();
    });
    itemsEl.appendChild(row);
  }
  document.getElementById("f-add-item").addEventListener("click", addRow);
  addRow();

  document.getElementById("panel-faktura").addEventListener("submit", (e) => {
    e.preventDefault();
    const btn = document.getElementById("f-submit");
    const statusEl = document.getElementById("f-status");
    withPdfDownload(btn, statusEl, async () => {
      const supplier = {
        name: val("f-supplier-name"),
        address: val("f-supplier-address"),
        ico: val("f-supplier-ico"),
        dic: isVatPayer ? val("f-supplier-dic") : "",
      };
      const items = Array.from(itemsEl.children).map((row) => {
        const inputs = row.querySelectorAll("input");
        const select = row.querySelector("select");
        return {
          description: inputs[0].value.trim() || "Položka",
          quantity: Number(inputs[1].value) || 0,
          unitPrice: Number(inputs[2].value) || 0,
          vatRate: select ? Number(select.value) : 0,
        };
      });
      if (!items.length) throw new Error("Přidejte alespoň jednu položku.");

      const customer = {
        name: val("f-customer-name"),
        address: val("f-customer-address"),
        ico: val("f-customer-ico"),
        dic: val("f-customer-dic"),
      };

      let totalBase = 0;
      let totalVat = 0;
      items.forEach((it) => {
        const lineBase = it.quantity * it.unitPrice;
        totalBase += lineBase;
        if (isVatPayer) totalVat += lineBase * (it.vatRate / 100);
      });

      const accountNumber = val("f-account-number");
      const docNumber = val("f-doc-number");
      const qrCodeDataUrl = await buildInvoiceQrCode({ accountNumber, amountKc: totalBase + totalVat, docNumber });

      const { generateFakturaPdf } = await import("./pdf-documents.js");
      generateFakturaPdf({
        isVatPayer,
        supplier,
        customer,
        docNumber,
        issueDate: val("f-issue-date"),
        taxPointDate: val("f-tax-point-date"),
        dueDate: val("f-due-date"),
        paymentMethod: val("f-payment-method"),
        accountNumber,
        items,
        note: val("f-note"),
        branding: currentBranding(),
        qrCodeDataUrl,
      });
      persistBillingInfo(session.user.id, supplier);
      persistClient(session.user.id, customer);
      persistBranding(session.user.id);

      // Vystavená faktura se rovnou objeví ve Sledování faktur (faktury.html)
      // - dřív bylo potřeba ji tam po vygenerování ještě jednou ručně opsat.
      insertInvoice(session.user.id, {
        direction: "vystavena",
        number: val("f-doc-number"),
        counterpartyName: customer.name,
        counterpartyIco: customer.ico,
        issueDate: val("f-issue-date"),
        dueDate: val("f-due-date"),
        amount: totalBase + totalVat,
        vatAmount: totalVat,
      }).catch((err) => console.error("Nepodařilo se uložit fakturu do evidence:", err.message));
    });
  });
}

// --- Storno faktury ------------------------------------------------------
function initStorno(profile, session, isVatPayer) {
  prefillParty("s-supplier", profile);
  attachClientAutofill("s-customer-name", { address: "s-customer-address", ico: "s-customer-ico", dic: "s-customer-dic" });
  document.getElementById("s-supplier-dic-field").classList.toggle("hidden", !isVatPayer && !profile.dic);
  document.getElementById("s-issue-date").value = todayISO();
  document.getElementById("s-discovery-date").value = todayISO();

  if (!isVatPayer) {
    document.getElementById("s-original-vat").closest(".calc-field").classList.add("hidden");
    document.getElementById("s-corrected-vat").closest(".calc-field").classList.add("hidden");
    document.querySelector('label[for="s-original-base"]').textContent = "Původní částka";
    document.querySelector('label[for="s-corrected-base"]').textContent = "Opravená částka";
  }

  document.getElementById("panel-storno").addEventListener("submit", (e) => {
    e.preventDefault();
    const btn = document.getElementById("s-submit");
    const statusEl = document.getElementById("s-status");
    withPdfDownload(btn, statusEl, async () => {
      const supplier = {
        name: val("s-supplier-name"),
        address: val("s-supplier-address"),
        ico: val("s-supplier-ico"),
        dic: isVatPayer ? val("s-supplier-dic") : "",
      };
      const customer = {
        name: val("s-customer-name"),
        address: val("s-customer-address"),
        ico: val("s-customer-ico"),
        dic: val("s-customer-dic"),
      };
      const { generateStornoPdf } = await import("./pdf-documents.js");
      generateStornoPdf({
        isVatPayer,
        supplier,
        customer,
        docNumber: val("s-doc-number"),
        issueDate: val("s-issue-date"),
        originalDocNumber: val("s-original-doc-number"),
        originalIssueDate: val("s-original-issue-date"),
        discoveryDate: val("s-discovery-date"),
        reason: val("s-reason"),
        originalBase: num("s-original-base"),
        correctedBase: num("s-corrected-base"),
        originalVat: isVatPayer ? num("s-original-vat") : 0,
        correctedVat: isVatPayer ? num("s-corrected-vat") : 0,
        branding: currentBranding(),
      });
      persistBillingInfo(session.user.id, supplier);
      persistClient(session.user.id, customer);
      persistBranding(session.user.id);
    });
  });
}

// --- Upomínka --------------------------------------------------------------
function initUpominka(profile, session) {
  prefillParty("u-supplier", profile);
  attachClientAutofill("u-customer-name", { address: "u-customer-address" });
  document.getElementById("u-issue-date").value = todayISO();
  document.getElementById("u-new-due-date").value = addDaysISO(7);

  document.getElementById("panel-upominka").addEventListener("submit", (e) => {
    e.preventDefault();
    const btn = document.getElementById("u-submit");
    const statusEl = document.getElementById("u-status");
    withPdfDownload(btn, statusEl, async () => {
      const supplier = { name: val("u-supplier-name"), address: val("u-supplier-address") };
      const customer = { name: val("u-customer-name"), address: val("u-customer-address") };
      const { generateUpominkaPdf } = await import("./pdf-documents.js");
      generateUpominkaPdf({
        supplier,
        customer,
        issueDate: val("u-issue-date"),
        originalDocNumber: val("u-original-doc-number"),
        originalIssueDate: val("u-original-issue-date"),
        originalDueDate: val("u-original-due-date"),
        amount: num("u-amount"),
        newDueDate: val("u-new-due-date"),
        includeInterestNote: document.getElementById("u-include-interest").checked,
        note: val("u-note"),
        branding: currentBranding(),
      });
      persistBillingInfo(session.user.id, { ...supplier, ico: profile.ico, dic: profile.dic });
      persistClient(session.user.id, customer);
      persistBranding(session.user.id);
    });
  });
}

// --- Smlouva o dílo ----------------------------------------------------
function initSmlouva(profile, session, isVatPayer) {
  prefillParty("c-contractor", profile);
  attachClientAutofill("c-client-name", { address: "c-client-address", ico: "c-client-ico" });
  document.getElementById("c-contractor-dic-field").classList.toggle("hidden", !isVatPayer && !profile.dic);
  document.getElementById("c-vat-rate-field").classList.toggle("hidden", !isVatPayer);
  document.getElementById("c-sign-date").value = todayISO();
  document.getElementById("c-completion-date").value = addDaysISO(30);

  document.getElementById("panel-smlouva").addEventListener("submit", (e) => {
    e.preventDefault();
    const btn = document.getElementById("c-submit");
    const statusEl = document.getElementById("c-status");
    withPdfDownload(btn, statusEl, async () => {
      const contractor = {
        name: val("c-contractor-name"),
        address: val("c-contractor-address"),
        ico: val("c-contractor-ico"),
        dic: isVatPayer ? val("c-contractor-dic") : "",
      };
      const client = { name: val("c-client-name"), address: val("c-client-address"), ico: val("c-client-ico") };
      const { generateSmlouvaPdf } = await import("./pdf-documents.js");
      generateSmlouvaPdf({
        contractor,
        client,
        subject: val("c-subject"),
        price: num("c-price"),
        isVatPayer,
        vatRate: Number(document.getElementById("c-vat-rate").value) || 0,
        paymentMethod: val("c-payment-method"),
        completionDate: val("c-completion-date"),
        signPlace: val("c-sign-place"),
        signDate: val("c-sign-date"),
        note: val("c-note"),
        branding: currentBranding(),
      });
      persistBillingInfo(session.user.id, contractor);
      persistClient(session.user.id, client);
      persistBranding(session.user.id);
    });
  });
}

// Umožní přijít sem ze Sledování faktur (odkaz "Vygenerovat upomínku" u
// faktury po splatnosti) s předvyplněnými údaji, ať je uživatel nepřepisuje
// ručně - viz faktury-page.js, který tenhle odkaz staví.
function applyPrefillFromQuery() {
  const params = new URLSearchParams(window.location.search);
  const tab = params.get("tab");
  if (!tab) return;

  const tabBtn = document.querySelector(`.doctype-tab[data-doctype="${tab}"]`);
  if (tabBtn) tabBtn.click();

  if (tab === "upominka") {
    const map = {
      customerName: "u-customer-name",
      amount: "u-amount",
      originalDocNumber: "u-original-doc-number",
      originalIssueDate: "u-original-issue-date",
      originalDueDate: "u-original-due-date",
    };
    for (const [param, id] of Object.entries(map)) {
      const v = params.get(param);
      const el = document.getElementById(id);
      if (v && el) el.value = v;
    }
    const newDueEl = document.getElementById("u-new-due-date");
    if (newDueEl && !newDueEl.value) newDueEl.value = addDaysISO(10);
    const issueEl = document.getElementById("u-issue-date");
    if (issueEl && !issueEl.value) issueEl.value = todayISO();
  }
}

(async () => {
  const result = await requireOnboardedProfile();
  if (!result) return;
  const { session, profile } = result;
  const isVatPayer = !!profile.vat_payer;

  try {
    knownClients = await listClients(session.user.id);
    renderClientsDatalist();
  } catch (err) {
    console.error("Nepodařilo se načíst klienty:", err.message);
  }

  try {
    const existingInvoices = await listInvoices(session.user.id);
    const vystavene = existingInvoices.filter((i) => i.direction === "vystavena");
    document.getElementById("f-doc-number").value = suggestNextInvoiceNumber(vystavene, new Date().getFullYear());
  } catch (err) {
    console.error("Nepodařilo se navrhnout číslo faktury:", err.message);
  }

  initBrandingPanel(profile);
  initTabs();
  initFaktura(profile, session, isVatPayer);
  initStorno(profile, session, isVatPayer);
  initUpominka(profile, session);
  initSmlouva(profile, session, isVatPayer);
  applyPrefillFromQuery();

  loadingEl.classList.add("hidden");
  shellEl.classList.remove("hidden");
})();

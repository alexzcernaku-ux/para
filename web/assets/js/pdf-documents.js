// Generátor PDF pro obchodní/účetní dokumenty (Fáze 9) — faktura, storno
// faktury (opravný daňový doklad), upomínka, smlouva o dílo. Stejný princip
// jako pdf-export.js: jsPDF na klientovi, vlastní vložený font kvůli českým
// znakům s diakritikou (viz komentář tam).
//
// Právní náležitosti (ověřeno proti law_chunks / živému e-Sbírka fetchi ve
// Fázi 9, šablony schválené uživatelem):
//  - Faktura jako účetní doklad: §11 zákona č. 563/1991 Sb., o účetnictví.
//  - Je-li dodavatel plátce DPH, navíc daňový doklad dle §29 zákona
//    č. 235/2004 Sb., o dani z přidané hodnoty.
//  - Storno/oprava: opravný daňový doklad dle §45 zákona o DPH (jen je-li
//    dodavatel plátce — neplátce vystavuje běžný dobropis bez DPH náležitostí).
//  - Smlouva o dílo: §2586 a násl. zákona č. 89/2012 Sb., občanský zákoník
//    (NOZ) — v DB není ingestovaný, ověřeno živě přes e-Sbírka infrastrukturu
//    z Fáze 7. Šablona cituje čísla paragrafů, ale text ustanovení
//    neparafrázuje jako závazný výklad — jde o smluvní text, ne právní radu.
//
// Žádný z generovaných dokumentů se nikde neukládá — stejně jako export
// odpovědi z chatu (Fáze 5) jde čistě o stažení na klientovi.

import { jsPDF } from "https://esm.sh/jspdf@2.5.1";
import { PLUS_JAKARTA_SANS_NORMAL_BASE64 } from "./fonts/plus-jakarta-sans-normal.js";
import { PLUS_JAKARTA_SANS_BOLD_BASE64 } from "./fonts/plus-jakarta-sans-bold.js";

const MARGIN = 20;
const PAGE_WIDTH = 210;
const PAGE_HEIGHT = 297;
const CONTENT_WIDTH = PAGE_WIDTH - MARGIN * 2;
const INDIGO = [99, 102, 241];
const NAVY = [15, 23, 42];
const SLATE = [51, 65, 85];
const MUTED = [148, 163, 184];
const LINE = [226, 232, 240];
const MIST = [241, 245, 249];
const DANGER = [220, 38, 38];

const DISCLAIMER =
  "Para není daňové, účetní ani právní poradenství — u důležitých dokumentů si náležitosti ověřte s účetním, případně advokátem.";

function registerFont(doc) {
  doc.addFileToVFS("PlusJakartaSans-Regular.ttf", PLUS_JAKARTA_SANS_NORMAL_BASE64);
  doc.addFont("PlusJakartaSans-Regular.ttf", "PlusJakartaSans", "normal");
  doc.addFileToVFS("PlusJakartaSans-Bold.ttf", PLUS_JAKARTA_SANS_BOLD_BASE64);
  doc.addFont("PlusJakartaSans-Bold.ttf", "PlusJakartaSans", "bold");
  doc.setFont("PlusJakartaSans", "normal");
}

function newPageState() {
  return { page: 1 };
}

function ensureSpace(doc, y, needed, state) {
  if (y + needed > PAGE_HEIGHT - MARGIN - 14) {
    doc.addPage();
    state.page += 1;
    return MARGIN;
  }
  return y;
}

function fmtMoney(n) {
  const num = Number(n);
  if (!isFinite(num)) return "0,00 Kč";
  return num.toLocaleString("cs-CZ", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " Kč";
}

function fmtDate(d) {
  if (!d) return "—";
  const date = typeof d === "string" ? new Date(d) : d;
  if (isNaN(date.getTime())) return "—";
  return date.toLocaleDateString("cs-CZ", { day: "numeric", month: "numeric", year: "numeric" });
}

function docHeader(doc, title, meta) {
  let y = MARGIN;
  doc.setFont("PlusJakartaSans", "bold");
  doc.setFontSize(11);
  doc.setTextColor(...INDIGO);
  doc.text("§ Para", MARGIN, y);

  doc.setFont("PlusJakartaSans", "normal");
  doc.setFontSize(8.5);
  doc.setTextColor(...MUTED);
  doc.text("Vygenerováno v aplikaci Para", PAGE_WIDTH - MARGIN, y, { align: "right" });

  y += 11;
  doc.setFont("PlusJakartaSans", "bold");
  doc.setFontSize(21);
  doc.setTextColor(...NAVY);
  doc.text(title, MARGIN, y);

  if (meta) {
    doc.setFont("PlusJakartaSans", "normal");
    doc.setFontSize(10.5);
    doc.setTextColor(...SLATE);
    doc.text(meta, PAGE_WIDTH - MARGIN, y, { align: "right" });
  }

  y += 6;
  doc.setDrawColor(...LINE);
  doc.setLineWidth(0.4);
  doc.line(MARGIN, y, PAGE_WIDTH - MARGIN, y);
  return y + 10;
}

function drawFooter(doc, note = DISCLAIMER) {
  const totalPages = doc.internal.getNumberOfPages();
  for (let i = 1; i <= totalPages; i++) {
    doc.setPage(i);
    doc.setFont("PlusJakartaSans", "normal");
    doc.setFontSize(7.5);
    doc.setTextColor(...MUTED);
    const wrapped = doc.splitTextToSize(note, CONTENT_WIDTH - 22);
    doc.text(wrapped, MARGIN, PAGE_HEIGHT - 12);
    doc.text(`${i} / ${totalPages}`, PAGE_WIDTH - MARGIN, PAGE_HEIGHT - 12, { align: "right" });
  }
}

// Dvojice bloků "Dodavatel" / "Odběratel" vedle sebe.
function drawParties(doc, y, left, right) {
  const colWidth = (CONTENT_WIDTH - 10) / 2;
  const draw = (block, x) => {
    doc.setFont("PlusJakartaSans", "bold");
    doc.setFontSize(8.5);
    doc.setTextColor(...INDIGO);
    doc.text(block.label.toUpperCase(), x, y);
    let ly = y + 6;
    block.lines.filter(Boolean).forEach((line, i) => {
      doc.setFont("PlusJakartaSans", i === 0 ? "bold" : "normal");
      doc.setFontSize(10);
      doc.setTextColor(...(i === 0 ? NAVY : SLATE));
      const wrapped = doc.splitTextToSize(line, colWidth);
      wrapped.forEach((w) => {
        doc.text(w, x, ly);
        ly += 5;
      });
    });
    return ly;
  };
  const leftEnd = draw(left, MARGIN);
  const rightEnd = draw(right, MARGIN + colWidth + 10);
  return Math.max(leftEnd, rightEnd) + 6;
}

// Řádek "popisek: hodnota" — pro sekci vystavení/splatnosti/platby apod.
function drawFactsRow(doc, y, facts) {
  const colWidth = CONTENT_WIDTH / facts.length;
  facts.forEach((f, i) => {
    const x = MARGIN + i * colWidth;
    doc.setFont("PlusJakartaSans", "bold");
    doc.setFontSize(7.5);
    doc.setTextColor(...MUTED);
    doc.text(f.label.toUpperCase(), x, y);
    doc.setFont("PlusJakartaSans", "normal");
    doc.setFontSize(10.5);
    doc.setTextColor(...NAVY);
    doc.text(String(f.value), x, y + 6);
  });
  return y + 16;
}

// Jednoduchá tabulka se sloupci pevné šířky; poslední sloupce se zarovnávají doprava.
function drawTable(doc, y, state, columns, rows) {
  y = ensureSpace(doc, y, 12, state);
  doc.setFillColor(...MIST);
  doc.rect(MARGIN, y, CONTENT_WIDTH, 8, "F");
  doc.setFont("PlusJakartaSans", "bold");
  doc.setFontSize(8);
  doc.setTextColor(...SLATE);
  let cx = MARGIN;
  columns.forEach((col) => {
    const tx = col.align === "right" ? cx + col.width - 3 : cx + 3;
    doc.text(col.label.toUpperCase(), tx, y + 5.5, { align: col.align === "right" ? "right" : "left" });
    cx += col.width;
  });
  y += 8;

  doc.setFont("PlusJakartaSans", "normal");
  doc.setFontSize(9.5);
  for (const row of rows) {
    const descCol = columns[0];
    const wrapped = doc.splitTextToSize(String(row[0] ?? ""), descCol.width - 6);
    const rowHeight = Math.max(7, wrapped.length * 4.6 + 3);
    y = ensureSpace(doc, y, rowHeight, state);

    cx = MARGIN;
    columns.forEach((col, ci) => {
      const value = ci === 0 ? wrapped : [String(row[ci] ?? "")];
      doc.setTextColor(...(row.negative && ci === columns.length - 1 ? DANGER : SLATE));
      value.forEach((line, li) => {
        const tx = col.align === "right" ? cx + col.width - 3 : cx + 3;
        doc.text(line, tx, y + 5 + li * 4.6, { align: col.align === "right" ? "right" : "left" });
      });
      cx += col.width;
    });
    y += rowHeight;
    doc.setDrawColor(...LINE);
    doc.setLineWidth(0.2);
    doc.line(MARGIN, y, MARGIN + CONTENT_WIDTH, y);
    y += 2;
  }
  return y + 4;
}

function drawSummaryRows(doc, y, state, rows) {
  const boxWidth = 78;
  const x = PAGE_WIDTH - MARGIN - boxWidth;
  for (const r of rows) {
    y = ensureSpace(doc, y, 8, state);
    doc.setFont("PlusJakartaSans", r.strong ? "bold" : "normal");
    doc.setFontSize(r.strong ? 12.5 : 9.5);
    doc.setTextColor(...(r.strong ? NAVY : SLATE));
    doc.text(r.label, x, y);
    doc.text(r.value, x + boxWidth, y, { align: "right" });
    y += r.strong ? 8 : 6.5;
  }
  return y + 4;
}

function drawSectionLabel(doc, text, y) {
  doc.setFont("PlusJakartaSans", "bold");
  doc.setFontSize(9);
  doc.setTextColor(...INDIGO);
  doc.text(text.toUpperCase(), MARGIN, y);
  return y + 7;
}

function drawParagraphText(doc, text, y, state, { fontSize = 10.5, lineHeight = 5.6 } = {}) {
  doc.setFont("PlusJakartaSans", "normal");
  doc.setFontSize(fontSize);
  doc.setTextColor(...SLATE);
  const paragraphs = String(text || "").split(/\n+/).filter((p) => p.trim() !== "");
  for (const para of paragraphs) {
    const wrapped = doc.splitTextToSize(para, CONTENT_WIDTH);
    for (const line of wrapped) {
      y = ensureSpace(doc, y, lineHeight, state);
      doc.text(line, MARGIN, y);
      y += lineHeight;
    }
    y += lineHeight * 0.4;
  }
  return y;
}

function partyLines(p) {
  return [p.name, p.address, p.ico ? `IČO: ${p.ico}` : null, p.dic ? `DIČ: ${p.dic}` : null];
}

function saveDoc(doc, prefix) {
  const dateStr = new Date().toISOString().slice(0, 10);
  doc.save(`${prefix}-${dateStr}.pdf`);
}

// ---------------------------------------------------------------------------
// 1. FAKTURA
// ---------------------------------------------------------------------------
export function generateFakturaPdf(data) {
  const { isVatPayer, supplier, customer, docNumber, issueDate, taxPointDate, dueDate, paymentMethod, accountNumber, items, note } = data;

  const doc = new jsPDF({ unit: "mm", format: "a4" });
  registerFont(doc);
  const state = newPageState();
  let y = docHeader(doc, "Faktura", docNumber ? `č. ${docNumber}` : null);

  y = drawParties(doc, y, { label: "Dodavatel", lines: partyLines(supplier) }, { label: "Odběratel", lines: partyLines(customer) });

  y = drawFactsRow(doc, y, [
    { label: "Vystaveno", value: fmtDate(issueDate) },
    { label: "DUZP", value: fmtDate(taxPointDate) },
    { label: "Splatnost", value: fmtDate(dueDate) },
    { label: "Forma úhrady", value: paymentMethod || "—" },
  ]);
  if (accountNumber) {
    doc.setFont("PlusJakartaSans", "normal");
    doc.setFontSize(9.5);
    doc.setTextColor(...SLATE);
    doc.text(`Číslo účtu: ${accountNumber}`, MARGIN, y - 8);
  }

  const columns = isVatPayer
    ? [
        { label: "Popis", width: CONTENT_WIDTH * 0.42, align: "left" },
        { label: "Množ.", width: CONTENT_WIDTH * 0.1, align: "right" },
        { label: "Jedn. cena", width: CONTENT_WIDTH * 0.16, align: "right" },
        { label: "DPH", width: CONTENT_WIDTH * 0.1, align: "right" },
        { label: "Celkem", width: CONTENT_WIDTH * 0.22, align: "right" },
      ]
    : [
        { label: "Popis", width: CONTENT_WIDTH * 0.52, align: "left" },
        { label: "Množ.", width: CONTENT_WIDTH * 0.14, align: "right" },
        { label: "Jedn. cena", width: CONTENT_WIDTH * 0.16, align: "right" },
        { label: "Celkem", width: CONTENT_WIDTH * 0.18, align: "right" },
      ];

  let totalBase = 0;
  const vatByRate = {};
  const rows = items.map((it) => {
    const qty = Number(it.quantity) || 0;
    const unitPrice = Number(it.unitPrice) || 0;
    const lineBase = qty * unitPrice;
    totalBase += lineBase;
    const rate = isVatPayer ? Number(it.vatRate) || 0 : 0;
    const lineVat = lineBase * (rate / 100);
    if (isVatPayer) vatByRate[rate] = (vatByRate[rate] || 0) + lineVat;
    const lineTotal = lineBase + lineVat;
    return isVatPayer
      ? [it.description, qty, fmtMoney(unitPrice), `${rate} %`, fmtMoney(lineTotal)]
      : [it.description, qty, fmtMoney(unitPrice), fmtMoney(lineTotal)];
  });

  y = drawTable(doc, y, state, columns, rows);

  const summaryRows = [];
  if (isVatPayer) {
    summaryRows.push({ label: "Základ daně celkem", value: fmtMoney(totalBase) });
    Object.entries(vatByRate).forEach(([rate, sum]) => {
      summaryRows.push({ label: `DPH ${rate} %`, value: fmtMoney(sum) });
    });
    const totalVat = Object.values(vatByRate).reduce((a, b) => a + b, 0);
    summaryRows.push({ label: "Celkem k úhradě", value: fmtMoney(totalBase + totalVat), strong: true });
  } else {
    summaryRows.push({ label: "Celkem k úhradě", value: fmtMoney(totalBase), strong: true });
  }
  y = drawSummaryRows(doc, y, state, summaryRows);

  if (!isVatPayer) {
    y = ensureSpace(doc, y, 8, state);
    doc.setFont("PlusJakartaSans", "normal");
    doc.setFontSize(8.5);
    doc.setTextColor(...MUTED);
    doc.text("Dodavatel není plátce DPH.", MARGIN, y);
    y += 8;
  }

  if (note) {
    y = ensureSpace(doc, y, 14, state);
    y = drawSectionLabel(doc, "Poznámka", y);
    y = drawParagraphText(doc, note, y, state, { fontSize: 9.5, lineHeight: 5 });
  }

  drawFooter(
    doc,
    isVatPayer
      ? `${DISCLAIMER} Náležitosti daňového dokladu dle §29 zákona č. 235/2004 Sb., o DPH, a §11 zákona č. 563/1991 Sb., o účetnictví.`
      : `${DISCLAIMER} Náležitosti účetního dokladu dle §11 zákona č. 563/1991 Sb., o účetnictví.`
  );
  saveDoc(doc, "faktura");
}

// ---------------------------------------------------------------------------
// 2. STORNO FAKTURY / OPRAVNÝ DAŇOVÝ DOKLAD
// ---------------------------------------------------------------------------
export function generateStornoPdf(data) {
  const {
    isVatPayer,
    supplier,
    customer,
    docNumber,
    issueDate,
    originalDocNumber,
    originalIssueDate,
    reason,
    discoveryDate,
    originalBase,
    correctedBase,
    originalVat,
    correctedVat,
  } = data;

  const doc = new jsPDF({ unit: "mm", format: "a4" });
  registerFont(doc);
  const state = newPageState();
  let y = docHeader(doc, isVatPayer ? "Opravný daňový doklad" : "Dobropis", docNumber ? `č. ${docNumber}` : null);

  y = drawParties(doc, y, { label: "Dodavatel", lines: partyLines(supplier) }, { label: "Odběratel", lines: partyLines(customer) });

  y = drawFactsRow(doc, y, [
    { label: "Vystaveno", value: fmtDate(issueDate) },
    { label: "Opravuje doklad", value: originalDocNumber || "—" },
    { label: "Původní vystavení", value: fmtDate(originalIssueDate) },
    { label: "Zjištěn důvod", value: fmtDate(discoveryDate) },
  ]);

  y = drawSectionLabel(doc, "Důvod opravy", y);
  y = drawParagraphText(doc, reason, y, state);
  y += 4;

  const origBase = Number(originalBase) || 0;
  const corrBase = Number(correctedBase) || 0;
  const origVat = isVatPayer ? Number(originalVat) || 0 : 0;
  const corrVat = isVatPayer ? Number(correctedVat) || 0 : 0;
  const origTotal = origBase + origVat;
  const corrTotal = corrBase + corrVat;
  const diffTotal = corrTotal - origTotal;

  const columns = [
    { label: isVatPayer ? "Základ daně" : "Částka", width: CONTENT_WIDTH * 0.4, align: "left" },
    { label: "Původně", width: CONTENT_WIDTH * 0.2, align: "right" },
    { label: "Opraveno", width: CONTENT_WIDTH * 0.2, align: "right" },
    { label: "Rozdíl", width: CONTENT_WIDTH * 0.2, align: "right" },
  ];
  const rows = [];
  if (isVatPayer) {
    rows.push([
      "Základ daně",
      fmtMoney(origBase),
      fmtMoney(corrBase),
      fmtMoney(corrBase - origBase),
    ]);
    rows.push([
      "DPH",
      fmtMoney(origVat),
      fmtMoney(corrVat),
      fmtMoney(corrVat - origVat),
    ]);
  }
  const totalRow = ["Celkem", fmtMoney(origTotal), fmtMoney(corrTotal), fmtMoney(diffTotal)];
  totalRow.negative = diffTotal < 0;
  rows.push(totalRow);

  y = drawTable(doc, y, state, columns, rows);

  y = drawSummaryRows(doc, y, state, [
    { label: diffTotal < 0 ? "Vratka (dobropis)" : "Doplatek", value: fmtMoney(Math.abs(diffTotal)), strong: true },
  ]);

  drawFooter(
    doc,
    isVatPayer
      ? `${DISCLAIMER} Náležitosti opravného daňového dokladu dle §45 zákona č. 235/2004 Sb., o DPH.`
      : DISCLAIMER
  );
  saveDoc(doc, "storno-faktury");
}

// ---------------------------------------------------------------------------
// 3. UPOMÍNKA
// ---------------------------------------------------------------------------
export function generateUpominkaPdf(data) {
  const { supplier, customer, issueDate, originalDocNumber, originalIssueDate, originalDueDate, amount, newDueDate, includeInterestNote, note } = data;

  const doc = new jsPDF({ unit: "mm", format: "a4" });
  registerFont(doc);
  const state = newPageState();
  let y = docHeader(doc, "Upomínka", `k faktuře ${originalDocNumber || ""}`.trim());

  y = drawParties(doc, y, { label: "Odesílatel", lines: partyLines(supplier) }, { label: "Adresováno", lines: partyLines(customer) });

  y = drawFactsRow(doc, y, [
    { label: "Vystaveno", value: fmtDate(issueDate) },
    { label: "Faktura ze dne", value: fmtDate(originalIssueDate) },
    { label: "Původní splatnost", value: fmtDate(originalDueDate) },
    { label: "Dlužná částka", value: fmtMoney(amount) },
  ]);

  y = drawSectionLabel(doc, "Text upomínky", y);
  const body =
    `Vážený obchodní partnere,\n\n` +
    `dovolujeme si Vás upozornit, že faktura č. ${originalDocNumber || "—"} ze dne ${fmtDate(originalIssueDate)} ` +
    `se splatností ${fmtDate(originalDueDate)} na částku ${fmtMoney(amount)} nebyla dosud uhrazena.\n\n` +
    `Žádáme Vás o úhradu dlužné částky nejpozději do ${fmtDate(newDueDate)}. Pokud jste platbu již odeslali, ` +
    `považujte prosím tuto upomínku za bezpředmětnou.`;
  y = drawParagraphText(doc, body, y, state);

  if (includeInterestNote) {
    y += 2;
    y = drawParagraphText(
      doc,
      "V případě prodlení s úhradou vzniká podle §1970 zákona č. 89/2012 Sb., občanského zákoníku, nárok na úrok z prodlení, " +
        "jehož výši stanoví nařízení vlády č. 351/2013 Sb. Konkrétní sazbu k datu splatnosti doporučujeme ověřit před jejím vyčíslením.",
      y,
      state,
      { fontSize: 9, lineHeight: 4.8 }
    );
  }

  if (note) {
    y += 2;
    y = drawSectionLabel(doc, "Poznámka", y);
    y = drawParagraphText(doc, note, y, state, { fontSize: 9.5, lineHeight: 5 });
  }

  drawFooter(doc, DISCLAIMER);
  saveDoc(doc, "upominka");
}

// ---------------------------------------------------------------------------
// 4. SMLOUVA O DÍLO
// ---------------------------------------------------------------------------
export function generateSmlouvaPdf(data) {
  const { contractor, client, subject, price, isVatPayer, vatRate, paymentMethod, completionDate, signPlace, signDate, note } = data;

  const doc = new jsPDF({ unit: "mm", format: "a4" });
  registerFont(doc);
  const state = newPageState();
  let y = docHeader(doc, "Smlouva o dílo", null);

  doc.setFont("PlusJakartaSans", "normal");
  doc.setFontSize(9);
  doc.setTextColor(...MUTED);
  doc.text("uzavřená podle §2586 a násl. zákona č. 89/2012 Sb., občanského zákoníku", MARGIN, y);
  y += 10;

  y = drawParties(doc, y, { label: "Zhotovitel", lines: partyLines(contractor) }, { label: "Objednatel", lines: partyLines(client) });

  const priceNum = Number(price) || 0;
  const vat = isVatPayer ? priceNum * ((Number(vatRate) || 0) / 100) : 0;
  const priceLabel = isVatPayer
    ? `${fmtMoney(priceNum)} + DPH ${vatRate} % (${fmtMoney(priceNum + vat)} vč. DPH)`
    : `${fmtMoney(priceNum)} (zhotovitel není plátce DPH)`;

  const clauses = [
    { title: "I. Předmět díla", text: subject },
    {
      title: "II. Cena díla",
      text: `Cena za provedení díla činí ${priceLabel}. Cena je splatná ${paymentMethod || "na základě faktury vystavené po předání díla"}.`,
    },
    {
      title: "III. Termín provedení",
      text: `Zhotovitel se zavazuje dílo provést a předat objednateli nejpozději do ${fmtDate(completionDate)}.`,
    },
    {
      title: "IV. Předání díla",
      text: "Zhotovitel předá dílo objednateli po jeho dokončení; objednatel je povinen řádně provedené dílo převzít. O předání a převzetí díla sepíší strany předávací protokol.",
    },
    {
      title: "V. Závěrečná ustanovení",
      text:
        "Práva a povinnosti touto smlouvou neupravené se řídí zákonem č. 89/2012 Sb., občanským zákoníkem, v platném znění. " +
        "Smlouva se vyhotovuje ve dvou stejnopisech, každá strana obdrží jeden. Smlouva nabývá platnosti a účinnosti dnem podpisu oběma stranami." +
        (note ? `\n\n${note}` : ""),
    },
  ];

  for (const clause of clauses) {
    y = ensureSpace(doc, y, 16, state);
    y = drawSectionLabel(doc, clause.title, y);
    y = drawParagraphText(doc, clause.text, y, state);
    y += 3;
  }

  y = ensureSpace(doc, y, 34, state);
  doc.setFont("PlusJakartaSans", "normal");
  doc.setFontSize(9.5);
  doc.setTextColor(...SLATE);
  doc.text(`V ${signPlace || "—"} dne ${fmtDate(signDate)}`, MARGIN, y);
  y += 20;

  const sigWidth = (CONTENT_WIDTH - 10) / 2;
  doc.setDrawColor(...LINE);
  doc.line(MARGIN, y, MARGIN + sigWidth, y);
  doc.line(MARGIN + sigWidth + 10, y, MARGIN + CONTENT_WIDTH, y);
  doc.setFontSize(8.5);
  doc.setTextColor(...MUTED);
  doc.text("Zhotovitel", MARGIN, y + 5);
  doc.text("Objednatel", MARGIN + sigWidth + 10, y + 5);

  drawFooter(
    doc,
    `${DISCLAIMER} Vzorová smlouva podle §2586 a násl. zákona č. 89/2012 Sb. — u nestandardních ujednání doporučujeme právní kontrolu.`
  );
  saveDoc(doc, "smlouva-o-dilo");
}

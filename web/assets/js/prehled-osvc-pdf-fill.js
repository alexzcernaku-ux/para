// Vyplní hodnoty do skutečného tiskopisu ČSSZ "Přehled o příjmech a
// výdajích OSVČ za rok 2025" (89 324 24/25, verze I/2026). Stejný princip
// jako dap-pdf-fill.js/dph-pdf-fill.js: strany tiskopisu jako obrázky na
// pozadí, hodnoty na souřadnice zjištěné strojově z PDF staženého z
// eportal.cssz.cz (viz komentář v prehled-osvc.js).
//
// Souřadnice jsou v bodech (pt) přesně tak, jak je vrátilo PyMuPDF
// (page.get_drawings() pro rámečky/checkboxy políček) - převod na mm až
// při vykreslení, ať jde zdroj zpětně ověřit proti staženému PDF.

import { jsPDF } from "https://esm.sh/jspdf@2.5.1";
import { PLUS_JAKARTA_SANS_NORMAL_BASE64 } from "./fonts/plus-jakarta-sans-normal.js";
import { PLUS_JAKARTA_SANS_BOLD_BASE64 } from "./fonts/plus-jakarta-sans-bold.js";

const BG = {
  p1: "assets/img/prehled-osvc/hlavni-p1.png",
  p2: "assets/img/prehled-osvc/hlavni-p2.png",
};

const PT_TO_MM = 25.4 / 72;
const mm = (pt) => pt * PT_TO_MM;

const P1_BOX = {
  r20: { x0: 165.96, y0: 421.68, x1: 267.96, y1: 438.6 },
  r21_hlavni: { x0: 305.16, y0: 438.6, x1: 326.4, y1: 455.64 },
  r21_vedlejsi: { x0: 368.88, y0: 438.6, x1: 390.12, y1: 455.64 },
  r22_hlavni: { x0: 305.16, y0: 456.6, x1: 326.4, y1: 473.64 },
  r22_vedlejsi: { x0: 368.88, y0: 456.6, x1: 390.12, y1: 473.64 },
  r23: { x0: 165.96, y0: 475.68, x1: 267.96, y1: 492.6 },
  r25_hlavni: { x0: 165.96, y0: 522.0, x1: 267.96, y1: 539.04 },
  r25_vedlejsi: { x0: 305.28, y0: 522.0, x1: 407.28, y1: 539.04 },
  r27: { x0: 165.96, y0: 564.24, x1: 267.96, y1: 581.28 },
  r28: { x0: 165.96, y0: 583.2, x1: 267.96, y1: 600.24 },
  r30: { x0: 165.96, y0: 621.84, x1: 267.96, y1: 638.88 },
  r31: { x0: 165.96, y0: 640.8, x1: 267.96, y1: 657.84 },
  r32_1: { x0: 165.96, y0: 670.92, x1: 267.96, y1: 687.96 },
  r32_3: { x0: 165.96, y0: 710.16, x1: 267.96, y1: 727.2 },
  r33: { x0: 305.28, y0: 710.16, x1: 407.28, y1: 727.2 },
  r34: { x0: 165.96, y0: 729.12, x1: 267.96, y1: 746.16 },
};

const P1_CHECK = {
  jenHlavni: { x0: 245.28, y0: 214.68, x1: 254.4, y1: 229.68 },
  jenVedlejsi: { x0: 321.48, y0: 214.68, x1: 330.6, y1: 229.68 },
  novaFirma25: { x0: 550.68, y0: 325.2, x1: 559.68, y1: 340.2 },
};

// Řádek měsíčních checkboxů 1–12 + "1-12" (sloupce jsou shodné pro oba řádky).
const MONTH_XS = [245.28, 270.72, 296.16, 321.6, 347.04, 372.48, 397.92, 423.36, 448.8, 474.36, 499.8, 525.24];
const MONTH_1_12_X = 550.68;
const MONTH_ROW_HLAVNI = { y0: 232.68, y1: 247.68 };
const MONTH_ROW_VEDLEJSI = { y0: 250.68, y1: 265.68 };

const FIELDS_P1 = {
  prijmeni: { x: 35, y: 140 },
  jmeno: { x: 245, y: 140 },
  rodneCislo: { x: 449, y: 140 },
  ulice: { x: 133, y: 167 },
  cisloDomu: { x: 315, y: 167 },
  obec: { x: 399, y: 167 },
  psc: { x: 45, y: 194 },
};

const P2_BOX = {
  rodneCislo: { x0: 239.76, y0: 42.0, x1: 341.16, y1: 59.04 },
  r35: { x0: 136.56, y0: 137.04, x1: 199.2, y1: 154.08 },
  r36: { x0: 306.6, y0: 137.04, x1: 369.36, y1: 154.08 },
};
const P2_CHECK = {
  hlavni2026: { x0: 189.96, y0: 100.44, x1: 199.08, y1: 113.52 },
  vedlejsi2026: { x0: 250.08, y0: 100.44, x1: 259.08, y1: 113.52 },
  novaFirma2026: { x0: 538.44, y0: 119.16, x1: 547.56, y1: 132.36 },
};

function registerFont(doc) {
  doc.addFileToVFS("PlusJakartaSans-Regular.ttf", PLUS_JAKARTA_SANS_NORMAL_BASE64);
  doc.addFont("PlusJakartaSans-Regular.ttf", "PlusJakartaSans", "normal");
  doc.addFileToVFS("PlusJakartaSans-Bold.ttf", PLUS_JAKARTA_SANS_BOLD_BASE64);
  doc.addFont("PlusJakartaSans-Bold.ttf", "PlusJakartaSans", "bold");
  doc.setFont("PlusJakartaSans", "normal");
}

async function loadImageBase64(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Nepodařilo se načíst podklad formuláře (${url}).`);
  const blob = await res.blob();
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

function fmtCastka(n) {
  if (n === null || n === undefined) return "";
  const rounded = Math.round(n);
  return rounded < 0 ? `−${Math.abs(rounded).toLocaleString("cs-CZ")}` : rounded.toLocaleString("cs-CZ");
}

function boxRight(doc, box, text) {
  if (text === "" || text === null || text === undefined) return;
  doc.text(String(text), mm(box.x1 - 3), mm(box.y1 - 4.5), { align: "right" });
}

function boxCheck(doc, box) {
  const cx = mm((box.x0 + box.x1) / 2);
  const cy = mm((box.y0 + box.y1) / 2) + 1.3;
  doc.setFont("PlusJakartaSans", "bold");
  doc.setFontSize(10.5);
  doc.text("X", cx, cy, { align: "center" });
  doc.setFont("PlusJakartaSans", "normal");
}

function fieldLeft(doc, field, text) {
  if (!text) return;
  doc.text(String(text), mm(field.x), mm(field.y));
}

function monthChecks(doc, row, pocetMesicu) {
  if (pocetMesicu >= 12) {
    boxCheck(doc, { x0: MONTH_1_12_X, y0: row.y0, x1: MONTH_1_12_X + 9, y1: row.y1 });
    return;
  }
  for (let i = 0; i < pocetMesicu; i++) {
    boxCheck(doc, { x0: MONTH_XS[i], y0: row.y0, x1: MONTH_XS[i] + 9, y1: row.y1 });
  }
}

/**
 * @param {object} p
 * @param {object} p.identifikace {prijmeni, jmeno, rodneCislo, ulice, cisloDomu, obec, psc}
 * @param {"hlavni"|"vedlejsi"} p.typ
 * @param {number} p.pocetMesicu
 * @param {boolean} p.novaFirma
 * @param {object} p.socialni - výstup computePrehledSocialni()
 * @param {"hlavni"|"vedlejsi"} p.typ2026
 * @param {boolean} p.novaFirma2026
 * @param {object} p.zaloha2026 - výstup computeNovaZalohaSocialni() ({ r35, r36 })
 */
export async function generatePrehledOsvcPdf({
  identifikace = {},
  typ,
  pocetMesicu,
  novaFirma,
  socialni = {},
  typ2026,
  novaFirma2026,
  zaloha2026 = {},
}) {
  const [bg1, bg2] = await Promise.all([loadImageBase64(BG.p1), loadImageBase64(BG.p2)]);

  const doc = new jsPDF({ unit: "mm", format: "a4" });
  registerFont(doc);
  doc.setFontSize(9.5);
  doc.setTextColor(15, 23, 42);

  // --- Strana 1 ---
  doc.addImage(bg1, "PNG", 0, 0, 210, 297);

  fieldLeft(doc, FIELDS_P1.prijmeni, identifikace.prijmeni);
  fieldLeft(doc, FIELDS_P1.jmeno, identifikace.jmeno);
  fieldLeft(doc, FIELDS_P1.rodneCislo, identifikace.rodneCislo);
  fieldLeft(doc, FIELDS_P1.ulice, identifikace.ulice);
  fieldLeft(doc, FIELDS_P1.cisloDomu, identifikace.cisloDomu);
  fieldLeft(doc, FIELDS_P1.obec, identifikace.obec);
  fieldLeft(doc, FIELDS_P1.psc, identifikace.psc);

  boxCheck(doc, typ === "hlavni" ? P1_CHECK.jenHlavni : P1_CHECK.jenVedlejsi);
  monthChecks(doc, typ === "hlavni" ? MONTH_ROW_HLAVNI : MONTH_ROW_VEDLEJSI, pocetMesicu);
  if (typ === "hlavni" && novaFirma) boxCheck(doc, P1_CHECK.novaFirma25);

  const r21Box = typ === "hlavni" ? P1_BOX.r21_hlavni : P1_BOX.r21_vedlejsi;
  const r22Box = typ === "hlavni" ? P1_BOX.r22_hlavni : P1_BOX.r22_vedlejsi;
  boxRight(doc, r21Box, pocetMesicu);
  boxRight(doc, r22Box, pocetMesicu);
  boxRight(doc, P1_BOX.r20, fmtCastka(socialni.r20));

  if (socialni.ucast) {
    boxRight(doc, P1_BOX.r23, fmtCastka(socialni.r23));
    boxRight(doc, typ === "hlavni" ? P1_BOX.r25_hlavni : P1_BOX.r25_vedlejsi, fmtCastka(socialni.r25));
    boxRight(doc, P1_BOX.r27, fmtCastka(socialni.r27));
    boxRight(doc, P1_BOX.r28, fmtCastka(socialni.r28));
    boxRight(doc, P1_BOX.r30, fmtCastka(socialni.r30));
    boxRight(doc, P1_BOX.r31, fmtCastka(socialni.r31));
    boxRight(doc, P1_BOX.r32_1, fmtCastka(socialni.r32_1));
    boxRight(doc, P1_BOX.r32_3, fmtCastka(socialni.r32_3));
    boxRight(doc, P1_BOX.r33, fmtCastka(socialni.r33));
    boxRight(doc, P1_BOX.r34, fmtCastka(socialni.r34));
  } else {
    // Vedlejší SVČ bez účasti na DP - pokyny ČSSZ: "v ř. 25 až 32 uvede 0".
    for (const key of ["r25_vedlejsi", "r27", "r28", "r30", "r31", "r32_1", "r32_3"]) {
      boxRight(doc, P1_BOX[key], "0");
    }
    boxRight(doc, P1_BOX.r33, "0");
    boxRight(doc, P1_BOX.r34, "0");
  }

  // --- Strana 2 ---
  doc.addPage();
  doc.addImage(bg2, "PNG", 0, 0, 210, 297);
  fieldLeft(doc, { x: (P2_BOX.rodneCislo.x0 + 6), y: P2_BOX.rodneCislo.y1 - 4.5 }, identifikace.rodneCislo);

  boxCheck(doc, typ2026 === "hlavni" ? P2_CHECK.hlavni2026 : P2_CHECK.vedlejsi2026);
  if (typ2026 === "hlavni" && novaFirma2026) boxCheck(doc, P2_CHECK.novaFirma2026);
  boxRight(doc, P2_BOX.r35, fmtCastka(zaloha2026.r35));
  boxRight(doc, P2_BOX.r36, fmtCastka(zaloha2026.r36));

  const filenameDate = new Date().toISOString().slice(0, 10);
  doc.save(`prehled-osvc-cssz-${filenameDate}.pdf`);
}

// Zdravotní pojišťovny (VZP, ZPMV, ČPZP, OZP, RBP…) nemají jednotný
// centrální tiskopis jako ČSSZ - každá má vlastní formulář/portál, proto
// místo přesného přeložení skutečného tiskopisu generujeme čistý souhrn s
// dopočtenými částkami k přepsání do formuláře konkrétní pojišťovny (stejný
// princip jako u Kontrolního hlášení - viz kh-check.js).
const INDIGO = [99, 102, 241];
const NAVY = [15, 23, 42];
const SLATE = [51, 65, 85];
const MUTED = [148, 163, 184];

/**
 * @param {object} p
 * @param {object} p.identifikace {prijmeni, jmeno, rodneCislo, ulice, cisloDomu, obec, psc}
 * @param {object} p.zdravotni - výstup computePrehledZdravotni()
 * @param {object} p.zaloha2026 - výstup computeNovaZalohaZdravotni() ({ zaklad, zaloha })
 */
export function generateZdravotniSouhrnPdf({ identifikace = {}, zdravotni = {}, zaloha2026 = {} }) {
  const doc = new jsPDF({ unit: "mm", format: "a4" });
  registerFont(doc);
  const MARGIN = 20;
  const WIDTH = 210;
  let y = MARGIN;

  doc.setFont("PlusJakartaSans", "bold");
  doc.setFontSize(18);
  doc.setTextColor(...INDIGO);
  doc.text("§ Para", MARGIN, y);
  doc.setFont("PlusJakartaSans", "normal");
  doc.setFontSize(9);
  doc.setTextColor(...MUTED);
  const dateStr = new Date().toLocaleDateString("cs-CZ", { day: "numeric", month: "long", year: "numeric" });
  doc.text(dateStr, WIDTH - MARGIN, y, { align: "right" });
  y += 4;
  doc.setDrawColor(226, 232, 240);
  doc.line(MARGIN, y, WIDTH - MARGIN, y);
  y += 14;

  doc.setFont("PlusJakartaSans", "bold");
  doc.setFontSize(15);
  doc.setTextColor(...NAVY);
  doc.text("Souhrn pro přehled zdravotní pojišťovně za rok 2025", MARGIN, y);
  y += 7;
  doc.setFont("PlusJakartaSans", "normal");
  doc.setFontSize(9.5);
  doc.setTextColor(...SLATE);
  const jmeno = [identifikace.jmeno, identifikace.prijmeni].filter(Boolean).join(" ");
  if (jmeno) {
    doc.text(jmeno, MARGIN, y);
    y += 6;
  }
  y += 6;

  doc.setFont("PlusJakartaSans", "normal");
  doc.setFontSize(9.5);
  doc.setTextColor(...MUTED);
  doc.text(
    "Zdravotní pojišťovny nemají jednotný tiskopis - tyhle částky přepište do formuláře/portálu vaší pojišťovny (§ 24 odst. 2 zákona č. 592/1992 Sb.).",
    MARGIN,
    y,
    { maxWidth: WIDTH - MARGIN * 2 }
  );
  y += 14;

  const row = (label, value, big = false) => {
    doc.setFont("PlusJakartaSans", big ? "bold" : "normal");
    doc.setFontSize(big ? 12.5 : 10.5);
    doc.setTextColor(...(big ? NAVY : SLATE));
    doc.text(label, MARGIN, y);
    doc.text(value, WIDTH - MARGIN, y, { align: "right" });
    y += big ? 9 : 7.5;
  };

  doc.setFont("PlusJakartaSans", "bold");
  doc.setFontSize(10.5);
  doc.setTextColor(...INDIGO);
  doc.text("VYÚČTOVÁNÍ ZA ROK 2025", MARGIN, y);
  y += 8;
  row("Vyměřovací základ (vypočtený)", fmtCastka(zdravotni.vzVypocteny) + " Kč");
  row("Minimální vyměřovací základ", fmtCastka(zdravotni.vzMinimalni) + " Kč");
  row("Určený vyměřovací základ", fmtCastka(zdravotni.vzUrceny) + " Kč");
  row("Pojistné (13,5 %)", fmtCastka(zdravotni.pojistne) + " Kč");
  row("Zaplacené zálohy", fmtCastka(zdravotni.zalohy) + " Kč");
  y += 2;
  if (zdravotni.doplatek > 0) {
    row("Doplatek", fmtCastka(zdravotni.doplatek) + " Kč", true);
  } else {
    row("Přeplatek", fmtCastka(zdravotni.preplatek) + " Kč", true);
  }
  y += 8;

  doc.setFont("PlusJakartaSans", "bold");
  doc.setFontSize(10.5);
  doc.setTextColor(...INDIGO);
  doc.text("NOVÁ ZÁLOHA PRO ROK 2026", MARGIN, y);
  y += 8;
  row("Měsíční vyměřovací základ", fmtCastka(zaloha2026.zaklad) + " Kč");
  row("Měsíční záloha", fmtCastka(zaloha2026.zaloha) + " Kč", true);

  const totalPages = doc.internal.getNumberOfPages();
  for (let i = 1; i <= totalPages; i++) {
    doc.setPage(i);
    doc.setFont("PlusJakartaSans", "normal");
    doc.setFontSize(8);
    doc.setTextColor(...MUTED);
    doc.text(
      "Para není daňové ani účetní poradenství - u důležitých rozhodnutí konzultujte s odborníkem.",
      MARGIN,
      297 - 12
    );
  }

  const filenameDate = new Date().toISOString().slice(0, 10);
  doc.save(`prehled-osvc-zdravotni-${filenameDate}.pdf`);
}

// Fáze 11 — vyplní hodnoty do skutečného tiskopisu 25 5405 (vzor č. 30, 2026)
// a Přílohy č. 1 (vzor č. 22). Skutečné strany tiskopisu jsou vykreslené jako
// obrázky na pozadí (web/assets/img/dap/*.png, vygenerované z PDF staženého
// přímo z financnisprava.gov.cz — viz komentář v dap-check.js) a čísla se
// vypisují na přesné souřadnice zjištěné z PDF (bod = 1/72", převedeno na mm).
//
// Souřadnice jsou zjištěné strojově (hledání polohy textu "ř. XY" v původním
// PDF), ne odhadem od oka — viz scratchpad skript použitý při přípravě.
// Sloupec "poplatník" (ne "finanční úřad") je vpravo zarovnaný v rámci jeho
// šířky.

import { jsPDF } from "https://esm.sh/jspdf@2.5.1";
import { PLUS_JAKARTA_SANS_NORMAL_BASE64 } from "./fonts/plus-jakarta-sans-normal.js";
import { PLUS_JAKARTA_SANS_BOLD_BASE64 } from "./fonts/plus-jakarta-sans-bold.js";

const BG = {
  hlavniP1: "assets/img/dap/hlavni-p1.png",
  hlavniP2: "assets/img/dap/hlavni-p2.png",
  hlavniP3: "assets/img/dap/hlavni-p3.png",
  prilohaP1: "assets/img/dap/priloha1-p1.png",
};

// Pravý okraj sloupce "poplatník" (mm) pro každou stranu.
const RIGHT_X_HLAVNI = 137.62;
const RIGHT_X_PRILOHA = 157.2;

const ROWS_HLAVNI_P2 = {
  36: 62.24, 37: 68.86, 38: 78.14, 39: 84.08, 40: 91.79, 41: 100.49, 42: 105.84,
  44: 120.04, 45: 128.68, 54: 197.58, 55: 208.24, 56: 216.07, 57: 221.08,
};
const ROWS_PRILOHA_P1 = {
  101: 77.79, 102: 88.29, 104: 107.7, 105: 116.62, 106: 127.12, 107: 137.62,
  108: 148.12, 109: 158.62, 110: 169.12, 112: 190.12, 113: 202.1,
};
// hlavni-p3, § 35ba odst. 1 tabulka — úzký sloupec pro Kč hodnotu (~12 mm), menší písmo + zarovnání vpravo.
const ROW_64 = { xRight: 124.23, y: 20.39 };

const FIELDS_P1 = {
  prijmeni: { x: 26.46, y: 174.62 },
  jmeno: { x: 164.75, y: 174.62 },
  obec: { x: 26.46, y: 201.08 },
  ulice: { x: 81.14, y: 201.08 },
  psc: { x: 26.46, y: 210.96 },
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

function drawRightAligned(doc, text, xRight, y) {
  if (!text) return;
  doc.text(String(text), xRight, y, { align: "right" });
}
function drawLeftAligned(doc, text, x, y) {
  if (!text) return;
  doc.text(String(text), x, y);
}

/**
 * @param {object} p
 * @param {{prijmeni?:string, jmeno?:string, obec?:string, ulice?:string, psc?:string}} p.identifikace
 * @param {Record<string, number>} p.radky výsledek computeDapCascade() + surové vstupy (101,102,105,106,...,64)
 */
export async function generateDapPdf({ identifikace = {}, radky = {} }) {
  const [bgHlavniP1, bgHlavniP2, bgHlavniP3, bgPrilohaP1] = await Promise.all([
    loadImageBase64(BG.hlavniP1),
    loadImageBase64(BG.hlavniP2),
    loadImageBase64(BG.hlavniP3),
    loadImageBase64(BG.prilohaP1),
  ]);

  const doc = new jsPDF({ unit: "mm", format: "a4" });
  registerFont(doc);
  doc.setFontSize(10.5);
  doc.setTextColor(15, 23, 42);

  // --- Strana 1: identifikační údaje ---
  doc.addImage(bgHlavniP1, "PNG", 0, 0, 210, 297);
  drawLeftAligned(doc, identifikace.prijmeni, FIELDS_P1.prijmeni.x, FIELDS_P1.prijmeni.y);
  drawLeftAligned(doc, identifikace.jmeno, FIELDS_P1.jmeno.x, FIELDS_P1.jmeno.y);
  drawLeftAligned(doc, identifikace.obec, FIELDS_P1.obec.x, FIELDS_P1.obec.y);
  drawLeftAligned(doc, identifikace.ulice, FIELDS_P1.ulice.x, FIELDS_P1.ulice.y);
  drawLeftAligned(doc, identifikace.psc, FIELDS_P1.psc.x, FIELDS_P1.psc.y);

  // --- Strana 2: oddíl 2-3, dílčí základy daně ---
  doc.addPage();
  doc.addImage(bgHlavniP2, "PNG", 0, 0, 210, 297);
  for (const [radek, y] of Object.entries(ROWS_HLAVNI_P2)) {
    drawRightAligned(doc, fmtCastka(radky[radek]), RIGHT_X_HLAVNI, y);
  }

  // --- Strana 3: oddíl 5, základní sleva na poplatníka ---
  doc.addPage();
  doc.addImage(bgHlavniP3, "PNG", 0, 0, 210, 297);
  if (radky[64] !== undefined && radky[64] !== null) {
    doc.setFontSize(8);
    drawRightAligned(doc, fmtCastka(radky[64]), ROW_64.xRight, ROW_64.y);
    doc.setFontSize(10.5);
  }

  // --- Strana 4: Příloha č. 1 (§ 7) ---
  doc.addPage();
  doc.addImage(bgPrilohaP1, "PNG", 0, 0, 210, 297);
  for (const [radek, y] of Object.entries(ROWS_PRILOHA_P1)) {
    drawRightAligned(doc, fmtCastka(radky[radek]), RIGHT_X_PRILOHA, y);
  }

  const filenameDate = new Date().toISOString().slice(0, 10);
  doc.save(`danove-priznani-podklad-${filenameDate}.pdf`);
}

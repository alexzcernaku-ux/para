// Vyplní hodnoty do skutečného tiskopisu 25 5401 (vzor č. 26, 2026) - DPH
// přiznání. Stejný princip jako dap-pdf-fill.js pro DPFO: skutečné strany
// tiskopisu jako obrázky na pozadí, čísla na souřadnice zjištěné strojově
// z PDF staženého z financnisprava.gov.cz (viz komentář v dph-check.js).

import { jsPDF } from "https://esm.sh/jspdf@2.5.1";
import { PLUS_JAKARTA_SANS_NORMAL_BASE64 } from "./fonts/plus-jakarta-sans-normal.js";
import { PLUS_JAKARTA_SANS_BOLD_BASE64 } from "./fonts/plus-jakarta-sans-bold.js";

const BG = {
  p1: "assets/img/dph/hlavni-p1.png",
  p2: "assets/img/dph/hlavni-p2.png",
};

// Pravý okraj tabulky C. oddílu je ve skutečnosti na 551,5 pt (zjištěno z
// vnějšího ohraničení tabulky), ne ~566 pt jako u DPFO tiskopisu - proto
// samostatné konstanty místo sdílení s dap-pdf-fill.js.
const SEKCE_I = { zakladX: 144.64, danX: 192.97, 1: 25.32, 2: 30.32 };
const SEKCE_IV = { vplneX: 160.87, 40: 173.32, 41: 178.32, 46: 203.32 };
const SEKCE_VI = { valueX: 192.97, 62: 265.32, 63: 270.32, 64: 275.33, 65: 280.32 };

const FIELDS_P1 = {
  prijmeni: { x: 15.87, y: 147.0 },
  jmeno: { x: 125.94, y: 147.0 },
  obec: { x: 19.4, y: 161.04 },
  psc: { x: 114.65, y: 161.04 },
  ulice: { x: 19.4, y: 171.13 },
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
function right(doc, text, xRight, y) {
  if (text === "" || text === null || text === undefined) return;
  doc.text(String(text), xRight, y, { align: "right" });
}
function left(doc, text, x, y) {
  if (!text) return;
  doc.text(String(text), x, y);
}

/**
 * @param {object} p
 * @param {object} p.identifikace {prijmeni, jmeno, obec, ulice, psc}
 * @param {object} p.hodnoty {zaklad1, dan1, zaklad2, dan2, 40, 41, 46, 62, 63, 64, 65}
 */
export async function generateDphPdf({ identifikace = {}, hodnoty = {} }) {
  const [bg1, bg2] = await Promise.all([loadImageBase64(BG.p1), loadImageBase64(BG.p2)]);

  const doc = new jsPDF({ unit: "mm", format: "a4" });
  registerFont(doc);
  doc.setFontSize(10.5);
  doc.setTextColor(15, 23, 42);

  doc.addImage(bg1, "PNG", 0, 0, 210, 297);
  left(doc, identifikace.prijmeni, FIELDS_P1.prijmeni.x, FIELDS_P1.prijmeni.y);
  left(doc, identifikace.jmeno, FIELDS_P1.jmeno.x, FIELDS_P1.jmeno.y);
  left(doc, identifikace.obec, FIELDS_P1.obec.x, FIELDS_P1.obec.y);
  left(doc, identifikace.psc, FIELDS_P1.psc.x, FIELDS_P1.psc.y);
  left(doc, identifikace.ulice, FIELDS_P1.ulice.x, FIELDS_P1.ulice.y);

  doc.addPage();
  doc.addImage(bg2, "PNG", 0, 0, 210, 297);

  right(doc, fmtCastka(hodnoty.zaklad1), SEKCE_I.zakladX, SEKCE_I[1]);
  right(doc, fmtCastka(hodnoty.dan1), SEKCE_I.danX, SEKCE_I[1]);
  right(doc, fmtCastka(hodnoty.zaklad2), SEKCE_I.zakladX, SEKCE_I[2]);
  right(doc, fmtCastka(hodnoty.dan2), SEKCE_I.danX, SEKCE_I[2]);

  right(doc, fmtCastka(hodnoty[40]), SEKCE_IV.vplneX, SEKCE_IV[40]);
  right(doc, fmtCastka(hodnoty[41]), SEKCE_IV.vplneX, SEKCE_IV[41]);
  right(doc, fmtCastka(hodnoty[46]), SEKCE_IV.vplneX, SEKCE_IV[46]);

  for (const radek of [62, 63, 64, 65]) {
    right(doc, fmtCastka(hodnoty[radek]), SEKCE_VI.valueX, SEKCE_VI[radek]);
  }

  const filenameDate = new Date().toISOString().slice(0, 10);
  doc.save(`dph-priznani-podklad-${filenameDate}.pdf`);
}

// Export odpovědi z chatu jako PDF (otázka, odpověď, citované paragrafy,
// zdrojové odkazy). Používá jsPDF čistě na klientovi - žádný server, žádné
// generování na backendu.
//
// Proč vlastní font: výchozí PDF fonty (Helvetica/Times/Courier) používají
// kódování, které nemá české znaky s háčky/čárkami (č, ř, š, ě, ď, ť, ň, ů,
// ž) - bez vloženého fontu by byl text nečitelný/rozbitý. Plus Jakarta Sans
// (stejný font jako zbytek webu, viz styles.css) je vygenerovaný staticky
// z variabilního Google Fonts souboru a zabalený jako base64 v assets/js/fonts/.

import { jsPDF } from "https://esm.sh/jspdf@2.5.1";
import { PLUS_JAKARTA_SANS_NORMAL_BASE64 } from "./fonts/plus-jakarta-sans-normal.js";
import { PLUS_JAKARTA_SANS_BOLD_BASE64 } from "./fonts/plus-jakarta-sans-bold.js";

const MARGIN = 20;
const PAGE_WIDTH = 210; // A4 mm
const PAGE_HEIGHT = 297;
const CONTENT_WIDTH = PAGE_WIDTH - MARGIN * 2;
const INDIGO = [99, 102, 241];
const NAVY = [15, 23, 42];
const SLATE = [51, 65, 85];
const MUTED = [148, 163, 184];

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
  if (y + needed > PAGE_HEIGHT - MARGIN - 12) {
    doc.addPage();
    state.page += 1;
    return MARGIN;
  }
  return y;
}

// Rozseká "**tučně**" markdown na segmenty {text, bold} - stejná syntaxe,
// jakou model posílá a jakou chat.js/app.html renderují jako <strong>.
function parseBoldSegments(line) {
  return line.split(/(\*\*[^*]+\*\*)/g).filter(Boolean).map((part) => {
    if (part.startsWith("**") && part.endsWith("**")) {
      return { text: part.slice(2, -2), bold: true };
    }
    return { text: part, bold: false };
  });
}

function renderParagraph(doc, line, x, y, maxWidth, lineHeight, state) {
  const segments = parseBoldSegments(line);
  let cursorX = x;
  doc.setFontSize(10.5);
  doc.setTextColor(...SLATE);

  for (const seg of segments) {
    doc.setFont("PlusJakartaSans", seg.bold ? "bold" : "normal");
    const words = seg.text.split(/(\s+)/);
    for (const word of words) {
      if (word === "") continue;
      if (/^\s+$/.test(word)) {
        cursorX += doc.getTextWidth(word);
        continue;
      }
      const wordWidth = doc.getTextWidth(word);
      if (cursorX + wordWidth > x + maxWidth) {
        y += lineHeight;
        cursorX = x;
        y = ensureSpace(doc, y, lineHeight, state);
      }
      doc.text(word, cursorX, y);
      cursorX += wordWidth;
    }
  }
  return y + lineHeight;
}

function renderMultilineText(doc, text, x, y, maxWidth, lineHeight, state) {
  const paragraphs = text.split(/\n+/).filter((p) => p.trim() !== "");
  for (const para of paragraphs) {
    y = ensureSpace(doc, y, lineHeight, state);
    y = renderParagraph(doc, para, x, y, maxWidth, lineHeight, state);
    y += lineHeight * 0.3; // mezera mezi odstavci
  }
  return y;
}

function sectionLabel(doc, text, x, y) {
  doc.setFont("PlusJakartaSans", "bold");
  doc.setFontSize(9);
  doc.setTextColor(...INDIGO);
  doc.text(text.toUpperCase(), x, y);
  return y + 6;
}

/**
 * @param {object} p
 * @param {string} p.question
 * @param {string} p.answer
 * @param {Array<{law_name?: string, section_ref?: string, source_url?: string}>} [p.sources]
 */
export function generateAnswerPdf({ question, answer, sources = [] }) {
  const doc = new jsPDF({ unit: "mm", format: "a4" });
  registerFont(doc);
  const state = newPageState();
  let y = MARGIN;

  // --- Hlavička ---
  doc.setFont("PlusJakartaSans", "bold");
  doc.setFontSize(18);
  doc.setTextColor(...INDIGO);
  doc.text("§ Para", MARGIN, y);

  doc.setFont("PlusJakartaSans", "normal");
  doc.setFontSize(9);
  doc.setTextColor(...MUTED);
  const dateStr = new Date().toLocaleDateString("cs-CZ", { day: "numeric", month: "long", year: "numeric" });
  doc.text(dateStr, PAGE_WIDTH - MARGIN, y, { align: "right" });

  y += 4;
  doc.setDrawColor(226, 232, 240);
  doc.line(MARGIN, y, PAGE_WIDTH - MARGIN, y);
  y += 12;

  // --- Otázka ---
  y = sectionLabel(doc, "Otázka", MARGIN, y);
  doc.setFont("PlusJakartaSans", "bold");
  doc.setFontSize(12.5);
  doc.setTextColor(...NAVY);
  y = renderMultilineText(doc, question, MARGIN, y, CONTENT_WIDTH, 6, state);
  y += 6;

  // --- Odpověď ---
  y = ensureSpace(doc, y, 14, state);
  y = sectionLabel(doc, "Odpověď", MARGIN, y);
  y = renderMultilineText(doc, answer, MARGIN, y, CONTENT_WIDTH, 5.6, state);
  y += 6;

  // --- Zdroje ---
  if (sources.length) {
    y = ensureSpace(doc, y, 14, state);
    y = sectionLabel(doc, "Citované zdroje", MARGIN, y);
    doc.setFontSize(10);
    for (const s of sources) {
      y = ensureSpace(doc, y, 6, state);
      const label = `${s.law_name || ""} ${s.section_ref || ""}`.trim() || "Zdroj";
      doc.setFont("PlusJakartaSans", "normal");
      doc.setTextColor(...SLATE);
      doc.text("•", MARGIN, y);
      if (s.source_url) {
        doc.setTextColor(...INDIGO);
        doc.textWithLink(label, MARGIN + 4, y, { url: s.source_url });
      } else {
        doc.setTextColor(...SLATE);
        doc.text(label, MARGIN + 4, y);
      }
      y += 6;
    }
  }

  // --- Patička na každé stránce ---
  const totalPages = doc.internal.getNumberOfPages();
  for (let i = 1; i <= totalPages; i++) {
    doc.setPage(i);
    doc.setFont("PlusJakartaSans", "normal");
    doc.setFontSize(8);
    doc.setTextColor(...MUTED);
    doc.text(
      "Para není daňové ani účetní poradenství - u důležitých rozhodnutí konzultujte s odborníkem.",
      MARGIN,
      PAGE_HEIGHT - 12
    );
    doc.text(`${i} / ${totalPages}`, PAGE_WIDTH - MARGIN, PAGE_HEIGHT - 12, { align: "right" });
  }

  const filenameDate = new Date().toISOString().slice(0, 10);
  doc.save(`para-odpoved-${filenameDate}.pdf`);
}

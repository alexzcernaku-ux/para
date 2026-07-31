// Fáze 11 — krokový průvodce vyplněním přiznání k dani z příjmů fyzických
// osob (§ 7 — samostatná činnost). Ptá se postupně, přeskakuje kroky, které
// se uživatele netýkají (podle předchozích odpovědí), a na konci vygeneruje
// vyplněný tiskopis 25 5405 + Přílohu č. 1 jako PDF (dap-pdf-fill.js).
//
// Výpočet kaskády řádků (104,113,41,42,45,55,56,57) dělá computeDapCascade()
// z dap-check.js — STEJNÁ funkce, jakou by šlo použít i pro zpětnou kontrolu,
// aby vzorce nebyly na dvou místech.

import { requireOnboardedProfile, signOut } from "./supabase-client.js";
import { computeDapCascade } from "./dap-check.js";
import { PAUSALNI_VYDAJE, SLEVA_NA_POPLATNIKA } from "./tax-constants.js";

const loadingEl = document.getElementById("page-loading");
const shellEl = document.getElementById("page-shell");
const signoutBtn = document.getElementById("signout-btn");
const blockedNotice = document.getElementById("blocked-notice");
const wizardWrap = document.getElementById("wizard-wrap");
const progressEl = document.getElementById("wiz-progress");
const bubbleEl = document.getElementById("wiz-bubble");
const bodyEl = document.getElementById("wiz-body");
const backBtn = document.getElementById("wiz-back");
const nextBtn = document.getElementById("wiz-next");

signoutBtn.addEventListener("click", () => signOut());

function fmtKc(n) {
  if (n === null || n === undefined) return "0 Kč";
  return `${Math.round(n).toLocaleString("cs-CZ")} Kč`;
}
function num(v) {
  const n = Number(String(v ?? "").replace(/\s/g, "").replace(",", "."));
  return Number.isFinite(n) ? n : null;
}

let profile = null;
let answers = {
  prijmeni: "",
  jmeno: "",
  obec: "",
  ulice: "",
  psc: "",
  r101: null,
  vydajeMode: null, // "pausal" | "skutecne"
  pausalTyp: null,
  r102: null,
  maSpolupraci: null,
  r107: 0,
  r108: 0,
  r109: 0,
  r110: 0,
  r112: 0,
  maJinePrijmy: null,
  maZtratu: null,
  r44: 0,
  maOdpocty: null,
  r54: 0,
  slevaCelyRok: null,
  r64: SLEVA_NA_POPLATNIKA,
};

function vypocitejPausal() {
  if (!answers.pausalTyp || answers.r101 === null) return 0;
  const p = PAUSALNI_VYDAJE[answers.pausalTyp];
  return Math.min(Math.round(answers.r101 * p.procento), p.maxVydaje);
}

// --- Definice kroků -------------------------------------------------------
const STEPS = [
  {
    id: "identifikace",
    bubble: () => "Nejdřív pár základních údajů pro záhlaví přiznání.",
    render(el) {
      el.innerHTML = `
        <div class="wiz-row2">
          <div class="wiz-field"><label>Příjmení</label><input class="text-input" id="w-prijmeni" value="${answers.prijmeni}" /></div>
          <div class="wiz-field"><label>Jméno</label><input class="text-input" id="w-jmeno" value="${answers.jmeno}" /></div>
        </div>
        <div class="wiz-field"><label>Obec (trvalé bydliště)</label><input class="text-input" id="w-obec" value="${answers.obec}" /></div>
        <div class="wiz-row2">
          <div class="wiz-field"><label>Ulice a číslo</label><input class="text-input" id="w-ulice" value="${answers.ulice}" /></div>
          <div class="wiz-field"><label>PSČ</label><input class="text-input" id="w-psc" value="${answers.psc}" /></div>
        </div>`;
      el.querySelector("#w-prijmeni").addEventListener("input", (e) => (answers.prijmeni = e.target.value));
      el.querySelector("#w-jmeno").addEventListener("input", (e) => (answers.jmeno = e.target.value));
      el.querySelector("#w-obec").addEventListener("input", (e) => (answers.obec = e.target.value));
      el.querySelector("#w-ulice").addEventListener("input", (e) => (answers.ulice = e.target.value));
      el.querySelector("#w-psc").addEventListener("input", (e) => (answers.psc = e.target.value));
    },
    canNext: () => answers.prijmeni.trim() && answers.jmeno.trim(),
  },
  {
    id: "prijmy7",
    bubble: () => "Kolik jste měl(a) za rok 2026 příjmů ze samostatné činnosti (§ 7) — hrubě, před odečtením výdajů?",
    render(el) {
      el.innerHTML = `
        <div class="wiz-field">
          <label>Příjmy ze samostatné činnosti (Kč)</label>
          <input type="number" class="text-input" id="w-r101" min="0" step="1000" value="${answers.r101 ?? ""}" />
        </div>`;
      el.querySelector("#w-r101").addEventListener("input", (e) => (answers.r101 = num(e.target.value)));
    },
    canNext: () => answers.r101 !== null && answers.r101 >= 0,
  },
  {
    id: "vydaje-mode",
    bubble: () => "Uplatňujete výdaje paušálem (procentem z příjmů), nebo ve skutečné výši (podle dokladů)?",
    render(el) {
      el.innerHTML = `
        <div class="wiz-yesno">
          <label class="calc-radio-chip"><input type="radio" name="w-vydmode" value="pausal" /> Paušálem</label>
          <label class="calc-radio-chip"><input type="radio" name="w-vydmode" value="skutecne" /> Skutečné výdaje</label>
        </div>`;
      const group = el.querySelector(".wiz-yesno");
      group.querySelectorAll("input").forEach((input) => {
        input.checked = input.value === answers.vydajeMode;
        input.addEventListener("change", () => {
          answers.vydajeMode = input.value;
          group.querySelectorAll(".calc-radio-chip").forEach((c) => c.classList.toggle("selected", c.querySelector("input").checked));
        });
      });
      group.querySelectorAll(".calc-radio-chip").forEach((c) => c.classList.toggle("selected", c.querySelector("input").checked));
    },
    canNext: () => !!answers.vydajeMode,
  },
  {
    id: "vydaje-pausal-typ",
    visible: () => answers.vydajeMode === "pausal",
    bubble: () => "Jaký typ činnosti provozujete? Podle toho se liší procento paušálu.",
    render(el) {
      const opts = Object.entries(PAUSALNI_VYDAJE);
      el.innerHTML =
        `<div class="wiz-field">` +
        opts.map(([key, p]) => `<label class="calc-radio-chip" style="display:flex; margin-bottom:8px;"><input type="radio" name="w-pausaltyp" value="${key}" /> ${p.label}</label>`).join("") +
        `</div><div class="wiz-computed" id="w-pausal-computed">Vypočtené výdaje: <strong>—</strong></div>`;
      const computedEl = el.querySelector("#w-pausal-computed strong");
      el.querySelectorAll('input[name="w-pausaltyp"]').forEach((input) => {
        input.checked = input.value === answers.pausalTyp;
        input.addEventListener("change", () => {
          answers.pausalTyp = input.value;
          answers.r102 = vypocitejPausal();
          computedEl.textContent = fmtKc(answers.r102);
          el.querySelectorAll(".calc-radio-chip").forEach((c) => c.classList.toggle("selected", c.querySelector("input").checked));
        });
      });
      el.querySelectorAll(".calc-radio-chip").forEach((c) => c.classList.toggle("selected", c.querySelector("input").checked));
      if (answers.pausalTyp) computedEl.textContent = fmtKc(vypocitejPausal());
    },
    canNext: () => !!answers.pausalTyp,
  },
  {
    id: "vydaje-skutecne",
    visible: () => answers.vydajeMode === "skutecne",
    bubble: () => "Jaké byly vaše skutečné výdaje související s příjmy ze samostatné činnosti?",
    render(el) {
      el.innerHTML = `<div class="wiz-field"><label>Výdaje (Kč)</label><input type="number" class="text-input" id="w-r102" min="0" step="1000" value="${answers.r102 ?? ""}" /></div>`;
      el.querySelector("#w-r102").addEventListener("input", (e) => (answers.r102 = num(e.target.value)));
    },
    canNext: () => answers.r102 !== null && answers.r102 >= 0,
  },
  {
    id: "spoluprace-yesno",
    bubble: () => "Rozdělujete příjmy/výdaje na spolupracující osobu (např. manžela/manželku, rodinného příslušníka) podle § 13, nebo jste společník veřejné obchodní společnosti / komplementář komanditní společnosti?",
    render(el) {
      el.innerHTML = `
        <div class="wiz-yesno">
          <label class="calc-radio-chip"><input type="radio" name="w-spol" value="ne" /> Ne</label>
          <label class="calc-radio-chip"><input type="radio" name="w-spol" value="ano" /> Ano</label>
        </div>`;
      wireYesNo(el, "w-spol", answers.maSpolupraci, (v) => (answers.maSpolupraci = v));
    },
    canNext: () => answers.maSpolupraci !== null,
  },
  {
    id: "spoluprace-detail",
    visible: () => answers.maSpolupraci === true,
    bubble: () => "Doplňte prosím konkrétní částky (řádky Přílohy č. 1) — pokud se vás některá položka netýká, nechte nulu.",
    render(el) {
      el.innerHTML = `
        <div class="wiz-row2">
          <div class="wiz-field"><label>ř. 107 — příjmy rozdělované na spolupracující osobu</label><input type="number" class="text-input" id="w-r107" value="${answers.r107}" /></div>
          <div class="wiz-field"><label>ř. 108 — výdaje rozdělované na spolupracující osobu</label><input type="number" class="text-input" id="w-r108" value="${answers.r108}" /></div>
        </div>
        <div class="wiz-row2">
          <div class="wiz-field"><label>ř. 109 — příjmy připadající na Vás jako spolupracující osobu</label><input type="number" class="text-input" id="w-r109" value="${answers.r109}" /></div>
          <div class="wiz-field"><label>ř. 110 — výdaje připadající na Vás jako spolupracující osobu</label><input type="number" class="text-input" id="w-r110" value="${answers.r110}" /></div>
        </div>
        <div class="wiz-field"><label>ř. 112 — podíl společníka v. o. s. / komplementáře k. s.</label><input type="number" class="text-input" id="w-r112" value="${answers.r112}" /></div>`;
      ["r107", "r108", "r109", "r110", "r112"].forEach((k) => {
        el.querySelector(`#w-${k}`).addEventListener("input", (e) => (answers[k] = num(e.target.value) ?? 0));
      });
    },
    canNext: () => true,
  },
  {
    id: "jine-prijmy",
    bubble: () => "Měl(a) jste v roce 2026 kromě samostatné činnosti i jiné zdanitelné příjmy — ze zaměstnání, kapitálového majetku, nájmu nebo jiné (§ 6, § 8, § 9, § 10)?",
    render(el) {
      el.innerHTML = `
        <div class="wiz-yesno">
          <label class="calc-radio-chip"><input type="radio" name="w-jine" value="ne" /> Ne</label>
          <label class="calc-radio-chip"><input type="radio" name="w-jine" value="ano" /> Ano</label>
        </div>
        <p class="form-hint hidden" id="w-jine-hint">Tenhle generátor zatím vyplní jen řádky pro § 7. Řádky 36, 38, 39 a 40 (a související přílohy) si po stažení PDF doplňte ručně.</p>`;
      wireYesNo(el, "w-jine", answers.maJinePrijmy, (v) => {
        answers.maJinePrijmy = v;
        el.querySelector("#w-jine-hint").classList.toggle("hidden", !v);
      });
      el.querySelector("#w-jine-hint").classList.toggle("hidden", !answers.maJinePrijmy);
    },
    canNext: () => answers.maJinePrijmy !== null,
  },
  {
    id: "ztrata-yesno",
    bubble: () => "Uplatňujete v tomto přiznání ztrátu z některého z minulých let?",
    render(el) {
      el.innerHTML = `<div class="wiz-yesno">
        <label class="calc-radio-chip"><input type="radio" name="w-ztrata" value="ne" /> Ne</label>
        <label class="calc-radio-chip"><input type="radio" name="w-ztrata" value="ano" /> Ano</label>
      </div>`;
      wireYesNo(el, "w-ztrata", answers.maZtratu, (v) => (answers.maZtratu = v));
    },
    canNext: () => answers.maZtratu !== null,
  },
  {
    id: "ztrata-detail",
    visible: () => answers.maZtratu === true,
    bubble: () => "Jakou částku ztráty uplatňujete (ř. 44)?",
    render(el) {
      el.innerHTML = `<div class="wiz-field"><label>Uplatňovaná ztráta (Kč)</label><input type="number" class="text-input" id="w-r44" min="0" value="${answers.r44}" /></div>`;
      el.querySelector("#w-r44").addEventListener("input", (e) => (answers.r44 = num(e.target.value) ?? 0));
    },
    canNext: () => true,
  },
  {
    id: "odpocty-yesno",
    bubble: () => "Uplatňujete nezdanitelné části základu daně — dary, úroky z úvěru na bydlení, penzijní/životní pojištění a podobně (§ 15)?",
    render(el) {
      el.innerHTML = `<div class="wiz-yesno">
        <label class="calc-radio-chip"><input type="radio" name="w-odpocty" value="ne" /> Ne</label>
        <label class="calc-radio-chip"><input type="radio" name="w-odpocty" value="ano" /> Ano</label>
      </div>`;
      wireYesNo(el, "w-odpocty", answers.maOdpocty, (v) => (answers.maOdpocty = v));
    },
    canNext: () => answers.maOdpocty !== null,
  },
  {
    id: "odpocty-detail",
    visible: () => answers.maOdpocty === true,
    bubble: () => "Jaká je jejich celková částka (součet řádků 46 až 53, ř. 54)?",
    render(el) {
      el.innerHTML = `<div class="wiz-field"><label>Nezdanitelné části a odčitatelné položky celkem (Kč)</label><input type="number" class="text-input" id="w-r54" min="0" value="${answers.r54}" /></div>`;
      el.querySelector("#w-r54").addEventListener("input", (e) => (answers.r54 = num(e.target.value) ?? 0));
    },
    canNext: () => true,
  },
  {
    id: "sleva-yesno",
    bubble: () => `Uplatňujete základní slevu na poplatníka v plné roční výši (${fmtKc(SLEVA_NA_POPLATNIKA)})?`,
    render(el) {
      el.innerHTML = `<div class="wiz-yesno">
        <label class="calc-radio-chip"><input type="radio" name="w-sleva" value="ano" /> Ano, celý rok</label>
        <label class="calc-radio-chip"><input type="radio" name="w-sleva" value="ne" /> Ne / jiná částka</label>
      </div>`;
      wireYesNo(el, "w-sleva", answers.slevaCelyRok, (v) => {
        answers.slevaCelyRok = v;
        answers.r64 = v ? SLEVA_NA_POPLATNIKA : answers.r64;
      });
    },
    canNext: () => answers.slevaCelyRok !== null,
  },
  {
    id: "sleva-detail",
    visible: () => answers.slevaCelyRok === false,
    bubble: () => "Jakou částku slevy na poplatníka tedy uplatňujete (ř. 64)?",
    render(el) {
      el.innerHTML = `<div class="wiz-field"><label>Sleva na poplatníka (Kč)</label><input type="number" class="text-input" id="w-r64" min="0" value="${answers.r64}" /></div>`;
      el.querySelector("#w-r64").addEventListener("input", (e) => (answers.r64 = num(e.target.value) ?? 0));
    },
    canNext: () => true,
  },
  {
    id: "souhrn",
    bubble: () => "Tohle vychází z toho, co jste zadal(a) — zkontrolujte a stáhněte PDF.",
    render(el) {
      const cascade = computeDapCascade({
        101: answers.r101,
        102: answers.r102,
        107: answers.r107,
        108: answers.r108,
        109: answers.r109,
        110: answers.r110,
        112: answers.r112,
        44: answers.r44,
        54: answers.r54,
      });
      const row = (label, value, opts = {}) =>
        `<div class="wiz-summary-row ${opts.total ? "total" : ""}"><span class="rlabel">${label}</span><span class="rvalue">${fmtKc(value)}</span></div>`;
      el.innerHTML = `
        ${row("ř. 101 Příjmy (§ 7)", answers.r101)}
        ${row("ř. 102 Výdaje (§ 7)", answers.r102)}
        ${row("ř. 104 Rozdíl", cascade[104])}
        ${row("ř. 113 Dílčí základ daně (§ 7)", cascade[113])}
        ${row("ř. 42 Základ daně", cascade[42])}
        ${row("ř. 54 Odčitatelné položky", answers.r54)}
        ${row("ř. 56 Základ daně (zaokrouhlený)", cascade[56])}
        ${row("ř. 64 Sleva na poplatníka", answers.r64)}
        ${row("ř. 57 Daň podle § 16 zákona", cascade[57], { total: true })}
        <p class="form-hint" style="margin-top: 14px;">Sazba 15 %/23 % počítá s hranicí pro vyšší pásmo, která je zatím odhad (přesná hranice pro rok 2026 se zveřejňuje průběžně) — před podáním si daň ověřte.</p>
      `;
    },
    canNext: () => true,
    nextLabel: "Stáhnout PDF ↓",
    onFinish: async (btn) => {
      const originalText = btn.textContent;
      btn.disabled = true;
      btn.textContent = "Generuji PDF…";
      try {
        const cascade = computeDapCascade({
          101: answers.r101,
          102: answers.r102,
          107: answers.r107,
          108: answers.r108,
          109: answers.r109,
          110: answers.r110,
          112: answers.r112,
          44: answers.r44,
          54: answers.r54,
        });
        const { generateDapPdf } = await import("./dap-pdf-fill.js");
        await generateDapPdf({
          identifikace: { prijmeni: answers.prijmeni, jmeno: answers.jmeno, obec: answers.obec, ulice: answers.ulice, psc: answers.psc },
          radky: {
            101: answers.r101,
            102: answers.r102,
            104: cascade[104],
            105: 0,
            106: 0,
            107: answers.r107,
            108: answers.r108,
            109: answers.r109,
            110: answers.r110,
            112: answers.r112,
            113: cascade[113],
            36: 0,
            37: cascade[37],
            38: 0,
            39: 0,
            40: 0,
            41: cascade[41],
            42: cascade[42],
            44: answers.r44,
            45: cascade[45],
            54: answers.r54,
            55: cascade[55],
            56: cascade[56],
            57: cascade[57],
            64: answers.r64,
          },
        });
      } catch (err) {
        alert(`Nepodařilo se vygenerovat PDF (${err.message}). Zkuste to prosím znovu.`);
      } finally {
        btn.disabled = false;
        btn.textContent = originalText;
      }
    },
  },
];

function wireYesNo(el, name, current, onChange) {
  const inputs = el.querySelectorAll(`input[name="${name}"]`);
  inputs.forEach((input) => {
    input.checked = (input.value === "ano") === current;
    input.addEventListener("change", () => {
      onChange(input.value === "ano");
      el.querySelectorAll(".calc-radio-chip").forEach((c) => c.classList.toggle("selected", c.querySelector("input").checked));
    });
  });
  el.querySelectorAll(".calc-radio-chip").forEach((c) => c.classList.toggle("selected", c.querySelector("input").checked));
}

function visibleSteps() {
  return STEPS.filter((s) => !s.visible || s.visible());
}

let currentId = STEPS[0].id;

function renderProgress() {
  const vs = visibleSteps();
  const idx = vs.findIndex((s) => s.id === currentId);
  progressEl.innerHTML = vs
    .map((s, i) => `<div class="wiz-progress-step ${i < idx ? "done" : i === idx ? "current" : ""}"></div>`)
    .join("");
}

function renderStep() {
  const vs = visibleSteps();
  let step = vs.find((s) => s.id === currentId);
  if (!step) {
    // krok mezitím zmizel (změna odpovědi) — spadni na první viditelný
    step = vs[0];
    currentId = step.id;
  }
  renderProgress();
  bubbleEl.textContent = step.bubble();
  bodyEl.innerHTML = "";
  step.render(bodyEl);
  backBtn.classList.toggle("hidden", vs[0].id === step.id);
  nextBtn.textContent = step.nextLabel || "Pokračovat →";
  nextBtn.disabled = !step.canNext();

  // Znovu-validace při každé změně vstupu v kroku.
  bodyEl.addEventListener("input", () => (nextBtn.disabled = !step.canNext()));
  bodyEl.addEventListener("change", () => (nextBtn.disabled = !step.canNext()));

  nextBtn.onclick = async () => {
    if (step.onFinish) {
      await step.onFinish(nextBtn);
      return;
    }
    const vsNow = visibleSteps();
    const i = vsNow.findIndex((s) => s.id === step.id);
    if (i < vsNow.length - 1) {
      currentId = vsNow[i + 1].id;
      renderStep();
    }
  };
  backBtn.onclick = () => {
    const vsNow = visibleSteps();
    const i = vsNow.findIndex((s) => s.id === step.id);
    if (i > 0) {
      currentId = vsNow[i - 1].id;
      renderStep();
    }
  };
}

(async () => {
  const result = await requireOnboardedProfile();
  if (!result) return;
  profile = result.profile;

  if (profile.legal_form === "sro") {
    blockedNotice.classList.remove("hidden");
    wizardWrap.classList.add("hidden");
  } else {
    if (profile.company_name) {
      const parts = profile.company_name.trim().split(/\s+/);
      if (parts.length >= 2) {
        answers.jmeno = parts[0];
        answers.prijmeni = parts.slice(1).join(" ");
      }
    }
    if (profile.legal_form === "osvc_pausal") answers.vydajeMode = "pausal";
    if (profile.legal_form === "osvc_skutecne") answers.vydajeMode = "skutecne";
    renderStep();
  }

  loadingEl.classList.add("hidden");
  shellEl.classList.remove("hidden");
})();

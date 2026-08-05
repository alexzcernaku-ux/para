// Krokový průvodce vyplněním přiznání k DPH (tuzemská plnění, bez kráceného
// odpočtu - viz komentář v dph-check.js). Stejný vzor jako dap-generator-page.js.

import { requireOnboardedProfile, signOut } from "./supabase-client.js";
import { computeDphCascade } from "./dph-check.js";

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

let answers = {
  prijmeni: "",
  jmeno: "",
  obec: "",
  ulice: "",
  psc: "",
  zaklad1: null,
  maSnizenou: null,
  zaklad2: 0,
  odp40: 0,
  maOdp41: null,
  odp41: 0,
};

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

const STEPS = [
  {
    id: "identifikace",
    bubble: () => "Nejdřív pár základních údajů pro záhlaví přiznání.",
    render(el) {
      el.innerHTML = `
        <div class="wiz-row2">
          <div class="wiz-field"><label>Příjmení / Název firmy</label><input class="text-input" id="w-prijmeni" value="${answers.prijmeni}" /></div>
          <div class="wiz-field"><label>Jméno</label><input class="text-input" id="w-jmeno" value="${answers.jmeno}" /></div>
        </div>
        <div class="wiz-field"><label>Obec (sídlo)</label><input class="text-input" id="w-obec" value="${answers.obec}" /></div>
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
    canNext: () => answers.prijmeni.trim(),
  },
  {
    id: "zaklad1",
    bubble: () => "Jaký byl základ daně za dodání zboží/služeb v tuzemsku v základní sazbě 21 % za tohle zdaňovací období?",
    render(el) {
      el.innerHTML = `<div class="wiz-field"><label>Základ daně, 21 % (Kč)</label><input type="number" class="text-input" id="w-z1" min="0" step="100" value="${answers.zaklad1 ?? ""}" /></div>`;
      el.querySelector("#w-z1").addEventListener("input", (e) => (answers.zaklad1 = num(e.target.value)));
    },
    canNext: () => answers.zaklad1 !== null && answers.zaklad1 >= 0,
  },
  {
    id: "snizena-yesno",
    bubble: () => "Měl(a) jste i plnění ve snížené sazbě 12 %?",
    render(el) {
      el.innerHTML = `<div class="wiz-yesno">
        <label class="calc-radio-chip"><input type="radio" name="w-snizena" value="ne" /> Ne</label>
        <label class="calc-radio-chip"><input type="radio" name="w-snizena" value="ano" /> Ano</label>
      </div>`;
      wireYesNo(el, "w-snizena", answers.maSnizenou, (v) => (answers.maSnizenou = v));
    },
    canNext: () => answers.maSnizenou !== null,
  },
  {
    id: "zaklad2",
    visible: () => answers.maSnizenou === true,
    bubble: () => "Jaký byl základ daně ve snížené sazbě 12 %?",
    render(el) {
      el.innerHTML = `<div class="wiz-field"><label>Základ daně, 12 % (Kč)</label><input type="number" class="text-input" id="w-z2" min="0" step="100" value="${answers.zaklad2}" /></div>`;
      el.querySelector("#w-z2").addEventListener("input", (e) => (answers.zaklad2 = num(e.target.value) ?? 0));
    },
    canNext: () => true,
  },
  {
    id: "odpocet40",
    bubble: () => "Kolik jste zaplatil(a) na DPH na vstupu (z přijatých faktur od plátců v základní sazbě), které si uplatňujete jako odpočet?",
    render(el) {
      el.innerHTML = `<div class="wiz-field"><label>DPH na vstupu, 21 % - plný nárok na odpočet (Kč)</label><input type="number" class="text-input" id="w-odp40" min="0" step="100" value="${answers.odp40}" /></div>`;
      el.querySelector("#w-odp40").addEventListener("input", (e) => (answers.odp40 = num(e.target.value) ?? 0));
    },
    canNext: () => true,
  },
  {
    id: "odpocet41-yesno",
    bubble: () => "A DPH na vstupu ve snížené sazbě 12 %?",
    render(el) {
      el.innerHTML = `<div class="wiz-yesno">
        <label class="calc-radio-chip"><input type="radio" name="w-odp41yn" value="ne" /> Žádné</label>
        <label class="calc-radio-chip"><input type="radio" name="w-odp41yn" value="ano" /> Ano, mám</label>
      </div>`;
      wireYesNo(el, "w-odp41yn", answers.maOdp41, (v) => (answers.maOdp41 = v));
    },
    canNext: () => answers.maOdp41 !== null,
  },
  {
    id: "odpocet41",
    visible: () => answers.maOdp41 === true,
    bubble: () => "Kolik konkrétně?",
    render(el) {
      el.innerHTML = `<div class="wiz-field"><label>DPH na vstupu, 12 % (Kč)</label><input type="number" class="text-input" id="w-odp41" min="0" step="100" value="${answers.odp41}" /></div>`;
      el.querySelector("#w-odp41").addEventListener("input", (e) => (answers.odp41 = num(e.target.value) ?? 0));
    },
    canNext: () => true,
  },
  {
    id: "souhrn",
    bubble: () => "Tohle vychází z toho, co jste zadal(a) - zkontrolujte a stáhněte PDF.",
    render(el) {
      const cascade = computeDphCascade({ zaklad1: answers.zaklad1, zaklad2: answers.zaklad2, odp40: answers.odp40, odp41: answers.odp41 });
      const row = (label, value, opts = {}) =>
        `<div class="wiz-summary-row ${opts.total ? "total" : ""}"><span class="rlabel">${label}</span><span class="rvalue">${fmtKc(value)}</span></div>`;
      el.innerHTML = `
        ${row("ř. 1 Daň na výstupu, 21 %", cascade.dan1)}
        ${row("ř. 2 Daň na výstupu, 12 %", cascade.dan2)}
        ${row("ř. 46 Odpočet daně celkem", cascade[46])}
        ${row("ř. 62 Daň na výstupu", cascade[62])}
        ${row("ř. 63 Odpočet daně", cascade[63])}
        ${cascade[64] > 0 ? row("ř. 64 Vlastní daň (k úhradě)", cascade[64], { total: true }) : row("ř. 65 Nadměrný odpočet (vrátí se)", cascade[65], { total: true })}
      `;
    },
    canNext: () => true,
    nextLabel: "Stáhnout PDF ↓",
    onFinish: async (btn) => {
      const originalText = btn.textContent;
      btn.disabled = true;
      btn.textContent = "Generuji PDF…";
      try {
        const cascade = computeDphCascade({ zaklad1: answers.zaklad1, zaklad2: answers.zaklad2, odp40: answers.odp40, odp41: answers.odp41 });
        const { generateDphPdf } = await import("./dph-pdf-fill.js");
        await generateDphPdf({
          identifikace: { prijmeni: answers.prijmeni, jmeno: answers.jmeno, obec: answers.obec, ulice: answers.ulice, psc: answers.psc },
          hodnoty: {
            zaklad1: answers.zaklad1,
            dan1: cascade.dan1,
            zaklad2: answers.zaklad2,
            dan2: cascade.dan2,
            40: answers.odp40,
            41: answers.odp41,
            46: cascade[46],
            62: cascade[62],
            63: cascade[63],
            64: cascade[64] || null,
            65: cascade[65] || null,
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

function visibleSteps() {
  return STEPS.filter((s) => !s.visible || s.visible());
}
let currentId = STEPS[0].id;

function renderProgress() {
  const vs = visibleSteps();
  const idx = vs.findIndex((s) => s.id === currentId);
  progressEl.innerHTML = vs.map((s, i) => `<div class="wiz-progress-step ${i < idx ? "done" : i === idx ? "current" : ""}"></div>`).join("");
}

function renderStep() {
  const vs = visibleSteps();
  let step = vs.find((s) => s.id === currentId);
  if (!step) {
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
  const profile = result.profile;

  if (profile.vat_payer !== true) {
    blockedNotice.classList.remove("hidden");
    wizardWrap.classList.add("hidden");
  } else {
    if (profile.company_name) {
      const parts = profile.company_name.trim().split(/\s+/);
      if (parts.length >= 2) {
        answers.jmeno = parts[0];
        answers.prijmeni = parts.slice(1).join(" ");
      } else {
        answers.prijmeni = profile.company_name;
      }
    }
    renderStep();
  }

  loadingEl.classList.add("hidden");
  shellEl.classList.remove("hidden");
})();

// Krokový průvodce Přehledem OSVČ pro ČSSZ a zdravotní pojišťovnu - stejný
// vzor jako dap-generator-page.js / dph-generator-page.js. Výpočet dělá
// prehled-osvc.js (sdílené s jakoukoli budoucí kontrolou), PDF prehled-osvc-pdf-fill.js.

import { requireOnboardedProfile, signOut } from "./supabase-client.js";
import {
  computePrehledSocialni,
  computeNovaZalohaSocialni,
  computePrehledZdravotni,
  computeNovaZalohaZdravotni,
  rozhodnaCastkaVedlejsi,
  formatKc,
} from "./prehled-osvc.js";

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

function num(v) {
  const n = Number(String(v ?? "").replace(/\s/g, "").replace(",", "."));
  return Number.isFinite(n) ? n : null;
}

let answers = {
  prijmeni: "",
  jmeno: "",
  rodneCislo: "",
  ulice: "",
  cisloDomu: "",
  obec: "",
  psc: "",
  typ: null, // "hlavni" | "vedlejsi"
  celyRok: null,
  pocetMesicu: 12,
  novaFirma: null,
  ucastVedlejsi: null,
  zakladDane: null,
  zalohySocialni: 0,
  zdravotniVyjimka: null,
  zalohyZdravotni: 0,
  stejnyRezim2026: null,
  typ2026: null,
  novaFirma2026: null,
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

function wireRadio(el, name, current, onChange) {
  const inputs = el.querySelectorAll(`input[name="${name}"]`);
  inputs.forEach((input) => {
    input.checked = input.value === current;
    input.addEventListener("change", () => {
      onChange(input.value);
      el.querySelectorAll(".calc-radio-chip").forEach((c) => c.classList.toggle("selected", c.querySelector("input").checked));
    });
  });
  el.querySelectorAll(".calc-radio-chip").forEach((c) => c.classList.toggle("selected", c.querySelector("input").checked));
}

function socialniVysledek() {
  return computePrehledSocialni({
    zakladDane: answers.zakladDane,
    typ: answers.typ,
    pocetMesicu: answers.pocetMesicu,
    novaFirma: answers.novaFirma,
    ucastVedlejsi: answers.ucastVedlejsi,
    zalohyZaplacene: answers.zalohySocialni,
  });
}
function zdravotniVysledek() {
  return computePrehledZdravotni({
    zakladDane: answers.zakladDane,
    pocetMesicu: answers.pocetMesicu,
    vyjimkaZMinima: answers.zdravotniVyjimka,
    zalohyZaplacene: answers.zalohyZdravotni,
  });
}

const STEPS = [
  {
    id: "identifikace",
    bubble: () => "Nejdřív pár základních údajů pro záhlaví přehledu.",
    render(el) {
      el.innerHTML = `
        <div class="wiz-row2">
          <div class="wiz-field"><label>Příjmení</label><input class="text-input" id="w-prijmeni" value="${answers.prijmeni}" /></div>
          <div class="wiz-field"><label>Jméno</label><input class="text-input" id="w-jmeno" value="${answers.jmeno}" /></div>
        </div>
        <div class="wiz-field"><label>Rodné číslo</label><input class="text-input" id="w-rc" value="${answers.rodneCislo}" placeholder="např. 8501011234" /></div>
        <div class="wiz-row2">
          <div class="wiz-field"><label>Ulice</label><input class="text-input" id="w-ulice" value="${answers.ulice}" /></div>
          <div class="wiz-field"><label>Číslo domu</label><input class="text-input" id="w-cd" value="${answers.cisloDomu}" /></div>
        </div>
        <div class="wiz-row2">
          <div class="wiz-field"><label>Obec</label><input class="text-input" id="w-obec" value="${answers.obec}" /></div>
          <div class="wiz-field"><label>PSČ</label><input class="text-input" id="w-psc" value="${answers.psc}" /></div>
        </div>`;
      el.querySelector("#w-prijmeni").addEventListener("input", (e) => (answers.prijmeni = e.target.value));
      el.querySelector("#w-jmeno").addEventListener("input", (e) => (answers.jmeno = e.target.value));
      el.querySelector("#w-rc").addEventListener("input", (e) => (answers.rodneCislo = e.target.value));
      el.querySelector("#w-ulice").addEventListener("input", (e) => (answers.ulice = e.target.value));
      el.querySelector("#w-cd").addEventListener("input", (e) => (answers.cisloDomu = e.target.value));
      el.querySelector("#w-obec").addEventListener("input", (e) => (answers.obec = e.target.value));
      el.querySelector("#w-psc").addEventListener("input", (e) => (answers.psc = e.target.value));
    },
    canNext: () => answers.prijmeni.trim() && answers.rodneCislo.trim(),
  },
  {
    id: "typ",
    bubble: () => "Vykonával/a jste v roce 2025 hlavní, nebo vedlejší samostatnou výdělečnou činnost?",
    render(el) {
      el.innerHTML = `<div class="wiz-yesno">
        <label class="calc-radio-chip"><input type="radio" name="w-typ" value="hlavni" /> Jen hlavní</label>
        <label class="calc-radio-chip"><input type="radio" name="w-typ" value="vedlejsi" /> Jen vedlejší</label>
      </div>`;
      wireRadio(el, "w-typ", answers.typ, (v) => (answers.typ = v));
    },
    canNext: () => answers.typ !== null,
  },
  {
    id: "obdobi",
    bubble: () => "Vykonával/a jste ji celý rok 2025 (12 měsíců), nebo jen část roku?",
    render(el) {
      el.innerHTML = `<div class="wiz-yesno">
        <label class="calc-radio-chip"><input type="radio" name="w-cely" value="ano" /> Celý rok</label>
        <label class="calc-radio-chip"><input type="radio" name="w-cely" value="ne" /> Jen část roku</label>
      </div>`;
      wireYesNo(el, "w-cely", answers.celyRok, (v) => {
        answers.celyRok = v;
        if (v) answers.pocetMesicu = 12;
      });
    },
    canNext: () => answers.celyRok !== null,
  },
  {
    id: "pocet-mesicu",
    visible: () => answers.celyRok === false,
    bubble: () => "Kolik měsíců v roce 2025 (aspoň po část měsíce)?",
    render(el) {
      el.innerHTML = `<div class="wiz-field"><label>Počet měsíců (1–11)</label><input type="number" class="text-input" id="w-pm" min="1" max="11" step="1" value="${answers.pocetMesicu === 12 ? "" : answers.pocetMesicu}" /></div>`;
      el.querySelector("#w-pm").addEventListener("input", (e) => (answers.pocetMesicu = num(e.target.value)));
    },
    canNext: () => answers.pocetMesicu >= 1 && answers.pocetMesicu <= 11,
  },
  {
    id: "nova-firma",
    visible: () => answers.typ === "hlavni",
    bubble: () => "Je rok 2025 první, druhý nebo třetí rok vašeho podnikání (a posledních 20 let jste jako OSVČ nepodnikal/a)?",
    render(el) {
      el.innerHTML = `<div class="wiz-yesno">
        <label class="calc-radio-chip"><input type="radio" name="w-nf" value="ne" /> Ne</label>
        <label class="calc-radio-chip"><input type="radio" name="w-nf" value="ano" /> Ano</label>
      </div>
      <p class="form-hint" style="margin-top:10px;">Pak platí snížené minimum (25 % průměrné mzdy místo 35 %).</p>`;
      wireYesNo(el, "w-nf", answers.novaFirma, (v) => (answers.novaFirma = v));
    },
    canNext: () => answers.novaFirma !== null,
  },
  {
    id: "vedlejsi-ucast",
    visible: () => answers.typ === "vedlejsi",
    bubble() {
      const hranice = rozhodnaCastkaVedlejsi(answers.pocetMesicu);
      return `Dosáhl váš daňový základ z vedlejší činnosti za rok 2025 aspoň ${formatKc(hranice)} (rozhodná částka pro váš počet měsíců), nebo se k důchodovému pojištění za rok 2025 dobrovolně přihlásíte?`;
    },
    render(el) {
      el.innerHTML = `<div class="wiz-yesno">
        <label class="calc-radio-chip"><input type="radio" name="w-uv" value="ne" /> Ne, pod hranicí</label>
        <label class="calc-radio-chip"><input type="radio" name="w-uv" value="ano" /> Ano</label>
      </div>
      <p class="form-hint" style="margin-top:10px;">Pokud ne, sociální pojistné se za rok 2025 neplatí - přehled ČSSZ to jen oznámí.</p>`;
      wireYesNo(el, "w-uv", answers.ucastVedlejsi, (v) => (answers.ucastVedlejsi = v));
    },
    canNext: () => answers.ucastVedlejsi !== null,
  },
  {
    id: "zaklad-dane",
    bubble: () => "Jaký byl váš daňový základ ze samostatné činnosti za rok 2025? (najdete v přiznání k dani z příjmů, řádek 113)",
    render(el) {
      el.innerHTML = `<div class="wiz-field"><label>Daňový základ (Kč)</label><input type="number" class="text-input" id="w-zd" min="0" step="100" value="${answers.zakladDane ?? ""}" /></div>`;
      el.querySelector("#w-zd").addEventListener("input", (e) => (answers.zakladDane = num(e.target.value)));
    },
    canNext: () => answers.zakladDane !== null && answers.zakladDane >= 0,
  },
  {
    id: "zalohy-socialni",
    visible: () => answers.typ === "hlavni" || answers.ucastVedlejsi === true,
    bubble: () => "Kolik jste během roku 2025 celkem zaplatil/a na zálohách na sociální (důchodové) pojištění?",
    render(el) {
      el.innerHTML = `<div class="wiz-field"><label>Zaplacené zálohy na DP (Kč)</label><input type="number" class="text-input" id="w-zs" min="0" step="100" value="${answers.zalohySocialni}" /></div>`;
      el.querySelector("#w-zs").addEventListener("input", (e) => (answers.zalohySocialni = num(e.target.value) ?? 0));
    },
    canNext: () => true,
  },
  {
    id: "zdravotni-vyjimka",
    bubble: () =>
      "Vztahuje se na vás výjimka z minimálního vyměřovacího základu zdravotního pojištění? (současně zaměstnání s odvodem aspoň z minima, student, rodičovská dovolená, pobíráte důchod, za vás platí stát…)",
    render(el) {
      el.innerHTML = `<div class="wiz-yesno">
        <label class="calc-radio-chip"><input type="radio" name="w-zv" value="ne" /> Ne</label>
        <label class="calc-radio-chip"><input type="radio" name="w-zv" value="ano" /> Ano</label>
      </div>`;
      wireYesNo(el, "w-zv", answers.zdravotniVyjimka, (v) => (answers.zdravotniVyjimka = v));
    },
    canNext: () => answers.zdravotniVyjimka !== null,
  },
  {
    id: "zalohy-zdravotni",
    bubble: () => "A kolik jste za rok 2025 zaplatil/a na zálohách na zdravotní pojištění?",
    render(el) {
      el.innerHTML = `<div class="wiz-field"><label>Zaplacené zálohy na ZP (Kč)</label><input type="number" class="text-input" id="w-zz" min="0" step="100" value="${answers.zalohyZdravotni}" /></div>`;
      el.querySelector("#w-zz").addEventListener("input", (e) => (answers.zalohyZdravotni = num(e.target.value) ?? 0));
    },
    canNext: () => true,
  },
  {
    id: "rezim-2026",
    bubble: () => "Budete v roce 2026 pokračovat ve stejném režimu (stejná činnost, stejné zvýhodnění)?",
    render(el) {
      el.innerHTML = `<div class="wiz-yesno">
        <label class="calc-radio-chip"><input type="radio" name="w-r26" value="ano" /> Ano, stejně</label>
        <label class="calc-radio-chip"><input type="radio" name="w-r26" value="ne" /> Bude to jinak</label>
      </div>`;
      wireYesNo(el, "w-r26", answers.stejnyRezim2026, (v) => {
        answers.stejnyRezim2026 = v;
        if (v) {
          answers.typ2026 = answers.typ;
          answers.novaFirma2026 = answers.novaFirma;
        }
      });
    },
    canNext: () => answers.stejnyRezim2026 !== null,
  },
  {
    id: "typ-2026",
    visible: () => answers.stejnyRezim2026 === false,
    bubble: () => "Jak to bude v roce 2026?",
    render(el) {
      el.innerHTML = `
        <div class="wiz-yesno">
          <label class="calc-radio-chip"><input type="radio" name="w-t26" value="hlavni" /> Hlavní</label>
          <label class="calc-radio-chip"><input type="radio" name="w-t26" value="vedlejsi" /> Vedlejší</label>
        </div>
        <div id="w-nf26-wrap" style="margin-top:16px;"></div>`;
      wireRadio(el, "w-t26", answers.typ2026, (v) => {
        answers.typ2026 = v;
        renderNf26();
      });
      const nf26Wrap = el.querySelector("#w-nf26-wrap");
      function renderNf26() {
        if (answers.typ2026 !== "hlavni") {
          nf26Wrap.innerHTML = "";
          return;
        }
        nf26Wrap.innerHTML = `
          <div class="wiz-field"><label>Platí pro vás v roce 2026 ještě zvýhodnění nové firmy (25 % průměrné mzdy)?</label></div>
          <div class="wiz-yesno">
            <label class="calc-radio-chip"><input type="radio" name="w-nf26" value="ne" /> Ne</label>
            <label class="calc-radio-chip"><input type="radio" name="w-nf26" value="ano" /> Ano</label>
          </div>`;
        wireYesNo(nf26Wrap, "w-nf26", answers.novaFirma2026, (v) => (answers.novaFirma2026 = v));
      }
      renderNf26();
    },
    canNext: () => answers.typ2026 !== null && (answers.typ2026 !== "hlavni" || answers.novaFirma2026 !== null),
  },
  {
    id: "souhrn",
    bubble: () => "Tohle vychází z toho, co jste zadal(a) - zkontrolujte a stáhněte podklady.",
    render(el) {
      const socialni = socialniVysledek();
      const zdravotni = zdravotniVysledek();
      const zaloha2026S = computeNovaZalohaSocialni({
        zakladDane: answers.zakladDane,
        pocetMesicu: answers.pocetMesicu,
        typ2026: answers.typ2026,
        novaFirma2026: answers.novaFirma2026,
      });
      const zaloha2026Z = computeNovaZalohaZdravotni({
        zakladDane: answers.zakladDane,
        pocetMesicu: answers.pocetMesicu,
        vyjimkaZMinima: answers.zdravotniVyjimka,
      });

      const row = (label, value, opts = {}) =>
        `<div class="wiz-summary-row ${opts.total ? "total" : ""}"><span class="rlabel">${label}</span><span class="rvalue">${value}</span></div>`;

      let socialniHtml;
      if (socialni.ucast) {
        socialniHtml = `
          ${row("Určený vyměřovací základ", formatKc(socialni.r28))}
          ${row("Pojistné na DP za rok 2025", formatKc(socialni.r32_1))}
          ${row("Zaplacené zálohy", formatKc(socialni.r33))}
          ${socialni.doplatek > 0 ? row("Doplatek", formatKc(socialni.doplatek), { total: true }) : row("Přeplatek", formatKc(socialni.preplatek), { total: true })}
        `;
      } else {
        socialniHtml = `<p class="form-hint">Bez povinné (ani dobrovolné) účasti na důchodovém pojištění - sociální pojistné se za rok 2025 neplatí.</p>`;
      }

      el.innerHTML = `
        <h4 style="margin: 0 0 8px;">ČSSZ - sociální pojištění</h4>
        ${socialniHtml}
        <h4 style="margin: 20px 0 8px;">Zdravotní pojišťovna</h4>
        ${row("Určený vyměřovací základ", formatKc(zdravotni.vzUrceny))}
        ${row("Pojistné za rok 2025", formatKc(zdravotni.pojistne))}
        ${row("Zaplacené zálohy", formatKc(zdravotni.zalohy))}
        ${zdravotni.doplatek > 0 ? row("Doplatek", formatKc(zdravotni.doplatek), { total: true }) : row("Přeplatek", formatKc(zdravotni.preplatek), { total: true })}
        <h4 style="margin: 20px 0 8px;">Nové měsíční zálohy pro rok 2026</h4>
        ${row("Sociální pojištění", formatKc(zaloha2026S.r36))}
        ${row("Zdravotní pojištění", formatKc(zaloha2026Z.zaloha))}
        <div class="wiz-nav" style="margin-top:24px; flex-wrap: wrap; gap: 12px;">
          <button type="button" class="btn btn-secondary" id="w-pdf-cssz">Stáhnout PDF pro ČSSZ ↓</button>
          <button type="button" class="btn btn-secondary" id="w-pdf-zdrav">Stáhnout souhrn pro zdravotní pojišťovnu ↓</button>
        </div>
      `;

      el.querySelector("#w-pdf-cssz").addEventListener("click", async (e) => {
        const btn = e.target;
        const original = btn.textContent;
        btn.disabled = true;
        btn.textContent = "Generuji…";
        try {
          const { generatePrehledOsvcPdf } = await import("./prehled-osvc-pdf-fill.js");
          await generatePrehledOsvcPdf({
            identifikace: {
              prijmeni: answers.prijmeni,
              jmeno: answers.jmeno,
              rodneCislo: answers.rodneCislo,
              ulice: answers.ulice,
              cisloDomu: answers.cisloDomu,
              obec: answers.obec,
              psc: answers.psc,
            },
            typ: answers.typ,
            pocetMesicu: answers.pocetMesicu,
            novaFirma: answers.novaFirma,
            socialni,
            typ2026: answers.typ2026,
            novaFirma2026: answers.novaFirma2026,
            zaloha2026: zaloha2026S,
          });
        } catch (err) {
          alert(`Nepodařilo se vygenerovat PDF (${err.message}). Zkuste to prosím znovu.`);
        } finally {
          btn.disabled = false;
          btn.textContent = original;
        }
      });

      el.querySelector("#w-pdf-zdrav").addEventListener("click", async (e) => {
        const btn = e.target;
        const original = btn.textContent;
        btn.disabled = true;
        btn.textContent = "Generuji…";
        try {
          const { generateZdravotniSouhrnPdf } = await import("./prehled-osvc-pdf-fill.js");
          generateZdravotniSouhrnPdf({
            identifikace: { prijmeni: answers.prijmeni, jmeno: answers.jmeno },
            zdravotni,
            zaloha2026: zaloha2026Z,
          });
        } catch (err) {
          alert(`Nepodařilo se vygenerovat PDF (${err.message}). Zkuste to prosím znovu.`);
        } finally {
          btn.disabled = false;
          btn.textContent = original;
        }
      });
    },
    canNext: () => true,
    nextLabel: null,
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
  const isLast = step.id === "souhrn";
  nextBtn.classList.toggle("hidden", isLast);
  if (!isLast) {
    nextBtn.textContent = step.nextLabel || "Pokračovat →";
    nextBtn.disabled = !step.canNext();
  }

  bodyEl.addEventListener("input", () => (nextBtn.disabled = !step.canNext()));
  bodyEl.addEventListener("change", () => {
    nextBtn.disabled = !step.canNext();
    renderProgress();
  });

  nextBtn.onclick = () => {
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

  if (profile.legal_form === "sro") {
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

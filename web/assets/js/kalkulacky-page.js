// Propojuje formuláře na kalkulacky.html s výpočetním jádrem (tax-calc.js).
// Přepočítává se okamžitě při každé změně vstupu — žádné tlačítko "Spočítat".

import { vypocetOSVC, vypocetSRO, formatKc } from "./tax-calc.js";
import { PAUSALNI_VYDAJE } from "./tax-constants.js";

function row(label, value, opts = {}) {
  const cls = ["calc-row", opts.total ? "total" : "", opts.negative ? "negative" : ""]
    .filter(Boolean)
    .join(" ");
  return `<div class="${cls}"><span class="rlabel">${label}</span><span class="rvalue">${value}</span></div>`;
}

function wireRadioGroup(groupEl, onChange) {
  function sync() {
    groupEl.querySelectorAll(".calc-radio-chip").forEach((chip) => {
      chip.classList.toggle("selected", chip.querySelector("input").checked);
    });
  }
  groupEl.addEventListener("change", () => {
    sync();
    onChange();
  });
  sync();
}

function selectedValue(groupEl, name) {
  return groupEl.querySelector(`input[name="${name}"]:checked`)?.value;
}

/* ============================= Kalkulačka 1 ============================= */
(function initKalkulacka1() {
  const prijemInput = document.getElementById("k1-prijem");
  const rezimGroup = document.getElementById("k1-rezim-group");
  const pausalTypGroup = document.getElementById("k1-pausal-typ-group");
  const pausalField = document.getElementById("k1-pausal-field");
  const vydajeField = document.getElementById("k1-vydaje-field");
  const vydajeInput = document.getElementById("k1-vydaje");
  const vydajeLabel = vydajeField.querySelector("label");
  const resultsEl = document.getElementById("k1-results");
  if (!prijemInput) return;

  function updateFieldVisibility() {
    const rezim = selectedValue(rezimGroup, "k1-rezim");
    pausalField.classList.toggle("hidden", rezim !== "pausal");
    vydajeField.classList.toggle("hidden", rezim === "pausal");
    vydajeLabel.textContent = rezim === "sro" ? "Roční náklady firmy" : "Skutečné roční výdaje";
  }

  function render() {
    const rezim = selectedValue(rezimGroup, "k1-rezim");
    const prijem = Number(prijemInput.value) || 0;

    if (rezim === "sro") {
      const r = vypocetSRO({ prijem, vydaje: Number(vydajeInput.value) || 0 });
      resultsEl.innerHTML =
        row("Hrubý příjem firmy", formatKc(r.prijem)) +
        row("Náklady", "− " + formatKc(r.vydaje), { negative: true }) +
        row("Zisk před zdaněním", formatKc(r.zaklad)) +
        row("Daň z příjmů právnických osob (21 %)", "− " + formatKc(r.danPO), { negative: true }) +
        row("Zisk po zdanění", formatKc(r.ziskPoZdaneni)) +
        row("Srážková daň z dividendy (15 %)", "− " + formatKc(r.srazkovaDan), { negative: true }) +
        row("Čistý příjem společníka", formatKc(r.cistyZisk), { total: true });
      return;
    }

    const pausalTyp = selectedValue(pausalTypGroup, "k1-pausal-typ");
    const r = vypocetOSVC({
      prijem,
      rezim,
      pausalTyp,
      skutecneVydaje: Number(vydajeInput.value) || 0,
    });

    resultsEl.innerHTML =
      row("Hrubý příjem", formatKc(r.prijem)) +
      row(
        rezim === "pausal" ? `Paušální výdaje (${Math.round(PAUSALNI_VYDAJE[pausalTyp].procento * 100)} %)` : "Skutečné výdaje",
        "− " + formatKc(r.vydaje),
        { negative: true }
      ) +
      row("Základ daně", formatKc(r.zaklad)) +
      row("Daň z příjmů", "− " + formatKc(r.dan), { negative: true }) +
      row("Sociální pojištění (29,2 %)", "− " + formatKc(r.socialni), { negative: true }) +
      row("Zdravotní pojištění (13,5 %)", "− " + formatKc(r.zdravotni), { negative: true }) +
      row("Čistý zisk (co vám zůstane)", formatKc(r.cistyZisk), { total: true });
  }

  wireRadioGroup(rezimGroup, () => {
    updateFieldVisibility();
    render();
  });
  wireRadioGroup(pausalTypGroup, render);
  prijemInput.addEventListener("input", render);
  vydajeInput.addEventListener("input", render);

  updateFieldVisibility();
  render();
})();

/* ============================= Kalkulačka 2 ============================= */
(function initKalkulacka2() {
  const prijemInput = document.getElementById("k2-prijem");
  const vydajeInput = document.getElementById("k2-vydaje");
  const pausalTypGroup = document.getElementById("k2-pausal-typ-group");
  const resultsEl = document.getElementById("k2-results");
  if (!prijemInput) return;

  function compareRows(r) {
    return (
      row("Základ daně", formatKc(r.zaklad ?? r.zaklad)) +
      row("Daň", "− " + formatKc(r.dan ?? r.danPO), { negative: true }) +
      row("Pojistné / srážková daň", "− " + formatKc(r.rezim === "sro" ? r.srazkovaDan : r.socialni + r.zdravotni), { negative: true }) +
      row("Čistý zisk", formatKc(r.cistyZisk), { total: true })
    );
  }

  function col(title, result, isWinner) {
    return `
      <div class="compare-col ${isWinner ? "winner" : ""}">
        ${isWinner ? '<span class="chip chip-green winner-badge">Nejvýhodnější</span>' : ""}
        <div class="compare-col-title"><h4>${title}</h4></div>
        ${compareRows(result)}
      </div>`;
  }

  function render() {
    const prijem = Number(prijemInput.value) || 0;
    const vydaje = Number(vydajeInput.value) || 0;
    const pausalTyp = selectedValue(pausalTypGroup, "k2-pausal-typ");

    const rPausal = vypocetOSVC({ prijem, rezim: "pausal", pausalTyp });
    const rSkutecne = vypocetOSVC({ prijem, rezim: "skutecne", skutecneVydaje: vydaje });
    const rSro = vypocetSRO({ prijem, vydaje });

    const best = Math.max(rPausal.cistyZisk, rSkutecne.cistyZisk, rSro.cistyZisk);

    resultsEl.innerHTML =
      col(`Paušál (${Math.round(PAUSALNI_VYDAJE[pausalTyp].procento * 100)} %)`, rPausal, rPausal.cistyZisk === best) +
      col("Skutečné výdaje", rSkutecne, rSkutecne.cistyZisk === best) +
      col("s.r.o.", rSro, rSro.cistyZisk === best);
  }

  wireRadioGroup(pausalTypGroup, render);
  prijemInput.addEventListener("input", render);
  vydajeInput.addEventListener("input", render);

  render();
})();

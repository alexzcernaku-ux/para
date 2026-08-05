// Krátká uvítací prohlídka appky po prvním přihlášení (3 kroky: chat,
// Nástroje, Termíny) - ukáže se jen jednou na prohlížeč/účet, pak se
// zapamatuje přes localStorage. Žádná závislost na žádné knihovně -
// prostý overlay + zvýraznění cílového prvku přes dočasně zvednutý z-index.

function buildOverlay() {
  const overlay = document.createElement("div");
  overlay.className = "tour-overlay";
  document.body.appendChild(overlay);
  return overlay;
}

function buildTooltip() {
  const tooltip = document.createElement("div");
  tooltip.className = "tour-tooltip";
  tooltip.innerHTML = `
    <div class="tour-tooltip-step"></div>
    <h4 class="tour-tooltip-title"></h4>
    <p class="tour-tooltip-text"></p>
    <div class="tour-tooltip-actions">
      <button type="button" class="tour-skip">Přeskočit</button>
      <button type="button" class="tour-next btn btn-primary"></button>
    </div>
  `;
  document.body.appendChild(tooltip);
  return tooltip;
}

function positionTooltip(tooltip, target) {
  const rect = target.getBoundingClientRect();
  const tipRect = tooltip.getBoundingClientRect();
  const margin = 14;
  let top = rect.bottom + margin;
  if (top + tipRect.height > window.innerHeight - margin) {
    top = rect.top - tipRect.height - margin;
  }
  let left = rect.left;
  if (left + tipRect.width > window.innerWidth - margin) {
    left = window.innerWidth - tipRect.width - margin;
  }
  left = Math.max(margin, left);
  top = Math.max(margin, top);
  tooltip.style.top = `${top + window.scrollY}px`;
  tooltip.style.left = `${left + window.scrollX}px`;
}

// Steps: [{ selector, title, text }]
export function startTour(steps, { storageKey }) {
  if (!steps.length || localStorage.getItem(storageKey)) return;

  // Chybí-li kterýkoli cílový prvek (jiný stav stránky, budoucí redesign
  // apod.), radši prohlídku vůbec nespustit než ukazovat rozbité kroky
  // mířící do prázdna.
  const resolved = steps
    .map((step) => ({ ...step, el: document.querySelector(step.selector) }))
    .filter((step) => step.el);
  if (!resolved.length) return;

  const overlay = buildOverlay();
  const tooltip = buildTooltip();
  let index = 0;
  let currentEl = null;

  function finish() {
    if (currentEl) currentEl.classList.remove("tour-highlight");
    overlay.remove();
    tooltip.remove();
    localStorage.setItem(storageKey, "1");
  }

  function showStep() {
    if (currentEl) currentEl.classList.remove("tour-highlight");
    const step = resolved[index];
    currentEl = step.el;
    currentEl.scrollIntoView({ behavior: "smooth", block: "center" });
    currentEl.classList.add("tour-highlight");

    tooltip.querySelector(".tour-tooltip-step").textContent = `${index + 1} / ${resolved.length}`;
    tooltip.querySelector(".tour-tooltip-title").textContent = step.title;
    tooltip.querySelector(".tour-tooltip-text").textContent = step.text;
    tooltip.querySelector(".tour-next").textContent = index === resolved.length - 1 ? "Hotovo" : "Další";

    // scrollIntoView je async (plynulý scroll) - počkat, než se ustálí,
    // ať se tooltip neumístí podle staré pozice cíle.
    setTimeout(() => positionTooltip(tooltip, currentEl), 350);
  }

  tooltip.querySelector(".tour-skip").addEventListener("click", finish);
  tooltip.querySelector(".tour-next").addEventListener("click", () => {
    index += 1;
    if (index >= resolved.length) finish();
    else showStep();
  });
  overlay.addEventListener("click", finish);

  showStep();
}

// Rychlé hledání napříč appkou (Cmd/Ctrl+K, nebo klik na tlačítko
// "Hledat" v topbaru) - statický seznam stránek appky s klíčovými slovy,
// žádné volání serveru. S 15+ nástroji + klienty + fakturami začíná být
// "kde to jen bylo" reálný problém, tohle ho řeší jedním zkráceným
// příkazem místo scrollování v menu Nástroje.

const DESTINATIONS = [
  { name: "Domů / chat", href: "app.html", keywords: "dotaz otázka zákon" },
  { name: "Vyplnit přiznání k dani z příjmů", href: "dap-generator.html", keywords: "dap dpfo daň z příjmů" },
  { name: "Kontrola přiznání k dani z příjmů", href: "kontrola-priznani.html", keywords: "dap dpfo kontrola" },
  { name: "Vyplnit přiznání k DPH", href: "dph-generator.html", keywords: "dph daň z přidané hodnoty" },
  { name: "Kontrola přiznání k DPH", href: "kontrola-dph.html", keywords: "dph kontrola" },
  { name: "Kontrolní hlášení", href: "kontrola-kh.html", keywords: "kh dph" },
  { name: "Příjmy a výdaje", href: "evidence.html", keywords: "evidence peněžní deník" },
  { name: "Sledování faktur", href: "faktury.html", keywords: "faktura pohledávky splatnost" },
  { name: "Klienti", href: "klienti.html", keywords: "odběratel zákazník kontakt" },
  { name: "Kniha jízd", href: "kniha-jizd.html", keywords: "auto km cestovní náhrady phm" },
  { name: "Import bankovního výpisu", href: "import-vypisu.html", keywords: "csv banka výpis" },
  { name: "Kontrola dokladu", href: "kontrola-dokladu.html", keywords: "účtenka faktura fotka náležitosti" },
  { name: "Generátor dokumentů", href: "generator-dokumentu.html", keywords: "faktura smlouva upomínka storno vystavit" },
  { name: "Přehled OSVČ", href: "prehled-osvc.html", keywords: "sociální zdravotní pojištění cssz" },
  { name: "Export pro účetního", href: "export-balicku.html", keywords: "pdf csv export" },
  { name: "Kalkulačky", href: "kalkulacky.html", keywords: "kolik zbyde paušál srovnání" },
  { name: "Termíny", href: "terminy.html", keywords: "upozornění zálohy deadline" },
  { name: "Můj účet", href: "ucet.html", keywords: "profil předplatné firemní údaje nastavení" },
];

function buildPalette() {
  const overlay = document.createElement("div");
  overlay.className = "cmdk-overlay hidden";
  overlay.innerHTML = `
    <div class="cmdk-box" role="dialog" aria-label="Rychlé hledání">
      <input type="text" class="cmdk-input" placeholder="Hledat nástroj..." aria-label="Hledat" />
      <div class="cmdk-results"></div>
    </div>
  `;
  document.body.appendChild(overlay);
  return overlay;
}

function init() {
  const overlay = buildPalette();
  const box = overlay.querySelector(".cmdk-box");
  const input = overlay.querySelector(".cmdk-input");
  const resultsEl = overlay.querySelector(".cmdk-results");
  const currentPage = window.location.pathname.split("/").pop();
  let filtered = [];
  let activeIndex = 0;

  function render() {
    const q = input.value.trim().toLowerCase();
    filtered = DESTINATIONS.filter((d) => d.href !== currentPage).filter(
      (d) => !q || d.name.toLowerCase().includes(q) || d.keywords.includes(q)
    );
    activeIndex = 0;
    resultsEl.innerHTML = filtered
      .map((d, i) => `<a href="${d.href}" class="cmdk-result${i === 0 ? " active" : ""}" data-i="${i}">${d.name}</a>`)
      .join("") || `<div class="cmdk-empty">Nic nenalezeno.</div>`;
  }

  function setActive(i) {
    const items = resultsEl.querySelectorAll(".cmdk-result");
    items.forEach((el) => el.classList.remove("active"));
    if (items[i]) {
      items[i].classList.add("active");
      items[i].scrollIntoView({ block: "nearest" });
    }
    activeIndex = i;
  }

  function open() {
    overlay.classList.remove("hidden");
    input.value = "";
    render();
    input.focus();
  }
  function close() {
    overlay.classList.add("hidden");
  }

  document.addEventListener("keydown", (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
      e.preventDefault();
      overlay.classList.contains("hidden") ? open() : close();
    } else if (e.key === "Escape" && !overlay.classList.contains("hidden")) {
      close();
    }
  });

  document.querySelectorAll("[data-cmdk-open]").forEach((btn) => btn.addEventListener("click", open));
  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) close();
  });
  input.addEventListener("input", render);
  input.addEventListener("keydown", (e) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive(Math.min(activeIndex + 1, filtered.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive(Math.max(activeIndex - 1, 0));
    } else if (e.key === "Enter" && filtered[activeIndex]) {
      window.location.href = filtered[activeIndex].href;
    }
  });
  resultsEl.addEventListener("mousemove", (e) => {
    const el = e.target.closest(".cmdk-result");
    if (el) setActive(Number(el.dataset.i));
  });
}

init();

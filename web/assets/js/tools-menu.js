// Sdílené "Nástroje" menu v topbaru samostatných nástrojových stránek
// (evidence.html, faktury.html, kontrola-dokladu.html apod.) - dřív šlo
// mezi nástroji přeskočit jen přes "Zpět do chatu" a znovu hledat v appce.
// Stejný vzor jako #tools-menu-btn/#tools-menu-panel v app.html, jen
// vytažený sem, ať se nekopíruje devětkrát tatáž JS logika.

const btn = document.getElementById("tools-menu-btn");
const panel = document.getElementById("tools-menu-panel");
if (btn && panel) {
  btn.addEventListener("click", (e) => {
    e.stopPropagation();
    const isOpen = !panel.classList.contains("hidden");
    panel.classList.toggle("hidden", isOpen);
    btn.setAttribute("aria-expanded", String(!isOpen));
  });
  document.addEventListener("click", (e) => {
    if (!panel.classList.contains("hidden") && !panel.contains(e.target) && e.target !== btn) {
      panel.classList.add("hidden");
      btn.setAttribute("aria-expanded", "false");
    }
  });

  // Odkaz na aktuální stránku v menu zvýrazní, ať je hned vidět, kde
  // uživatel je - orientace v devíti+ podobně vyhlížejících nástrojích.
  const currentPage = window.location.pathname.split("/").pop();
  panel.querySelectorAll("a").forEach((a) => {
    if (a.getAttribute("href") === currentPage) a.classList.add("app-tools-current");
  });
}

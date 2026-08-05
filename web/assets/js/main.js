// Drobné UI interakce nezávislé na trial chatu (mobilní menu).
(function () {
  const toggle = document.getElementById("nav-toggle");
  const menu = document.getElementById("mobile-menu");
  const close = document.getElementById("mobile-menu-close");
  if (!toggle || !menu) return;

  function open() {
    menu.classList.remove("hidden");
    document.body.style.overflow = "hidden";
  }
  function hide() {
    menu.classList.add("hidden");
    document.body.style.overflow = "";
  }

  toggle.addEventListener("click", open);
  close?.addEventListener("click", hide);
  menu.querySelectorAll("a").forEach((a) => a.addEventListener("click", hide));
})();

// Odhalení sekcí při scrollu (.reveal → .is-visible) - čistě kosmetické.
// Bezpečnostní pojistka: ať selže cokoliv (starý prohlížeč, chyba v JS,
// crawler bez scrollu, neobvyklé zobrazení), obsah nesmí zůstat neviditelný
// navždy - proto tvrdý timeout, který po chvíli odhalí úplně všechno bez
// ohledu na to, jestli se to reálně "odscrollovalo" do viewportu.
//
// .reveal je v CSS viditelný, dokud <html> nemá třídu .js-ready - tu
// přidáváme až tady, těsně předtím, než se spustí observer/timeout, co ji
// zase odhalí. Bez JS (nebo dokud se nenačte) je tak obsah vidět normálně.
(function () {
  const targets = document.querySelectorAll(".reveal");
  if (!targets.length) return;

  const revealAll = () => targets.forEach((el) => el.classList.add("is-visible"));

  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches || !("IntersectionObserver" in window)) {
    revealAll();
    return;
  }

  document.documentElement.classList.add("js-ready");

  try {
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            entry.target.classList.add("is-visible");
            observer.unobserve(entry.target);
          }
        }
      },
      { threshold: 0.12, rootMargin: "0px 0px -40px 0px" }
    );
    targets.forEach((el) => observer.observe(el));
  } catch {
    revealAll();
    return;
  }

  setTimeout(revealAll, 3000);
})();

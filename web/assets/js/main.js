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

// Carousel ukázek appky (#ukazky) - auto-posun každé 4.5s, zastaví se při
// najetí myší/focusu nebo při prefers-reduced-motion. Scroll-snap dělá
// těžkou práci sám (funguje i bez JS jako ručně swipovatelný pás), JS jen
// řídí tečky a auto-advance.
(function () {
  const viewport = document.getElementById("showcase-viewport");
  const dotsWrap = document.getElementById("showcase-dots");
  if (!viewport || !dotsWrap) return;

  const frames = Array.from(viewport.children);
  const dots = Array.from(dotsWrap.children);
  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  let current = 0;
  let timer = null;

  function goTo(idx) {
    current = (idx + frames.length) % frames.length;
    frames[current].scrollIntoView({ behavior: reduceMotion ? "auto" : "smooth", block: "nearest", inline: "center" });
    dots.forEach((d, i) => d.classList.toggle("active", i === current));
  }

  function startAutoplay() {
    if (reduceMotion) return;
    stopAutoplay();
    timer = setInterval(() => goTo(current + 1), 4500);
  }
  function stopAutoplay() {
    if (timer) clearInterval(timer);
    timer = null;
  }

  dots.forEach((dot, i) => {
    dot.addEventListener("click", () => {
      goTo(i);
      startAutoplay();
    });
  });

  // Ruční swipe/scroll taky přepočítá aktivní tečku - IntersectionObserver
  // na jednotlivé rámečky je spolehlivější než počítat scrollLeft ručně.
  try {
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            const idx = frames.indexOf(entry.target);
            if (idx !== -1) {
              current = idx;
              dots.forEach((d, i) => d.classList.toggle("active", i === idx));
            }
          }
        }
      },
      { root: viewport, threshold: 0.6 }
    );
    frames.forEach((f) => observer.observe(f));
  } catch {
    // bez IntersectionObserver zůstanou tečky jen na ručním ovládání
  }

  viewport.addEventListener("mouseenter", stopAutoplay);
  viewport.addEventListener("mouseleave", startAutoplay);
  viewport.addEventListener("focusin", stopAutoplay);
  viewport.addEventListener("focusout", startAutoplay);

  startAutoplay();
})();

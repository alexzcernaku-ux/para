// Živý ukazatel aktuálnosti zákonů (hero sekce) - volá veřejnou edge funkci
// law-freshness (agregát nad law_versions, viz komentář tam), zobrazí kolik
// zákonů appka sleduje a kdy byl naposledy nějaký reálně zkontrolován proti
// e-Sbírce. Selže-li fetch (funkce ještě nenasazená, výpadek), badge prostě
// zůstane skrytý - žádná chybová hláška návštěvníkovi landing page.
(function () {
  const cfg = window.PARA_CONFIG || {};
  const badge = document.getElementById("law-freshness-badge");
  const textEl = document.getElementById("law-freshness-text");
  if (!badge || !textEl || !cfg.supabaseUrl) return;

  fetch(`${cfg.supabaseUrl}/functions/v1/law-freshness`, {
    headers: cfg.supabaseAnonKey ? { apikey: cfg.supabaseAnonKey } : {},
  })
    .then((res) => (res.ok ? res.json() : Promise.reject()))
    .then((data) => {
      if (!data.trackedLaws || !data.lastCheckedAt) return;
      const date = new Date(data.lastCheckedAt).toLocaleDateString("cs-CZ", { day: "numeric", month: "long", year: "numeric" });
      textEl.textContent = `Sledujeme ${data.trackedLaws} zákonů a vyhlášek - naposledy zkontrolováno ${date}`;
      badge.classList.remove("hidden");
    })
    .catch(() => {});
})();

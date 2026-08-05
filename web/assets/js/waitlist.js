// Waitlist modal - zachytává e-mail zájemců o registraci, dokud Fáze 2
// (Supabase Auth) není hotová. Zapisuje přímo do tabulky `waitlist` přes
// PostgREST (stejný vzor jako insertFeedback v 03_local_server.mjs), s
// anon klíčem a insert-only RLS politikou - viz 06_schema_waitlist.sql.

(function () {
  const cfg = window.PARA_CONFIG || {};
  const SUPABASE_URL = cfg.supabaseUrl || "";
  const SUPABASE_ANON_KEY = cfg.supabaseAnonKey || "";

  const backdrop = document.getElementById("waitlist-backdrop");
  const closeBtn = document.getElementById("waitlist-close");
  const form = document.getElementById("waitlist-form");
  const emailInput = document.getElementById("waitlist-email");
  const submitBtn = document.getElementById("waitlist-submit");
  const formState = document.getElementById("waitlist-form-state");
  const successState = document.getElementById("waitlist-success-state");
  const openTriggers = document.querySelectorAll("[data-open-waitlist]");

  if (!backdrop || !form) return;

  let lastFocused = null;

  function open(e) {
    if (e) e.preventDefault();
    lastFocused = document.activeElement;
    backdrop.classList.remove("hidden");
    document.body.style.overflow = "hidden";
    emailInput.focus();
  }

  function close() {
    backdrop.classList.add("hidden");
    document.body.style.overflow = "";
    if (lastFocused) lastFocused.focus();
  }

  openTriggers.forEach((el) => el.addEventListener("click", open));
  closeBtn.addEventListener("click", close);
  backdrop.addEventListener("click", (e) => {
    if (e.target === backdrop) close();
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !backdrop.classList.contains("hidden")) close();
  });

  function removeError() {
    const existing = form.querySelector(".modal-form-error");
    if (existing) existing.remove();
  }

  function showFormError(message) {
    removeError();
    const p = document.createElement("p");
    p.className = "modal-form-error";
    p.textContent = message;
    form.appendChild(p);
  }

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    removeError();
    const email = emailInput.value.trim();
    if (!email) return;

    if (!SUPABASE_URL || SUPABASE_URL.includes("TVUJ-PROJEKT")) {
      showFormError("Formulář zatím není napojený na databázi (chybí Supabase konfigurace).");
      return;
    }

    submitBtn.disabled = true;
    submitBtn.textContent = "Odesílám…";

    try {
      const res = await fetch(`${SUPABASE_URL}/rest/v1/waitlist`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          apikey: SUPABASE_ANON_KEY,
          Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
          Prefer: "return=minimal",
        },
        body: JSON.stringify({ email, source: "landing_page" }),
      });
      if (!res.ok && res.status !== 409) {
        throw new Error(`Server odpověděl chybou (${res.status}).`);
      }
      formState.classList.add("hidden");
      successState.classList.remove("hidden");
    } catch (err) {
      showFormError(`Nepodařilo se odeslat (${err.message}). Zkuste to prosím znovu.`);
    } finally {
      submitBtn.disabled = false;
      submitBtn.textContent = "Chci vědět jako první";
    }
  });
})();

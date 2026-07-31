// Živá ukázka na landing page — 3 dotazy zdarma bez registrace.
//
// Endpoint: v místním vývoji míří na 03_local_server.mjs (NDJSON streaming,
// viz protokol v tom souboru). Po nasazení supabase/functions/zakon-query
// (03_edge_function/index.ts) přepni PARA_CONFIG.endpoint v index.html na
// finální URL edge function — ta zatím vrací jedno JSON tělo (ne stream),
// proto klient níže umí obojí (viz callEndpoint: NDJSON i plain JSON větev).
//
// Limit 3 dotazů je řešený jen přes localStorage (žádné ověření na serveru) —
// je to měkká brzda pro motivaci k registraci, ne bezpečnostní opatření.
// Skutečné vynucení limitu přijde s Fází 2 (účty) a rate limitingem per-user.

(function () {
  const cfg = window.PARA_CONFIG || {};
  const ENDPOINT = cfg.endpoint || "http://localhost:8787";
  const ANON_KEY = cfg.anonKey || "";
  const FREE_LIMIT = 3;
  const STORAGE_KEY = "para_trial_used";

  const thread = document.getElementById("demo-thread");
  const composerForm = document.getElementById("demo-composer");
  const input = document.getElementById("demo-input");
  const sendBtn = document.getElementById("demo-send");
  const lockedPanel = document.getElementById("demo-locked");
  const quotaEl = document.getElementById("demo-quota-count");
  const errorEl = document.getElementById("demo-error");
  const exampleButtons = document.querySelectorAll(".demo-example-q");

  if (!thread || !composerForm) return; // sekce není na stránce

  let history = [];

  function getUsed() {
    return parseInt(localStorage.getItem(STORAGE_KEY) || "0", 10);
  }
  function setUsed(n) {
    localStorage.setItem(STORAGE_KEY, String(n));
  }
  function remaining() {
    return Math.max(0, FREE_LIMIT - getUsed());
  }

  function updateQuotaUI() {
    if (quotaEl) quotaEl.textContent = String(remaining());
    if (remaining() <= 0) {
      composerForm.classList.add("hidden");
      lockedPanel.classList.remove("hidden");
    }
  }

  function clearEmptyState() {
    const empty = thread.querySelector(".demo-empty");
    if (empty) empty.remove();
  }

  // Claude odpovídá s lehkým markdownem (hlavně **tučně** u předkontací).
  // Bublina používá white-space: pre-wrap, takže i po vložení přes innerHTML
  // zůstanou zalomení řádků zachovaná — jen je potřeba escapovat HTML entity
  // předtím, než se ** převedou na <strong>, aby text z modelu nemohl vložit
  // vlastní značky.
  function escapeHtml(s) {
    return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }
  function formatAnswer(text) {
    return escapeHtml(text).replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
  }

  function addMessage(role, text) {
    clearEmptyState();
    const wrap = document.createElement("div");
    wrap.className = `demo-msg ${role}`;

    const avatar = document.createElement("div");
    if (role === "assistant") {
      avatar.className = "avatar";
      const img = document.createElement("img");
      img.src = "assets/img/mascot/mascot-face-icon.png";
      img.alt = "Para";
      avatar.appendChild(img);
    } else {
      avatar.className = "avatar user-avatar";
      avatar.textContent = "TY";
    }

    const bubble = document.createElement("div");
    bubble.className = "demo-bubble";
    if (role === "assistant") {
      bubble.innerHTML = formatAnswer(text);
    } else {
      bubble.textContent = text;
    }

    wrap.appendChild(avatar);
    wrap.appendChild(bubble);
    thread.appendChild(wrap);
    thread.scrollTop = thread.scrollHeight;
    return { wrap, bubble };
  }

  function addTyping() {
    const { wrap, bubble } = addMessage("assistant", "");
    bubble.innerHTML = '<span class="demo-typing"><span></span><span></span><span></span></span>';
    return wrap;
  }

  function addSources(sources) {
    if (!sources || !sources.length) return;
    const wrap = document.createElement("div");
    wrap.className = "demo-sources";
    sources.slice(0, 4).forEach((s) => {
      const tag = document.createElement(s.source_url ? "a" : "span");
      tag.className = "demo-source-tag";
      if (s.source_url) {
        tag.href = s.source_url;
        tag.target = "_blank";
        tag.rel = "noopener";
      }
      tag.textContent = `${s.law_name || ""} ${s.section_ref || ""}`.trim();
      wrap.appendChild(tag);
    });
    thread.appendChild(wrap);
    thread.scrollTop = thread.scrollHeight;
  }

  function showError(message) {
    if (!errorEl) return;
    errorEl.textContent = message;
    errorEl.classList.remove("hidden");
  }
  function hideError() {
    if (errorEl) errorEl.classList.add("hidden");
  }

  async function callEndpoint(question, typingEl) {
    const res = await fetch(ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(ANON_KEY ? { Authorization: `Bearer ${ANON_KEY}` } : {}),
      },
      body: JSON.stringify({ question, history }),
    });
    if (!res.ok) {
      throw new Error(`Server odpověděl chybou (${res.status}).`);
    }

    const contentType = res.headers.get("content-type") || "";

    if (contentType.includes("ndjson") && res.body) {
      // Streamovací protokol lokálního serveru (03_local_server.mjs)
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let fullAnswer = "";
      let sources = [];
      let bubbleEl = null;

      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop();
        for (const line of lines) {
          if (!line.trim()) continue;
          let evt;
          try {
            evt = JSON.parse(line);
          } catch {
            continue;
          }
          if (evt.type === "sources") {
            sources = evt.data || [];
          } else if (evt.type === "delta") {
            if (typingEl && typingEl.isConnected) {
              typingEl.remove();
              const created = addMessage("assistant", "");
              bubbleEl = created.bubble;
            }
            fullAnswer += evt.text;
            bubbleEl.innerHTML = formatAnswer(fullAnswer);
            thread.scrollTop = thread.scrollHeight;
          } else if (evt.type === "error") {
            throw new Error(evt.message || "Neznámá chyba.");
          }
        }
      }
      if (typingEl && typingEl.isConnected) typingEl.remove();
      if (!fullAnswer) {
        addMessage("assistant", "Nepodařilo se získat odpověď.");
      }
      addSources(sources);
      return { answer: fullAnswer, streamed: true };
    }

    // Prostý JSON (nasazená edge function bez streamu)
    const data = await res.json();
    if (data.error) throw new Error(data.error);
    return data;
  }

  async function ask(question) {
    if (!question.trim() || remaining() <= 0) return;
    hideError();

    addMessage("user", question);
    input.value = "";
    sendBtn.disabled = true;
    input.disabled = true;

    const typingEl = addTyping();

    try {
      const data = await callEndpoint(question, typingEl);
      // NDJSON větev (data.streamed) si typing bublinu a odpověď vykreslila
      // postupně sama; JSON větev doplní celou odpověď najednou tady:
      if (!data.streamed) {
        if (typingEl && typingEl.isConnected) typingEl.remove();
        addMessage("assistant", data.answer || "Nepodařilo se získat odpověď.");
        addSources(data.sources);
      }
      history.push({ role: "user", content: question });
      history.push({ role: "assistant", content: data.answer || "" });
      history = history.slice(-6);

      setUsed(getUsed() + 1);
      updateQuotaUI();
    } catch (err) {
      if (typingEl && typingEl.isConnected) typingEl.remove();
      showError(
        `Ukázku se nepodařilo načíst (${err.message}). Zkus to prosím za chvíli znovu.`
      );
    } finally {
      sendBtn.disabled = false;
      input.disabled = remaining() <= 0;
      if (remaining() > 0) input.focus();
    }
  }

  composerForm.addEventListener("submit", (e) => {
    e.preventDefault();
    ask(input.value);
  });

  input?.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      composerForm.requestSubmit();
    }
  });

  exampleButtons.forEach((btn) => {
    btn.addEventListener("click", () => {
      if (remaining() <= 0) return;
      ask(btn.dataset.question || btn.textContent);
    });
  });

  updateQuotaUI();
})();

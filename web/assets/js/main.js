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

import { requireOnboardedProfile, signOut, listClients, insertClient, updateClient, deleteClient } from "./supabase-client.js";

const loadingEl = document.getElementById("page-loading");
const shellEl = document.getElementById("page-shell");
const signoutBtn = document.getElementById("signout-btn");
const form = document.getElementById("client-form");
const submitBtn = document.getElementById("client-submit");
const cancelEditBtn = document.getElementById("client-cancel-edit");
const formTitle = document.getElementById("form-title");
const tbody = document.getElementById("clients-tbody");
const tableEl = document.getElementById("clients-table");
const emptyEl = document.getElementById("clients-empty");

signoutBtn.addEventListener("click", () => signOut());

let userId = null;
let allClients = [];
let editingId = null;

function fieldValues() {
  return {
    name: document.getElementById("c-name").value.trim(),
    ico: document.getElementById("c-ico").value.trim(),
    dic: document.getElementById("c-dic").value.trim(),
    address: document.getElementById("c-address").value.trim(),
    email: document.getElementById("c-email").value.trim(),
    phone: document.getElementById("c-phone").value.trim(),
    note: document.getElementById("c-note").value.trim(),
  };
}

function startEdit(client) {
  editingId = client.id;
  document.getElementById("c-name").value = client.name || "";
  document.getElementById("c-ico").value = client.ico || "";
  document.getElementById("c-dic").value = client.dic || "";
  document.getElementById("c-address").value = client.address || "";
  document.getElementById("c-email").value = client.email || "";
  document.getElementById("c-phone").value = client.phone || "";
  document.getElementById("c-note").value = client.note || "";
  formTitle.textContent = "Upravit klienta";
  submitBtn.textContent = "Uložit změny";
  cancelEditBtn.classList.remove("hidden");
  form.scrollIntoView({ behavior: "smooth", block: "start" });
}

function stopEdit() {
  editingId = null;
  form.reset();
  formTitle.textContent = "Přidat klienta";
  submitBtn.textContent = "+ Přidat klienta";
  cancelEditBtn.classList.add("hidden");
}

cancelEditBtn.addEventListener("click", stopEdit);

function renderTable() {
  if (!allClients.length) {
    tableEl.classList.add("hidden");
    emptyEl.classList.remove("hidden");
    return;
  }
  emptyEl.classList.add("hidden");
  tableEl.classList.remove("hidden");
  tbody.innerHTML = allClients
    .map((c) => {
      const contact = [c.email, c.phone].filter(Boolean).join(" · ") || "-";
      return `
        <tr>
          <td data-label="Název">${c.name}</td>
          <td data-label="IČO">${c.ico || "-"}</td>
          <td data-label="Kontakt">${contact}</td>
          <td data-label="Poznámka">${c.note || "-"}</td>
          <td data-label=""><button type="button" class="list-row-edit" data-edit="${c.id}" aria-label="Upravit"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9M16.5 3.5a2.12 2.12 0 013 3L7 19l-4 1 1-4L16.5 3.5z" /></svg></button></td>
          <td data-label=""><button type="button" class="list-row-delete" data-del="${c.id}" aria-label="Smazat"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18" /></svg></button></td>
        </tr>`;
    })
    .join("");

  tbody.querySelectorAll("[data-edit]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const client = allClients.find((c) => c.id === Number(btn.dataset.edit));
      if (client) startEdit(client);
    });
  });
  tbody.querySelectorAll("[data-del]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const id = Number(btn.dataset.del);
      if (!confirm("Smazat tohoto klienta?")) return;
      btn.disabled = true;
      try {
        await deleteClient(id);
        allClients = allClients.filter((c) => c.id !== id);
        if (editingId === id) stopEdit();
        renderTable();
      } catch (err) {
        alert(`Nepodařilo se smazat klienta (${err.message}).`);
        btn.disabled = false;
      }
    });
  });
}

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  submitBtn.disabled = true;
  const original = submitBtn.textContent;
  submitBtn.textContent = "Ukládám…";
  try {
    const values = fieldValues();
    if (editingId) {
      await updateClient(editingId, values);
      const idx = allClients.findIndex((c) => c.id === editingId);
      if (idx !== -1) allClients[idx] = { ...allClients[idx], ...values };
      allClients.sort((a, b) => a.name.localeCompare(b.name, "cs"));
      stopEdit();
    } else {
      const created = await insertClient(userId, values);
      allClients.push(created);
      allClients.sort((a, b) => a.name.localeCompare(b.name, "cs"));
      form.reset();
    }
    renderTable();
  } catch (err) {
    alert(`Nepodařilo se uložit klienta (${err.message}).`);
  } finally {
    submitBtn.disabled = false;
    submitBtn.textContent = editingId ? "Uložit změny" : original;
  }
});

(async () => {
  const result = await requireOnboardedProfile();
  if (!result) return;
  userId = result.session.user.id;

  try {
    allClients = await listClients(userId);
  } catch (err) {
    console.error("Nepodařilo se načíst klienty:", err.message);
    allClients = [];
  }
  renderTable();

  loadingEl.classList.add("hidden");
  shellEl.classList.remove("hidden");
})();

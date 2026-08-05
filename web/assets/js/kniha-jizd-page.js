import { requireOnboardedProfile, signOut, listVehicleTrips, insertVehicleTrip, deleteVehicleTrip } from "./supabase-client.js";
import { computeTripReimbursement, sumTrips, formatKc, FUEL_LABELS } from "./kniha-jizd.js";

const loadingEl = document.getElementById("page-loading");
const shellEl = document.getElementById("page-shell");
const signoutBtn = document.getElementById("signout-btn");
const form = document.getElementById("trip-form");
const submitBtn = document.getElementById("trip-submit");
const fuelSelect = document.getElementById("f-fuel");
const priceWrap = document.getElementById("f-price-wrap");
const tbody = document.getElementById("trips-tbody");
const tableEl = document.getElementById("trips-table");
const emptyEl = document.getElementById("trips-empty");

signoutBtn.addEventListener("click", () => signOut());

let userId = null;
let trips = [];

fuelSelect.addEventListener("change", () => {
  priceWrap.classList.toggle("hidden", fuelSelect.value !== "vlastni_cena");
});

function renderSummary() {
  const s = sumTrips(trips);
  document.getElementById("sum-km").textContent = `${s.distanceKm.toLocaleString("cs-CZ")} km`;
  document.getElementById("sum-zakladni").textContent = formatKc(s.zakladniNahrada);
  document.getElementById("sum-phm").textContent = formatKc(s.nahradaPhm);
  document.getElementById("sum-celkem").textContent = formatKc(s.celkem);
}

function renderTable() {
  if (!trips.length) {
    tableEl.classList.add("hidden");
    emptyEl.classList.remove("hidden");
    return;
  }
  emptyEl.classList.add("hidden");
  tableEl.classList.remove("hidden");
  tbody.innerHTML = trips
    .map((trip) => {
      const r = computeTripReimbursement(trip);
      const dateStr = new Date(trip.trip_date).toLocaleDateString("cs-CZ");
      return `
        <tr>
          <td data-label="Datum">${dateStr}</td>
          <td data-label="Účel">${trip.purpose}${trip.route ? ` <span style="color:#94a3b8">- ${trip.route}</span>` : ""}</td>
          <td data-label="Km">${Number(trip.distance_km).toLocaleString("cs-CZ")} km</td>
          <td data-label="Náhrada" class="amount pos">${formatKc(r.celkem)}</td>
          <td data-label=""><button type="button" class="list-row-delete" data-id="${trip.id}" aria-label="Smazat"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18" /></svg></button></td>
        </tr>`;
    })
    .join("");
  tbody.querySelectorAll(".list-row-delete").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const id = Number(btn.dataset.id);
      btn.disabled = true;
      try {
        await deleteVehicleTrip(id);
        trips = trips.filter((t) => t.id !== id);
        renderSummary();
        renderTable();
      } catch (err) {
        alert(`Nepodařilo se smazat jízdu (${err.message}).`);
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
    const trip = await insertVehicleTrip(userId, {
      tripDate: document.getElementById("f-date").value,
      purpose: document.getElementById("f-purpose").value.trim(),
      route: document.getElementById("f-route").value.trim(),
      distanceKm: Number(document.getElementById("f-km").value),
      consumptionL100km: document.getElementById("f-consumption").value ? Number(document.getElementById("f-consumption").value) : null,
      fuelType: fuelSelect.value || null,
      fuelPriceOverride: document.getElementById("f-price").value ? Number(document.getElementById("f-price").value) : null,
    });
    trips.unshift(trip);
    renderSummary();
    renderTable();
    form.reset();
    priceWrap.classList.add("hidden");
  } catch (err) {
    alert(`Nepodařilo se uložit jízdu (${err.message}).`);
  } finally {
    submitBtn.disabled = false;
    submitBtn.textContent = original;
  }
});

(async () => {
  const result = await requireOnboardedProfile();
  if (!result) return;
  userId = result.session.user.id;

  try {
    trips = await listVehicleTrips(userId);
  } catch (err) {
    console.error("Nepodařilo se načíst jízdy:", err.message);
    trips = [];
  }
  renderSummary();
  renderTable();

  loadingEl.classList.add("hidden");
  shellEl.classList.remove("hidden");
})();

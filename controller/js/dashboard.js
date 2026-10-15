import { api, applyStoredTheme, toggleTheme, formatRelativeTime } from "./api.js";
import { icon } from "./icons.js";

applyStoredTheme();

const STATUS_LABEL = {
  en_ligne: "En ligne",
  en_session: "En session",
  hors_ligne: "Hors ligne",
};
const STATUS_ICON = {
  en_ligne: "checkCircle",
  en_session: "monitorPlay",
  hors_ligne: "dotCircle",
};

const grid = document.getElementById("device-grid");
const emptyState = document.getElementById("empty-state");
const toast = document.getElementById("toast");

function showToast(message, isError = false) {
  toast.textContent = message;
  toast.className = "toast" + (isError ? " toast--error" : "");
  toast.hidden = false;
  clearTimeout(showToast._t);
  showToast._t = setTimeout(() => (toast.hidden = true), 4000);
}

function renderDevices(devices) {
  grid.innerHTML = "";
  emptyState.hidden = devices.length > 0;
  for (const d of devices) {
    const card = document.createElement("article");
    card.className = "card device-card";
    card.innerHTML = `
      <div class="device-card__head">
        <div>
          <div class="device-card__name">${escapeHtml(d.name)}</div>
          <div class="device-card__meta">Vu ${escapeHtml(formatRelativeTime(d.lastSeenAt))}</div>
        </div>
        <span class="status status--${d.status}">
          ${icon(STATUS_ICON[d.status])}
          ${STATUS_LABEL[d.status]}
        </span>
      </div>
      <div class="device-card__actions">
        <button class="btn btn-primary connect-btn" ${d.status === "hors_ligne" ? "disabled" : ""} data-id="${d.id}" style="flex:1">
          Se connecter
        </button>
        <button class="icon-btn rename-btn" data-id="${d.id}" data-name="${escapeHtml(d.name)}" aria-label="Renommer ${escapeHtml(d.name)}">${icon("pencil")}</button>
        <button class="icon-btn delete-btn" data-id="${d.id}" data-name="${escapeHtml(d.name)}" aria-label="Retirer ${escapeHtml(d.name)}">${icon("trash")}</button>
      </div>
    `;
    grid.appendChild(card);
  }
}

function escapeHtml(s) {
  return String(s || "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

async function refresh() {
  try {
    const { devices } = await api.devices();
    renderDevices(devices);
  } catch (err) {
    if (err.status === 401) window.location.href = "login.html";
  }
}

grid.addEventListener("click", async (e) => {
  const connectBtn = e.target.closest(".connect-btn");
  if (connectBtn) {
    window.location.href = `session.html?device=${encodeURIComponent(connectBtn.dataset.id)}`;
    return;
  }
  const renameBtn = e.target.closest(".rename-btn");
  if (renameBtn) {
    const name = prompt("Nouveau nom du poste :", renameBtn.dataset.name);
    if (name && name.trim()) {
      try {
        await api.renameDevice(renameBtn.dataset.id, name.trim());
        refresh();
      } catch {
        showToast("Impossible de renommer ce poste.", true);
      }
    }
    return;
  }
  const deleteBtn = e.target.closest(".delete-btn");
  if (deleteBtn) {
    if (confirm(`Retirer définitivement « ${deleteBtn.dataset.name} » ? L'agent devra être réenrôlé.`)) {
      try {
        await api.deleteDevice(deleteBtn.dataset.id);
        refresh();
      } catch {
        showToast("Impossible de retirer ce poste.", true);
      }
    }
  }
});

// --- Thème ---
document.getElementById("theme-toggle").innerHTML = icon("sun");
document.getElementById("theme-toggle").addEventListener("click", () => {
  const next = toggleTheme();
  document.getElementById("theme-toggle").innerHTML = icon(next === "dark" ? "sun" : "moon");
});
(function initThemeIcon() {
  const current = document.documentElement.getAttribute("data-theme") || "dark";
  document.getElementById("theme-toggle").innerHTML = icon(current === "dark" ? "sun" : "moon");
})();

// --- Déconnexion ---
document.getElementById("logout-btn").addEventListener("click", async () => {
  await api.logout();
  window.location.href = "login.html";
});

// --- Qui est connecté ---
api
  .me()
  .then((me) => (document.getElementById("whoami").textContent = me.username))
  .catch(() => (window.location.href = "login.html"));

// --- Modale d'ajout de poste ---
const modal = document.getElementById("enroll-modal");
const addBtn = document.getElementById("add-device-btn");
addBtn.innerHTML = `${icon("plus")} Ajouter un poste`;
addBtn.addEventListener("click", () => {
  document.getElementById("code-result").hidden = true;
  document.getElementById("device-name").value = "";
  modal.hidden = false;
});
document.getElementById("close-modal-btn").addEventListener("click", () => {
  modal.hidden = true;
  refresh();
});
document.getElementById("generate-code-btn").addEventListener("click", async () => {
  const name = document.getElementById("device-name").value.trim();
  try {
    const { code, expiresAt } = await api.createEnrollCode(name);
    document.getElementById("enroll-code-value").textContent = code;
    const minutes = Math.round((expiresAt - Date.now()) / 60000);
    document.getElementById("code-expiry").textContent = `Valable environ ${minutes} minutes, à usage unique.`;
    document.getElementById("code-result").hidden = false;
  } catch {
    showToast("Impossible de générer un code pour le moment.", true);
  }
});

refresh();
setInterval(refresh, 8000);

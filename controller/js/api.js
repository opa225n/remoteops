// Petite enveloppe autour de fetch() pour parler à l'API du serveur.
// Les cookies de session sont envoyés automatiquement (même origine).

async function request(method, url, body) {
  const res = await fetch(url, {
    method,
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  let data = null;
  try {
    data = await res.json();
  } catch {
    // réponse sans corps JSON (rare ici)
  }
  if (!res.ok) {
    const error = new Error((data && data.error) || `Erreur HTTP ${res.status}`);
    error.status = res.status;
    error.code = data && data.error;
    throw error;
  }
  return data;
}

export const api = {
  setupStatus: () => request("GET", "/api/setup-status"),
  setup: (username, password, setupToken) => request("POST", "/api/setup", { username, password, setupToken }),
  login: (username, password) => request("POST", "/api/login", { username, password }),
  logout: () => request("POST", "/api/logout"),
  me: () => request("GET", "/api/me"),
  devices: () => request("GET", "/api/devices"),
  renameDevice: (id, name) => request("POST", `/api/devices/${id}/rename`, { name }),
  deleteDevice: (id) => request("DELETE", `/api/devices/${id}`),
  createEnrollCode: (name) => request("POST", "/api/enroll-codes", { name }),
};

export function applyStoredTheme() {
  // Confort propre à ce navigateur uniquement ; aucune donnée partagée.
  try {
    const saved = localStorage.getItem("remoteops_theme");
    if (saved === "light" || saved === "dark") {
      document.documentElement.setAttribute("data-theme", saved);
    }
  } catch {
    // stockage indisponible (navigation privée, etc.) : on garde le thème par défaut
  }
}

export function toggleTheme() {
  const current = document.documentElement.getAttribute("data-theme") || "dark";
  const next = current === "dark" ? "light" : "dark";
  document.documentElement.setAttribute("data-theme", next);
  try {
    localStorage.setItem("remoteops_theme", next);
  } catch {
    /* ignoré */
  }
  return next;
}

export function formatRelativeTime(ts) {
  if (!ts) return "jamais";
  const diff = Date.now() - ts;
  const min = Math.round(diff / 60000);
  if (min < 1) return "à l'instant";
  if (min < 60) return `il y a ${min} min`;
  const h = Math.round(min / 60);
  if (h < 24) return `il y a ${h} h`;
  const j = Math.round(h / 24);
  return `il y a ${j} j`;
}

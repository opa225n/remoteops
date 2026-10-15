"use strict";

const path = require("path");
const http = require("http");
const express = require("express");

const store = require("./store");
const auth = require("./auth");
const { attachSignaling } = require("./signaling");

// Charge server/.env sans dépendance supplémentaire (format simple CLE=valeur).
(function loadDotEnv() {
  const fs = require("fs");
  const envPath = path.join(__dirname, "..", ".env");
  if (!fs.existsSync(envPath)) return;
  for (const line of fs.readFileSync(envPath, "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)\s*$/i);
    if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
})();

const PORT = Number(process.env.PORT || 3000);

if (!process.env.SESSION_SECRET) {
  console.error(
    "ERREUR : SESSION_SECRET n'est pas défini.\n" +
      "Copiez server/.env.example vers server/.env et renseignez une valeur aléatoire longue, par exemple :\n" +
      "  node -e \"console.log(require('crypto').randomBytes(32).toString('hex'))\""
  );
  process.exit(1);
}

const app = express();
app.use(express.json({ limit: "64kb" }));

// --- Limiteur de débit minimal (mémoire locale, process unique) ---
// Protège les routes sensibles (connexion, enrôlement) contre les essais
// répétés. Pour un déploiement multi-instance, remplacer par un limiteur
// partagé (ex. Redis).
function rateLimit({ windowMs, max }) {
  const hits = new Map();
  return (req, res, next) => {
    const key = req.ip;
    const now = Date.now();
    const entry = hits.get(key) || { count: 0, resetAt: now + windowMs };
    if (now > entry.resetAt) {
      entry.count = 0;
      entry.resetAt = now + windowMs;
    }
    entry.count += 1;
    hits.set(key, entry);
    if (entry.count > max) {
      return res.status(429).json({ error: "trop_de_tentatives" });
    }
    next();
  };
}
const loginLimiter = rateLimit({ windowMs: 60_000, max: 10 });
const enrollLimiter = rateLimit({ windowMs: 60_000, max: 20 });

// --- Authentification admin ---

app.get("/api/setup-status", (req, res) => {
  res.json({ needsSetup: store.countUsers() === 0 });
});

app.post("/api/setup", async (req, res) => {
  if (store.countUsers() > 0) {
    return res.status(409).json({ error: "deja_configure" });
  }
  const { username, password } = req.body || {};
  if (!username || !password || password.length < 10) {
    return res.status(400).json({ error: "identifiants_invalides", detail: "Mot de passe : 10 caractères minimum." });
  }
  const hash = await auth.hashPassword(password);
  const user = store.createUser(username, hash);
  auth.issueSessionCookie(res, user);
  res.json({ ok: true, username: user.username });
});

app.post("/api/login", loginLimiter, async (req, res) => {
  const { username, password } = req.body || {};
  const user = store.findUserByUsername(username || "");
  // Message volontairement identique en cas d'utilisateur ou de mot de passe
  // invalide, pour ne pas révéler quels comptes existent.
  const invalid = () => res.status(401).json({ error: "identifiants_invalides" });
  if (!user) return invalid();
  const ok = await auth.verifyPassword(password || "", user.passwordHash);
  if (!ok) return invalid();
  auth.issueSessionCookie(res, user);
  res.json({ ok: true, username: user.username });
});

app.post("/api/logout", (req, res) => {
  auth.clearSessionCookie(res);
  res.json({ ok: true });
});

app.get("/api/me", auth.requireAuth, (req, res) => {
  res.json({ username: req.user.username });
});

// --- Postes (après authentification admin) ---

app.get("/api/devices", auth.requireAuth, (req, res) => {
  const devices = store.listDevices().map((d) => ({ ...d, status: signaling.deviceStatus(d.id) }));
  res.json({ devices });
});

app.post("/api/devices/:id/rename", auth.requireAuth, (req, res) => {
  const { name } = req.body || {};
  if (!name || !name.trim()) return res.status(400).json({ error: "nom_requis" });
  const ok = store.renameDevice(req.params.id, name.trim().slice(0, 80));
  if (!ok) return res.status(404).json({ error: "poste_inconnu" });
  res.json({ ok: true });
});

app.delete("/api/devices/:id", auth.requireAuth, (req, res) => {
  const ok = store.deleteDevice(req.params.id);
  if (!ok) return res.status(404).json({ error: "poste_inconnu" });
  res.json({ ok: true });
});

// --- Codes d'enrôlement (pour installer un nouvel agent) ---

app.post("/api/enroll-codes", auth.requireAuth, (req, res) => {
  const { name } = req.body || {};
  const entry = store.createEnrollCode(name);
  res.json({ code: entry.code, expiresAt: entry.expiresAt });
});

app.get("/api/enroll-codes", auth.requireAuth, (req, res) => {
  store.pruneExpiredEnrollCodes();
  res.json({ codes: store.listActiveEnrollCodes() });
});

// Appelée par l'agent lui-même (pas encore authentifié : c'est justement
// le but du code d'enrôlement, à usage unique et de courte durée de vie).
app.post("/api/agent/register", enrollLimiter, (req, res) => {
  const { code, name } = req.body || {};
  if (!code) return res.status(400).json({ error: "code_requis" });
  const result = store.createDeviceFromEnrollCode(String(code).toUpperCase().trim(), name);
  if (result.error) return res.status(400).json({ error: result.error });
  res.json({ deviceId: result.device.id, token: result.device.token, name: result.device.name });
});

// --- Tableau de bord statique (interface servie au navigateur) ---
app.use(express.static(path.join(__dirname, "..", "..", "controller")));

const server = http.createServer(app);
const signaling = attachSignaling(server);

server.listen(PORT, () => {
  console.log(`RemoteOps : serveur prêt sur http://localhost:${PORT}`);
  if (store.countUsers() === 0) {
    console.log("Aucun compte admin : ouvrez le tableau de bord pour créer le premier compte.");
  }
});

"use strict";

// Entrepôt de données très simple, soutenu par un fichier JSON.
// Convient à un usage interne avec un parc modeste de postes.
// Pour un usage plus grand (nombreux admins concurrents, haute dispo),
// remplacer par une vraie base (Postgres/SQLite) derrière la même interface.

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const DATA_DIR = path.join(__dirname, "..", "data");
const DB_PATH = path.join(DATA_DIR, "db.json");

function emptyDb() {
  return { users: [], devices: [], enrollCodes: [] };
}

function load() {
  if (!fs.existsSync(DB_PATH)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    const db = emptyDb();
    save(db);
    return db;
  }
  try {
    return JSON.parse(fs.readFileSync(DB_PATH, "utf8"));
  } catch (err) {
    throw new Error(
      `Impossible de lire ${DB_PATH} (${err.message}). ` +
        "Le fichier est peut-être corrompu : restaurez une sauvegarde ou supprimez-le pour repartir à vide."
    );
  }
}

let writeQueue = Promise.resolve();
function save(db) {
  // Écriture atomique (fichier temporaire puis renommage) pour éviter
  // de corrompre db.json si le processus est interrompu en cours d'écriture.
  writeQueue = writeQueue.then(() => {
    const tmp = DB_PATH + ".tmp";
    // mode 0o600 : ce fichier contient les jetons d'agent (équivalents à un
    // accès de maintenance à distance permanent) et les empreintes de mot
    // de passe — lisible/écrivable par le seul compte qui fait tourner le
    // serveur. Sans effet réel sous Windows (le mode POSIX n'y est pas
    // appliqué de la même façon) : protégez alors le dossier par les ACL
    // habituelles de l'OS.
    fs.writeFileSync(tmp, JSON.stringify(db, null, 2), { mode: 0o600 });
    fs.renameSync(tmp, DB_PATH);
  });
  return writeQueue;
}

let db = load();

function genId(prefix) {
  return `${prefix}_${crypto.randomBytes(12).toString("hex")}`;
}

function genToken() {
  return crypto.randomBytes(32).toString("base64url");
}

// Code d'enrôlement : court et facile à retaper, mais tiré d'un espace
// assez grand (36^8) pour qu'une recherche par essais successifs sur sa
// courte durée de vie (voir ENROLL_CODE_TTL_MS) ne soit pas praticable.
function genEnrollCode() {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // sans caractères ambigus
  let code = "";
  for (let i = 0; i < 8; i++) {
    code += alphabet[crypto.randomInt(alphabet.length)];
  }
  return code;
}

const ENROLL_CODE_TTL_MS = 15 * 60 * 1000;

module.exports = {
  // -- Utilisateurs (comptes admin du tableau de bord) --
  findUserByUsername(username) {
    return db.users.find((u) => u.username === username) || null;
  },
  createUser(username, passwordHash) {
    const user = { id: genId("usr"), username, passwordHash, createdAt: Date.now() };
    db.users.push(user);
    save(db);
    return user;
  },
  countUsers() {
    return db.users.length;
  },

  // -- Postes (agents enrôlés) --
  listDevices() {
    return db.devices.map(({ token, ...rest }) => rest); // ne jamais exposer le jeton
  },
  getDevice(id) {
    return db.devices.find((d) => d.id === id) || null;
  },
  getDeviceByToken(id, token) {
    const d = db.devices.find((d) => d.id === id);
    return d && d.token === token ? d : null;
  },
  createDeviceFromEnrollCode(code, declaredName) {
    const entry = db.enrollCodes.find((c) => c.code === code);
    if (!entry) return { error: "code_inconnu" };
    if (entry.used) return { error: "code_deja_utilise" };
    if (Date.now() > entry.expiresAt) return { error: "code_expire" };
    entry.used = true;
    // Le nom déclaré vient de l'agent, pas encore authentifié à ce stade :
    // on le traite comme toute entrée non fiable (type, longueur bornée),
    // même si la seule chose qu'il pourrait abîmer est l'affichage.
    const safeName = typeof declaredName === "string" ? declaredName.trim().slice(0, 80) : "";
    const device = {
      id: genId("dev"),
      name: safeName || entry.nameHint || "Poste sans nom",
      token: genToken(),
      createdAt: Date.now(),
      lastSeenAt: null,
    };
    db.devices.push(device);
    save(db);
    return { device };
  },
  touchDeviceLastSeen(id) {
    const d = db.devices.find((d) => d.id === id);
    if (d) {
      d.lastSeenAt = Date.now();
      save(db);
    }
  },
  renameDevice(id, name) {
    const d = db.devices.find((d) => d.id === id);
    if (!d) return false;
    d.name = name;
    save(db);
    return true;
  },
  deleteDevice(id) {
    const before = db.devices.length;
    db.devices = db.devices.filter((d) => d.id !== id);
    save(db);
    return db.devices.length < before;
  },

  // -- Codes d'enrôlement (pour installer un nouvel agent) --
  createEnrollCode(nameHint) {
    const entry = {
      code: genEnrollCode(),
      nameHint: nameHint || "",
      createdAt: Date.now(),
      expiresAt: Date.now() + ENROLL_CODE_TTL_MS,
      used: false,
    };
    db.enrollCodes.push(entry);
    save(db);
    return entry;
  },
  listActiveEnrollCodes() {
    const now = Date.now();
    return db.enrollCodes.filter((c) => !c.used && c.expiresAt > now);
  },
  pruneExpiredEnrollCodes() {
    const now = Date.now();
    const before = db.enrollCodes.length;
    db.enrollCodes = db.enrollCodes.filter((c) => !c.used && c.expiresAt > now);
    if (db.enrollCodes.length !== before) save(db);
  },

  ENROLL_CODE_TTL_MS,
};

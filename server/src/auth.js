"use strict";

// Authentification des administrateurs du tableau de bord : cookie de
// session signé (HMAC), sans état côté serveur. Convient à un usage
// interne mono-instance ; pour plusieurs instances derrière un répartiteur
// de charge, remplacer par une session partagée (ex. Redis) ou des JWT.

const crypto = require("crypto");
const bcrypt = require("bcryptjs");
const cookie = require("cookie");

const COOKIE_NAME = "remoteops_session";
const SESSION_TTL_MS = 12 * 60 * 60 * 1000; // 12 h

function getSecret() {
  const secret = process.env.SESSION_SECRET;
  if (!secret || secret.length < 16) {
    throw new Error(
      "SESSION_SECRET manquant ou trop court (>=16 caractères). " +
        "Définissez-le dans server/.env avant de démarrer le serveur."
    );
  }
  return secret;
}

function sign(payload) {
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const sig = crypto.createHmac("sha256", getSecret()).update(body).digest("base64url");
  return `${body}.${sig}`;
}

function verify(token) {
  if (!token || typeof token !== "string" || !token.includes(".")) return null;
  const [body, sig] = token.split(".");
  const expected = crypto.createHmac("sha256", getSecret()).update(body).digest("base64url");
  // Comparaison en temps constant pour éviter une fuite d'information par le délai de réponse.
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try {
    const payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
    if (!payload.exp || Date.now() > payload.exp) return null;
    return payload;
  } catch {
    return null;
  }
}

function issueSessionCookie(res, user) {
  const token = sign({ sub: user.id, username: user.username, exp: Date.now() + SESSION_TTL_MS });
  res.cookie(COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: "strict",
    secure: process.env.NODE_ENV === "production",
    maxAge: SESSION_TTL_MS,
  });
}

function clearSessionCookie(res) {
  res.clearCookie(COOKIE_NAME);
}

function readSession(req) {
  // Fonctionne aussi bien pour une requête Express (route HTTP) que pour
  // la requête HTTP brute reçue lors d'une mise à niveau WebSocket :
  // les deux exposent `req.headers.cookie`, donc on l'analyse nous-mêmes
  // plutôt que de dépendre d'un middleware qui n'a pas pu s'exécuter.
  const header = req.headers && req.headers.cookie;
  if (!header) return null;
  const parsed = cookie.parse(header);
  return verify(parsed[COOKIE_NAME]);
}

function requireAuth(req, res, next) {
  const session = readSession(req);
  if (!session) return res.status(401).json({ error: "non_authentifie" });
  req.user = { id: session.sub, username: session.username };
  next();
}

async function hashPassword(plain) {
  return bcrypt.hash(plain, 12);
}

async function verifyPassword(plain, hash) {
  return bcrypt.compare(plain, hash);
}

module.exports = {
  COOKIE_NAME,
  issueSessionCookie,
  clearSessionCookie,
  readSession,
  requireAuth,
  hashPassword,
  verifyPassword,
};

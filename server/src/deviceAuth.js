"use strict";

// Vérification du jeton d'un poste (agent) lors de sa connexion WebSocket.
// Isolé dans son propre fichier pour éviter une dépendance circulaire
// entre signaling.js et store.js.

const store = require("./store");

function verifyAgentToken(deviceId, token) {
  if (!deviceId || !token) return null;
  return store.getDeviceByToken(deviceId, token);
}

module.exports = { verifyAgentToken };

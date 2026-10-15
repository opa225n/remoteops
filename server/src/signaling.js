"use strict";

// Relais de signalisation WebRTC entre les postes (agents) et le
// tableau de bord (contrôleurs). Le serveur ne voit jamais le flux
// vidéo ni les événements clavier/souris une fois la connexion WebRTC
// établie : il ne fait que transmettre les messages SDP/ICE nécessaires
// à la négociation, puis la liaison devient directe (ou via un serveur
// TURN auto-hébergé si vous en ajoutez un — voir README).

const crypto = require("crypto");
const { WebSocketServer } = require("ws");
const store = require("./store");
const { verifyAgentToken } = require("./deviceAuth");
const { readSession } = require("./auth");

function genSessionId() {
  return `sess_${crypto.randomBytes(9).toString("hex")}`;
}

function attachSignaling(httpServer) {
  const wssAgents = new WebSocketServer({ noServer: true });
  const wssControllers = new WebSocketServer({ noServer: true });

  /** deviceId -> { ws } */
  const onlineAgents = new Map();
  /** sessionId -> { deviceId, agentWs, controllerWs, controllerUser } */
  const sessions = new Map();
  /** deviceId -> sessionId en cours (au plus une session active par poste) */
  const deviceActiveSession = new Map();

  function deviceStatus(deviceId) {
    if (deviceActiveSession.has(deviceId)) return "en_session";
    if (onlineAgents.has(deviceId)) return "en_ligne";
    return "hors_ligne";
  }

  function endSession(sessionId, reason) {
    const session = sessions.get(sessionId);
    if (!session) return;
    sessions.delete(sessionId);
    deviceActiveSession.delete(session.deviceId);
    const msg = JSON.stringify({ type: "session-ended", sessionId, reason });
    if (session.agentWs && session.agentWs.readyState === 1) session.agentWs.send(msg);
    if (session.controllerWs && session.controllerWs.readyState === 1) session.controllerWs.send(msg);
  }

  // --- Canal des agents (postes distants) ---
  // L'identifiant et le jeton de l'agent ne sont PAS passés dans l'URL de
  // connexion (une URL de requête HTTP/WebSocket finit couramment dans les
  // journaux d'accès d'un reverse proxy en clair) : la connexion est
  // acceptée sans condition, puis l'agent doit s'authentifier par son
  // premier message ({type:"auth", deviceId, token}). Un délai court
  // referme toute connexion qui ne s'authentifie pas, pour éviter qu'on
  // puisse ouvrir un grand nombre de sockets inactives.
  const AUTH_TIMEOUT_MS = 5000;

  wssAgents.on("connection", (ws) => {
    let device = null;
    let heartbeat = null;

    const authTimer = setTimeout(() => {
      if (!device) ws.close(4001, "authentification manquante");
    }, AUTH_TIMEOUT_MS);

    ws.on("message", (raw) => {
      let msg;
      try {
        msg = JSON.parse(raw.toString());
      } catch {
        return;
      }

      if (!device) {
        if (msg.type !== "auth") return; // tout le reste est ignoré tant que non authentifié
        const authenticated = verifyAgentToken(msg.deviceId, msg.token);
        if (!authenticated) {
          ws.close(4001, "jeton invalide");
          return;
        }
        device = authenticated;
        clearTimeout(authTimer);
        onlineAgents.set(device.id, { ws });
        store.touchDeviceLastSeen(device.id);
        ws.send(JSON.stringify({ type: "auth-ok" }));
        heartbeat = setInterval(() => {
          if (ws.readyState === 1) ws.send(JSON.stringify({ type: "ping" }));
        }, 25000);
        return;
      }

      if (msg.type === "pong") return;
      if (!msg.sessionId) return;
      const session = sessions.get(msg.sessionId);
      if (!session || session.deviceId !== device.id) return;

      if (msg.type === "offer" || msg.type === "ice") {
        if (session.controllerWs && session.controllerWs.readyState === 1) {
          session.controllerWs.send(JSON.stringify(msg));
        }
      } else if (msg.type === "end-session") {
        endSession(msg.sessionId, "poste");
      }
    });

    ws.on("close", () => {
      clearTimeout(authTimer);
      clearInterval(heartbeat);
      if (!device) return;
      onlineAgents.delete(device.id);
      const sessionId = deviceActiveSession.get(device.id);
      if (sessionId) endSession(sessionId, "poste_deconnecte");
    });
  });

  // --- Canal des contrôleurs (le tableau de bord, côté admin) ---
  wssControllers.on("connection", (ws, req, user) => {
    ws.on("message", (raw) => {
      let msg;
      try {
        msg = JSON.parse(raw.toString());
      } catch {
        return;
      }

      if (msg.type === "start-session") {
        const device = store.getDevice(msg.deviceId);
        if (!device) return ws.send(JSON.stringify({ type: "error", message: "poste_inconnu" }));
        const agent = onlineAgents.get(msg.deviceId);
        if (!agent) return ws.send(JSON.stringify({ type: "error", message: "poste_hors_ligne" }));
        if (deviceActiveSession.has(msg.deviceId)) {
          return ws.send(JSON.stringify({ type: "error", message: "poste_deja_en_session" }));
        }
        const sessionId = genSessionId();
        sessions.set(sessionId, { deviceId: msg.deviceId, agentWs: agent.ws, controllerWs: ws, controllerUser: user });
        deviceActiveSession.set(msg.deviceId, sessionId);
        ws.send(JSON.stringify({ type: "session-created", sessionId, deviceId: msg.deviceId }));
        agent.ws.send(JSON.stringify({ type: "incoming-session", sessionId }));
        return;
      }

      if (!msg.sessionId) return;
      const session = sessions.get(msg.sessionId);
      if (!session || session.controllerWs !== ws) return;

      if (msg.type === "answer" || msg.type === "ice") {
        if (session.agentWs.readyState === 1) session.agentWs.send(JSON.stringify(msg));
      } else if (msg.type === "end-session") {
        endSession(msg.sessionId, "controleur");
      }
    });

    ws.on("close", () => {
      for (const [sessionId, session] of sessions) {
        if (session.controllerWs === ws) endSession(sessionId, "controleur_deconnecte");
      }
    });
  });

  // --- Routage des requêtes de mise à niveau HTTP -> WebSocket ---
  httpServer.on("upgrade", (req, socket, head) => {
    const url = new URL(req.url, "http://localhost");

    if (url.pathname === "/ws/agent") {
      // Pas de vérification ici : l'identité de l'agent n'est plus portée
      // par l'URL (voir le commentaire sur AUTH_TIMEOUT_MS plus haut) mais
      // par son premier message, une fois la connexion acceptée.
      wssAgents.handleUpgrade(req, socket, head, (ws) => wssAgents.emit("connection", ws, req));
      return;
    }

    if (url.pathname === "/ws/controller") {
      const session = readSession(req);
      if (!session) {
        socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
        socket.destroy();
        return;
      }
      wssControllers.handleUpgrade(req, socket, head, (ws) => wssControllers.emit("connection", ws, req, session));
      return;
    }

    socket.destroy();
  });

  return { deviceStatus, onlineAgents };
}

module.exports = { attachSignaling };

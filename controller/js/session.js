import { api, applyStoredTheme } from "./api.js";
import { icon } from "./icons.js";

applyStoredTheme();
document.getElementById("back-link").innerHTML = icon("arrowLeft");

const deviceId = new URLSearchParams(window.location.search).get("device");
const video = document.getElementById("remote-video");
const placeholder = document.getElementById("placeholder");
const placeholderText = document.getElementById("placeholder-text");
const statusEl = document.getElementById("conn-status");
const viewport = document.getElementById("viewport");
const toast = document.getElementById("toast");

function showToast(message, isError = false) {
  toast.textContent = message;
  toast.className = "toast" + (isError ? " toast--error" : "");
  toast.hidden = false;
  setTimeout(() => (toast.hidden = true), 4500);
}

function setStatus(kind, label) {
  statusEl.className = `status status--${kind}`;
  statusEl.innerHTML = `${icon(kind === "en_ligne" || kind === "en_session" ? "checkCircle" : "warning")} ${label}`;
}

if (!deviceId) {
  placeholderText.textContent = "Aucun poste indiqué. Retournez au tableau de bord.";
  throw new Error("device manquant dans l'URL");
}

// Pas de route dédiée pour un seul poste dans cette première version :
// on réutilise la liste complète (acceptable pour un parc de taille modeste).
api
  .devices()
  .then(({ devices }) => {
    const device = devices.find((d) => d.id === deviceId);
    document.getElementById("device-name").textContent = device ? device.name : "Poste inconnu";
  })
  .catch(() => {
    window.location.href = "login.html";
  });

// --- Connexion de signalisation + WebRTC ---

const wsProtocol = window.location.protocol === "https:" ? "wss" : "ws";
const ws = new WebSocket(`${wsProtocol}://${window.location.host}/ws/controller`);

let pc = null;
let sessionId = null;
let inputChannel = null;

// STUN public par défaut : suffisant pour essayer rapidement. Pour un usage
// interne régulier, remplacez par votre propre serveur STUN/TURN (voir
// README du projet) afin de ne pas dépendre d'un service tiers et de
// couvrir les réseaux à pare-feu strict.
const ICE_SERVERS = [{ urls: "stun:stun.l.google.com:19302" }];

ws.addEventListener("open", () => {
  setStatus("hors_ligne", "Connexion au serveur…");
  ws.send(JSON.stringify({ type: "start-session", deviceId }));
});

ws.addEventListener("close", () => {
  if (sessionId) endSession("connexion perdue avec le serveur");
});

ws.addEventListener("message", async (event) => {
  const msg = JSON.parse(event.data);

  if (msg.type === "error") {
    const messages = {
      poste_inconnu: "Ce poste n'existe plus.",
      poste_hors_ligne: "Ce poste est hors ligne.",
      poste_deja_en_session: "Ce poste est déjà en session avec un autre administrateur.",
    };
    placeholderText.textContent = messages[msg.message] || "Impossible de démarrer la session.";
    setStatus("hors_ligne", "Échec");
    return;
  }

  if (msg.type === "session-created") {
    sessionId = msg.sessionId;
    setStatus("en_ligne", "En attente du poste…");
    setupPeerConnection();
    return;
  }

  if (msg.type === "offer" && pc) {
    await pc.setRemoteDescription({ type: "offer", sdp: msg.sdp });
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);
    ws.send(JSON.stringify({ type: "answer", sessionId, sdp: answer.sdp }));
    return;
  }

  if (msg.type === "ice" && pc && msg.candidate) {
    try {
      await pc.addIceCandidate(msg.candidate);
    } catch {
      /* candidat tardif ou déjà obsolète : sans conséquence */
    }
    return;
  }

  if (msg.type === "session-ended") {
    endSession(msg.reason === "poste_deconnecte" ? "le poste s'est déconnecté" : "session terminée");
  }
});

function setupPeerConnection() {
  pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });

  pc.ontrack = (event) => {
    video.srcObject = event.streams[0];
    video.hidden = false;
    placeholder.hidden = true;
    setStatus("en_session", "En session");
  };

  pc.ondatachannel = (event) => {
    if (event.channel.label === "input") {
      inputChannel = event.channel;
    }
  };

  pc.onicecandidate = (event) => {
    if (event.candidate) {
      ws.send(JSON.stringify({ type: "ice", sessionId, candidate: event.candidate }));
    }
  };

  pc.onconnectionstatechange = () => {
    if (pc && (pc.connectionState === "failed" || pc.connectionState === "disconnected")) {
      showToast("La connexion au poste a été interrompue.", true);
    }
  };
}

function endSession(reason) {
  showToast(`Session terminée (${reason}).`);
  setStatus("hors_ligne", "Terminée");
  if (sessionId && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ type: "end-session", sessionId }));
  }
  sessionId = null;
  if (pc) {
    pc.close();
    pc = null;
  }
  inputChannel = null;
  video.hidden = true;
  placeholder.hidden = false;
  placeholderText.textContent = "Session terminée.";
}

document.getElementById("end-btn").addEventListener("click", () => {
  endSession("demandé par l'administrateur");
  setTimeout(() => (window.location.href = "dashboard.html"), 600);
});

window.addEventListener("beforeunload", () => {
  if (sessionId && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ type: "end-session", sessionId }));
  }
});

// --- Entrées clavier/souris : capturées sur le cadre vidéo, envoyées
//     telles quelles via le canal de données (coordonnées normalisées
//     0..1, l'agent les remet à l'échelle de l'écran réel). ---

function sendInput(payload) {
  if (inputChannel && inputChannel.readyState === "open") {
    inputChannel.send(JSON.stringify(payload));
  }
}

function relativeCoords(evt) {
  const rect = video.getBoundingClientRect();
  const x = (evt.clientX - rect.left) / rect.width;
  const y = (evt.clientY - rect.top) / rect.height;
  return { x: Math.min(Math.max(x, 0), 1), y: Math.min(Math.max(y, 0), 1) };
}

viewport.addEventListener("mousemove", (e) => {
  if (video.hidden) return;
  sendInput({ type: "mousemove", ...relativeCoords(e) });
});
viewport.addEventListener("mousedown", (e) => {
  if (video.hidden) return;
  viewport.focus();
  sendInput({ type: "mousedown", button: e.button, ...relativeCoords(e) });
});
viewport.addEventListener("mouseup", (e) => {
  if (video.hidden) return;
  sendInput({ type: "mouseup", button: e.button, ...relativeCoords(e) });
});
viewport.addEventListener(
  "wheel",
  (e) => {
    if (video.hidden) return;
    e.preventDefault();
    sendInput({ type: "wheel", deltaY: e.deltaY, deltaX: e.deltaX });
  },
  { passive: false }
);
viewport.addEventListener("contextmenu", (e) => e.preventDefault());

viewport.addEventListener("keydown", (e) => {
  if (video.hidden) return;
  e.preventDefault();
  sendInput({ type: "keydown", key: e.key, code: e.code });
});
viewport.addEventListener("keyup", (e) => {
  if (video.hidden) return;
  e.preventDefault();
  sendInput({ type: "keyup", key: e.key, code: e.code });
});
viewport.addEventListener("focus", () => (document.getElementById("input-hint").textContent = "Clavier/souris actifs"));
viewport.addEventListener("blur", () => (document.getElementById("input-hint").textContent = "Cliquez sur l'écran pour activer clavier/souris"));

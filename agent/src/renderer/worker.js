// Logique de la fenêtre de l'agent : enrôlement, connexion de
// signalisation, capture d'écran et session WebRTC. Tourne dans un
// contexte isolé (pas d'accès à Node) : tout ce qui touche au système
// (fichiers, injection d'entrées, liste des écrans) passe par
// `window.remoteops`, exposé par preload.cjs.

const enrollSection = document.getElementById("enroll-section");
const statusSection = document.getElementById("status-section");
const statusDot = document.getElementById("status-dot");
const statusText = document.getElementById("status-text");
const deviceLabel = document.getElementById("device-label");
const logEl = document.getElementById("log");

function log(line) {
  const ts = new Date().toLocaleTimeString("fr-FR");
  logEl.textContent += `[${ts}] ${line}\n`;
  logEl.scrollTop = logEl.scrollHeight;
}

function setStatus(kind, text) {
  statusDot.className = `dot ${kind}`;
  statusText.textContent = text;
  window.remoteops.setTrayStatus(text);
}

const ICE_SERVERS = [{ urls: "stun:stun.l.google.com:19302" }];
const RECONNECT_DELAY_MS = 5000;

let ws = null;
let pc = null;
let dataChannel = null;
let localStream = null;

async function main() {
  const config = await window.remoteops.getConfig();
  if (!config) {
    enrollSection.hidden = false;
    wireEnrollForm();
  } else {
    statusSection.hidden = false;
    deviceLabel.textContent = config.name || config.deviceId;
    connectSignaling(config);
  }
}

function wireEnrollForm() {
  const btn = document.getElementById("enroll-btn");
  const errorEl = document.getElementById("enroll-error");
  btn.addEventListener("click", async () => {
    errorEl.textContent = "";
    const serverUrl = document.getElementById("server-url").value.trim().replace(/\/$/, "");
    const code = document.getElementById("enroll-code").value.trim().toUpperCase();
    const name = document.getElementById("device-name").value.trim();
    if (!serverUrl || !code) {
      errorEl.textContent = "Adresse du serveur et code requis.";
      return;
    }
    btn.disabled = true;
    try {
      const res = await fetch(`${serverUrl}/api/agent/register`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code, name }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "echec");
      const config = { serverUrl, deviceId: data.deviceId, token: data.token, name: data.name };
      await window.remoteops.saveConfig(config);
      enrollSection.hidden = true;
      statusSection.hidden = false;
      deviceLabel.textContent = config.name;
      connectSignaling(config);
    } catch (err) {
      const messages = {
        code_inconnu: "Code inconnu.",
        code_deja_utilise: "Ce code a déjà été utilisé.",
        code_expire: "Ce code a expiré : demandez-en un nouveau à l'administrateur.",
      };
      errorEl.textContent = messages[err.message] || "Impossible de joindre le serveur. Vérifiez l'adresse.";
      btn.disabled = false;
    }
  });
}

function connectSignaling(config) {
  // Le jeton n'est pas mis dans l'URL de connexion (il finirait en clair
  // dans les journaux d'accès d'un éventuel reverse proxy) : il est
  // envoyé comme premier message, une fois la connexion établie.
  const wsUrl = `${config.serverUrl.replace(/^http/, "ws")}/ws/agent`;
  setStatus("", "Connexion au serveur…");
  ws = new WebSocket(wsUrl);

  ws.addEventListener("open", () => {
    log("Connecté, authentification…");
    ws.send(JSON.stringify({ type: "auth", deviceId: config.deviceId, token: config.token }));
  });

  ws.addEventListener("close", () => {
    setStatus("", "Hors ligne — nouvelle tentative…");
    cleanupSession();
    setTimeout(() => connectSignaling(config), RECONNECT_DELAY_MS);
  });

  ws.addEventListener("error", () => log("Erreur de connexion au serveur."));

  ws.addEventListener("message", async (event) => {
    const msg = JSON.parse(event.data);

    if (msg.type === "ping") {
      ws.send(JSON.stringify({ type: "pong" }));
      return;
    }
    if (msg.type === "auth-ok") {
      setStatus("online", "En ligne");
      log("Authentifié auprès du serveur.");
      return;
    }
    if (msg.type === "incoming-session") {
      log(`Demande de session reçue (${msg.sessionId}).`);
      await startSession(msg.sessionId);
      return;
    }
    if (msg.type === "answer" && pc) {
      await pc.setRemoteDescription({ type: "answer", sdp: msg.sdp });
      return;
    }
    if (msg.type === "ice" && pc && msg.candidate) {
      try {
        await pc.addIceCandidate(msg.candidate);
      } catch {
        /* candidat tardif : sans conséquence */
      }
      return;
    }
    if (msg.type === "session-ended") {
      log(`Session terminée (${msg.reason || "raison inconnue"}).`);
      cleanupSession();
      setStatus("online", "En ligne");
    }
  });

  function startSession(sessionId) {
    return doStartSession(sessionId, config);
  }
}

async function doStartSession(sessionId, config) {
  setStatus("session", "Session en cours");
  const { sourceId, screenWidth, screenHeight } = await window.remoteops.getScreenSource();

  localStream = await navigator.mediaDevices.getUserMedia({
    audio: false,
    video: {
      mandatory: {
        chromeMediaSource: "desktop",
        chromeMediaSourceId: sourceId,
        maxWidth: screenWidth,
        maxHeight: screenHeight,
        maxFrameRate: 20,
      },
    },
  });

  pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
  localStream.getVideoTracks().forEach((track) => pc.addTrack(track, localStream));

  dataChannel = pc.createDataChannel("input");
  dataChannel.onmessage = (event) => {
    try {
      window.remoteops.sendInput(JSON.parse(event.data));
    } catch {
      /* message malformé : ignoré */
    }
  };
  dataChannel.onclose = () => window.remoteops.releaseAllInputs();

  pc.onicecandidate = (event) => {
    if (event.candidate) {
      ws.send(JSON.stringify({ type: "ice", sessionId, candidate: event.candidate }));
    }
  };

  const offer = await pc.createOffer();
  await pc.setLocalDescription(offer);
  ws.send(JSON.stringify({ type: "offer", sessionId, sdp: offer.sdp }));
  log("Offre WebRTC envoyée, en attente de la réponse du contrôleur.");
}

function cleanupSession() {
  window.remoteops.releaseAllInputs();
  if (dataChannel) {
    dataChannel.close();
    dataChannel = null;
  }
  if (pc) {
    pc.close();
    pc = null;
  }
  if (localStream) {
    localStream.getTracks().forEach((t) => t.stop());
    localStream = null;
  }
}

main();

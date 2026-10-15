// Processus principal Electron de l'agent RemoteOps.
// Rôles : fenêtre de statut + icône système, persistance locale de la
// configuration d'enrôlement, accès à desktopCapturer, et injection des
// événements clavier/souris reçus (via nut-js) — tout le travail
// réseau/WebRTC se fait côté fenêtre (voir src/renderer/worker.js),
// dans un contexte isolé (contextIsolation) qui ne touche jamais Node
// directement : il passe par le pont défini dans preload.js.
"use strict";

import { app, BrowserWindow, Tray, Menu, ipcMain, desktopCapturer, screen } from "electron";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { mouse, keyboard, Button } from "@nut-tree-fork/nut-js";
import { CODE_TO_NUT_KEY } from "./keymap.js";
import { createDotIcon } from "./trayIcon.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CONFIG_PATH = path.join(app.getPath("userData"), "device-config.json");

let mainWindow = null;
let tray = null;
let bannerWindow = null;

function readConfig() {
  try {
    return JSON.parse(fs.readFileSync(CONFIG_PATH, "utf8"));
  } catch {
    return null;
  }
}

function writeConfig(config) {
  fs.mkdirSync(path.dirname(CONFIG_PATH), { recursive: true });
  // mode 0o600 : ce fichier contient le jeton permanent du poste (qui
  // permet à quiconque le possède de se faire passer pour cet agent
  // auprès du serveur) — à réserver au compte local qui fait tourner
  // l'agent. Sans effet réel sous Windows.
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2), { mode: 0o600 });
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 380,
    height: 480,
    resizable: false,
    title: "RemoteOps — Agent",
    webPreferences: {
      // .cjs explicite : le reste du paquet est en ESM ("type":"module"
      // dans package.json), mais un script preload reste chargé comme
      // CommonJS classique.
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      // Autorisé uniquement parce que cette fenêtre charge exclusivement
      // notre propre page locale (jamais de contenu distant/non fiable) :
      // nécessaire pour que getUserMedia({chromeMediaSource:'desktop'})
      // fonctionne sans boîte de dialogue de partage d'écran classique.
      sandbox: false,
    },
  });
  mainWindow.setMenuBarVisibility(false);
  mainWindow.loadFile(path.join(__dirname, "renderer", "worker.html"));

  mainWindow.on("close", (e) => {
    // Minimise dans la zone de notification plutôt que de fermer :
    // l'agent doit continuer à tourner en arrière-plan.
    if (!app.isQuitting) {
      e.preventDefault();
      mainWindow.hide();
    }
  });
}

function createTray() {
  // Rond plein généré en mémoire : garantit une icône non vide (et donc
  // retrouvable/cliquable) sans dépendre d'un fichier image fourni à part.
  // Une illustration dédiée reste préférable avant diffusion (voir README).
  const icon = createDotIcon(32, "#22c55e");
  tray = new Tray(icon);
  tray.setToolTip("RemoteOps — Agent de maintenance à distance");
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: "Afficher la fenêtre de statut", click: () => mainWindow && mainWindow.show() },
      { type: "separator" },
      {
        label: "Quitter",
        click: () => {
          app.isQuitting = true;
          app.quit();
        },
      },
    ])
  );
  tray.on("click", () => mainWindow && mainWindow.show());
}

// --- Bandeau de session : seule garantie, visible à l'écran, qu'un
// contrôle à distance est en cours, même si la fenêtre de statut est
// réduite dans la zone de notification. N'est pas fermable par la
// personne devant le poste (sans barre de titre ni bouton) : il
// disparaît uniquement quand la session se termine réellement, ce qui
// est le but recherché (transparence, pas un contrôle qu'on peut
// masquer soi-même pendant qu'elle a lieu). ---

function createSessionBanner(deviceLabel) {
  if (bannerWindow) return;
  const { width } = screen.getPrimaryDisplay().workAreaSize;
  bannerWindow = new BrowserWindow({
    width,
    height: 34,
    x: 0,
    y: 0,
    frame: false,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    closable: false,
    alwaysOnTop: true,
    focusable: false,
    skipTaskbar: true,
    webPreferences: { contextIsolation: true, nodeIntegration: false },
  });
  // "screen-saver" : reste visible même par-dessus une application en
  // plein écran, où un bandeau "normal" passerait sous la fenêtre active.
  bannerWindow.setAlwaysOnTop(true, "screen-saver");
  bannerWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  bannerWindow.loadFile(path.join(__dirname, "renderer", "banner.html"), {
    query: deviceLabel ? { device: deviceLabel } : {},
  });
  bannerWindow.on("closed", () => {
    bannerWindow = null;
  });
}

function destroySessionBanner() {
  if (bannerWindow) {
    bannerWindow.destroy();
    bannerWindow = null;
  }
}

app.whenReady().then(() => {
  createWindow();
  createTray();
});

app.on("window-all-closed", () => {
  // Ne quitte jamais tout seul : c'est le menu "Quitter" de l'icône
  // système qui décide (agent conçu pour tourner en arrière-plan).
});

app.on("before-quit", destroySessionBanner);

// --- Pont IPC exposé au renderer (worker.js) via preload.js ---

ipcMain.handle("config:get", () => readConfig());
ipcMain.handle("config:save", (event, config) => {
  writeConfig(config);
  return true;
});

ipcMain.handle("screen:get-source", async () => {
  const sources = await desktopCapturer.getSources({ types: ["screen"], thumbnailSize: { width: 0, height: 0 } });
  if (!sources.length) throw new Error("aucun écran détecté");
  const primary = screen.getPrimaryDisplay();
  return {
    sourceId: sources[0].id,
    screenWidth: primary.size.width,
    screenHeight: primary.size.height,
  };
});

ipcMain.on("tray:set-status", (event, label) => {
  if (tray) tray.setToolTip(`RemoteOps — ${label}`);
});

ipcMain.on("session:started", (event, deviceLabel) => {
  createSessionBanner(deviceLabel);
  if (mainWindow) mainWindow.show(); // visible aussi, pas seulement le bandeau
});
ipcMain.on("session:ended", () => destroySessionBanner());

// --- Injection des événements d'entrée reçus du contrôleur distant ---
// Les coordonnées reçues sont normalisées (0..1) ; on les remet à
// l'échelle de l'écran physique courant à chaque événement (au cas où
// la résolution changerait pendant la session).

let lastButtonsDown = new Set();

ipcMain.on("input:event", async (event, payload) => {
  try {
    const primary = screen.getPrimaryDisplay().size;
    switch (payload.type) {
      case "mousemove": {
        await mouse.setPosition({
          x: Math.round(payload.x * primary.width),
          y: Math.round(payload.y * primary.height),
        });
        break;
      }
      case "mousedown": {
        const btn = mapButton(payload.button);
        await mouse.setPosition({ x: Math.round(payload.x * primary.width), y: Math.round(payload.y * primary.height) });
        await mouse.pressButton(btn);
        lastButtonsDown.add(btn);
        break;
      }
      case "mouseup": {
        const btn = mapButton(payload.button);
        await mouse.releaseButton(btn);
        lastButtonsDown.delete(btn);
        break;
      }
      case "wheel": {
        if (payload.deltaY > 0) await mouse.scrollDown(Math.min(Math.abs(Math.round(payload.deltaY / 4)), 50));
        else if (payload.deltaY < 0) await mouse.scrollUp(Math.min(Math.abs(Math.round(payload.deltaY / 4)), 50));
        break;
      }
      case "keydown": {
        const key = CODE_TO_NUT_KEY[payload.code];
        if (key !== undefined) await keyboard.pressKey(key);
        break;
      }
      case "keyup": {
        const key = CODE_TO_NUT_KEY[payload.code];
        if (key !== undefined) await keyboard.releaseKey(key);
        break;
      }
      default:
        break;
    }
  } catch (err) {
    // Une session de contrôle ne doit jamais faire planter l'agent :
    // on journalise et on continue.
    console.error("[input:event] échec d'injection :", err.message);
  }
});

// Sécurité : si la session se termine de façon anormale, relâche tout
// bouton resté enfoncé pour ne pas laisser le poste dans un état bloqué.
ipcMain.on("input:release-all", async () => {
  for (const btn of lastButtonsDown) {
    try {
      await mouse.releaseButton(btn);
    } catch {
      /* ignoré */
    }
  }
  lastButtonsDown.clear();
});

function mapButton(domButton) {
  // DOM MouseEvent.button : 0 = gauche, 1 = milieu, 2 = droit
  if (domButton === 2) return Button.RIGHT;
  if (domButton === 1) return Button.MIDDLE;
  return Button.LEFT;
}

// Pont sécurisé entre la fenêtre (contexte isolé, sans Node) et le
// processus principal. Le renderer ne voit jamais `fs`, `ipcRenderer`
// brut, etc. — seulement les fonctions explicitement exposées ici.
"use strict";

const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("remoteops", {
  getConfig: () => ipcRenderer.invoke("config:get"),
  saveConfig: (config) => ipcRenderer.invoke("config:save", config),
  getScreenSource: () => ipcRenderer.invoke("screen:get-source"),
  sendInput: (payload) => ipcRenderer.send("input:event", payload),
  releaseAllInputs: () => ipcRenderer.send("input:release-all"),
  setTrayStatus: (label) => ipcRenderer.send("tray:set-status", label),
});

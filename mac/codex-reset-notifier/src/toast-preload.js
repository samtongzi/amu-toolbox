const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("toast", {
  onContent: callback => ipcRenderer.on("toast:content", (_event, content) => callback(content)),
  onOpenFailed: callback => ipcRenderer.on("toast:open-failed", () => callback()),
  ready: height => ipcRenderer.send("toast:action", "ready", height),
  pause: () => ipcRenderer.send("toast:action", "pause"),
  resume: () => ipcRenderer.send("toast:action", "resume"),
  close: () => ipcRenderer.send("toast:action", "close"),
  open: () => ipcRenderer.send("toast:action", "open")
});

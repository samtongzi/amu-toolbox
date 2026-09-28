const { contextBridge, ipcRenderer } = require("electron");

function subscribe(channel, callback) {
  if (typeof callback !== "function") throw new TypeError("callback must be a function");
  const listener = (_event, payload) => callback(payload);
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
}

contextBridge.exposeInMainWorld("appApi", Object.freeze({
  getState: () => ipcRenderer.invoke("app:get-state"),
  refresh: () => ipcRenderer.invoke("scan:request"),
  startUpdates: (snapshotId, packageKeys) => ipcRenderer.invoke("updates:start", { snapshotId, packageKeys }),
  cancelUpdates: runId => ipcRenderer.invoke("updates:cancel", { runId }),
  retryFailed: runId => ipcRenderer.invoke("updates:retry-failed", { runId }),
  updateSettings: settings => ipcRenderer.invoke("settings:update", settings),
  showPackageContextMenu: (snapshotId, packageKey) => ipcRenderer.invoke("packages:show-context-menu", { snapshotId, packageKey }),
  restoreIgnored: identity => ipcRenderer.invoke("ignored:restore", { identity }),
  clearLogs: () => ipcRenderer.invoke("logs:clear"),
  onStateChanged: callback => subscribe("app:state-changed", callback),
  onLogEntry: callback => subscribe("app:log-entry", callback)
}));

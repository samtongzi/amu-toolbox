const path = require("path");

class WindowController {
  constructor({ BrowserWindow, app, iconPath }) {
    this.BrowserWindow = BrowserWindow;
    this.app = app;
    this.iconPath = iconPath;
    this.window = null;
    this.quitting = false;
  }

  create() {
    if (this.window && !this.window.isDestroyed()) return this.window;
    this.window = new this.BrowserWindow({
      width: 1120,
      height: 760,
      minWidth: 720,
      minHeight: 540,
      show: false,
      backgroundColor: process.platform === "darwin" ? "#00000000" : "#e9e9f7",
      ...(process.platform === "darwin" ? { vibrancy: "sidebar", visualEffectState: "active" } : {}),
      icon: this.iconPath,
      autoHideMenuBar: true,
      webPreferences: {
        preload: path.join(__dirname, "..", "..", "preload.js"),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        webSecurity: true
      }
    });
    this.window.loadFile(path.join(__dirname, "..", "..", "renderer", "index.html"));
    this.window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
    this.window.webContents.on("will-navigate", event => event.preventDefault());
    this.window.on("close", event => {
      if (this.quitting) return;
      event.preventDefault();
      this.window.hide();
    });
    this.window.on("closed", () => {
      this.window = null;
    });
    return this.window;
  }

  show() {
    const window = this.create();
    if (window.isMinimized()) window.restore();
    window.show();
    window.focus();
  }

  hide() {
    this.window?.hide();
  }

  send(channel, payload) {
    if (this.window && !this.window.isDestroyed() && !this.window.webContents.isDestroyed()) {
      this.window.webContents.send(channel, payload);
    }
  }

  setQuitting() {
    this.quitting = true;
  }
}

module.exports = { WindowController };

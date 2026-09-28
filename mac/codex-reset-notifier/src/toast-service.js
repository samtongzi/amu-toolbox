const path = require("path");
const os = require("os");
const { getSafeSourceUrl } = require("./event-filter");

function toastBounds(workArea, height = 148) {
  const margin = 16;
  const width = Math.min(360, Math.max(1, workArea.width - margin * 2));
  height = Math.min(Math.max(124, Math.ceil(height)), 280, Math.max(1, workArea.height - margin * 2));
  return { x: workArea.x + workArea.width - width - margin,
    y: workArea.y + workArea.height - height - margin, width, height };
}

class ToastService {
  constructor({ BrowserWindow, ipcMain, screen, shell, duration = 12000,
    setTimer = setTimeout, clearTimer = clearTimeout }) {
    Object.assign(this, { BrowserWindow, ipcMain, screen, shell, duration, setTimer, clearTimer });
    this.queue = [];
    this.current = null;
    this.disposed = false;
    this.onAction = (ipcEvent, action, value) => {
      const item = this.current;
      if (!item || ipcEvent.sender !== item.window?.webContents
        || ipcEvent.senderFrame !== item.window.webContents.mainFrame) return;
      if (action === "ready" && Number.isFinite(value) && !item.shown) {
        this.clearTimer(item.loadingTimer);
        item.height = value;
        this.position();
        item.shown = true;
        item.window.showInactive();
        this.shell.beep();
        this.resume();
      } else if (action === "pause" && item.shown) {
        this.clearTimer(item.dismissTimer);
      } else if (action === "resume" && item.shown) {
        this.resume();
      } else if (action === "close") {
        this.finish(item);
      } else if (action === "open" && item.shown && !item.opening) {
        item.opening = true;
        Promise.resolve().then(() => this.shell.openExternal(getSafeSourceUrl(item.event)))
          .then(() => this.finish(item))
          .catch(error => {
            item.opening = false;
            if (this.current === item && !item.window.isDestroyed()) {
              item.window.webContents.send("toast:open-failed");
              this.resume();
            }
            console.error("Failed to open notification source:", error);
          });
      }
    };
    this.ipcMain.on("toast:action", this.onAction);
    this.onDisplayChanged = () => this.position();
    for (const event of ["display-metrics-changed", "display-removed", "display-added"]) {
      this.screen.on(event, this.onDisplayChanged);
    }
  }

  show(event, fallback) {
    if (this.disposed) return fallback();
    this.queue.push({ event, fallback });
    this.next();
  }

  next() {
    if (this.disposed || this.current || !this.queue.length) return;
    const item = this.current = this.queue.shift();
    const acrylic = process.platform === "win32" && Number(os.release().split(".")[2]) >= 22621;
    try {
      const win = item.window = new this.BrowserWindow({
        ...toastBounds(this.screen.getPrimaryDisplay().workArea),
        title: "Codex 额度通知", icon: path.join(__dirname, process.platform === "darwin" ? "../assets/icon.png" : "../assets/icon.ico"),
        show: false, frame: false, resizable: false, minimizable: false, maximizable: false,
        skipTaskbar: true, alwaysOnTop: true, hasShadow: true, roundedCorners: true,
        backgroundColor: "#00000000", transparent: !acrylic,
        ...(acrylic ? { backgroundMaterial: "acrylic" } : {}),
        ...(process.platform === "darwin" ? { vibrancy: "hud", visualEffectState: "active" } : {}),
        webPreferences: {
          preload: path.join(__dirname, "toast-preload.js"),
          contextIsolation: true, nodeIntegration: false, sandbox: true
        }
      });
      win.setMenu(null);
      win.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
      win.webContents.on("will-navigate", event => event.preventDefault());
      win.webContents.once("did-finish-load", () => {
        if (this.current !== item) return;
        const text = (value, fallback, limit) => typeof value === "string" && value.trim()
          ? value.trim().slice(0, limit) : fallback;
        win.webContents.send("toast:content", {
          title: text(item.event.title, "Codex 额度已重置", 200),
          body: [text(item.event.eventType, "额度重置", 120), text(item.event.scope, "", 240)]
            .filter(Boolean).join(" · "),
          acrylic: acrylic || process.platform === "darwin"
        });
      });
      win.webContents.once("render-process-gone", () => this.fail(item));
      win.once("unresponsive", () => this.fail(item));
      win.once("closed", () => this.finish(item));
      item.loadingTimer = this.setTimer(() => this.fail(item), 8000);
      Promise.resolve(win.loadFile(path.join(__dirname, "../renderer/toast.html")))
        .catch(() => this.fail(item));
    } catch (error) {
      console.error("Custom notification unavailable:", error);
      this.fail(item);
    }
  }

  position() {
    const item = this.current;
    if (item?.window && !item.window.isDestroyed()) {
      item.window.setBounds(toastBounds(this.screen.getPrimaryDisplay().workArea, item.height));
    }
  }

  resume() {
    const item = this.current;
    if (!item || !item.shown) return;
    this.clearTimer(item.dismissTimer);
    item.dismissTimer = this.setTimer(() => this.finish(item), this.duration);
  }

  fail(item) {
    if (this.current !== item) return;
    try { item.fallback(); } finally { this.finish(item); }
  }

  finish(item) {
    if (this.current !== item) return;
    this.current = null;
    this.clearTimer(item.loadingTimer);
    this.clearTimer(item.dismissTimer);
    if (item.window && !item.window.isDestroyed()) item.window.destroy();
    this.next();
  }

  destroy() {
    this.disposed = true;
    this.queue = [];
    if (this.current) this.finish(this.current);
    this.ipcMain.removeListener("toast:action", this.onAction);
    for (const event of ["display-metrics-changed", "display-removed", "display-added"]) {
      this.screen.removeListener(event, this.onDisplayChanged);
    }
  }
}

module.exports = { ToastService, toastBounds };

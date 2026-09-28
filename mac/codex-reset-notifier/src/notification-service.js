const { getSafeSourceUrl } = require("./event-filter");

class NotificationService {
  constructor({ Notification, shell, icon, getTray, toast, platform = process.platform }) {
    this.platform = platform;
    this.Notification = Notification;
    this.shell = shell;
    this.icon = icon;
    this.getTray = getTray;
    this.toast = toast;
    this.active = new Set();
  }

  notify(event) {
    if (this.toast && this.platform !== 'darwin') {
      this.toast.show(event, () => this.notifyNative(event));
      return;
    }
    this.notifyNative(event);
  }

  notifyNative(event) {
    const title = event.title || "Codex 额度重置提醒";
    const bodyParts = [event.eventType || "额度重置"];
    if (event.scope) bodyParts.push(event.scope);
    const body = bodyParts.join(" · ");
    if (!this.Notification.isSupported()) {
      this.showBalloon(title, body);
      return;
    }
    const notification = new this.Notification({
      title,
      body,
      icon: this.icon,
      silent: false,
      timeoutType: "default"
    });
    this.active.add(notification);
    const release = () => this.active.delete(notification);
    notification.once("close", release);
    notification.once("click", () => {
      release();
      void this.shell.openExternal(getSafeSourceUrl(event));
    });
    notification.once("failed", (_event, error) => {
      release();
      this.showBalloon(title, body);
      console.error("Notification failed:", error);
    });
    const cleanupTimer = setTimeout(release, 2 * 60 * 1000);
    cleanupTimer.unref?.();
    notification.once("close", () => clearTimeout(cleanupTimer));
    notification.once("click", () => clearTimeout(cleanupTimer));
    notification.once("failed", () => clearTimeout(cleanupTimer));
    notification.show();
  }
  showBalloon(title, content) {
    const tray = this.getTray();
    if (process.platform === "win32" && tray && !tray.isDestroyed()) tray.displayBalloon({ title, content, icon: this.icon });
  }
}
module.exports = { NotificationService };

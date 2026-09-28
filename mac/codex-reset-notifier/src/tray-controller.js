function formatTime(value, fallback = "尚未成功检查") {
  if (!value || Number.isNaN(Date.parse(value))) return fallback;
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit"
  }).format(new Date(value));
}

class TrayController {
  constructor({ Tray, Menu, icon, shell, homeUrl, app, onCheck, onToggleStartup }) {
    this.Menu = Menu;
    this.shell = shell;
    this.homeUrl = homeUrl;
    this.app = app;
    this.onCheck = onCheck;
    this.onToggleStartup = onToggleStartup;
    this.status = { state: "monitoring", lastSuccessfulCheckAt: null, latestResetAt: null };
    this.startupEnabled = true;
    this.startupAvailable = true;
    this.tray = new Tray(icon);
    this.tray.setToolTip("Codex 额度重置通知 - 监控中");
    this.tray.on("click", () => this.tray.popUpContextMenu());
    this.rebuildMenu();
  }
  setStatus(status) {
    this.status = status;
    const labels = { checking: "正在检查", monitoring: "监控中", error: "最近检查失败" };
    this.tray.setToolTip(`Codex 额度重置通知 - ${labels[status.state] || "监控中"}`);
    this.rebuildMenu();
  }
  setStartup(enabled, available = true) {
    this.startupEnabled = enabled;
    this.startupAvailable = available;
    this.rebuildMenu();
  }
  rebuildMenu() {
    const labels = { checking: "正在检查", monitoring: "监控中", error: "最近检查失败" };
    const menu = this.Menu.buildFromTemplate([
      { label: `状态：${labels[this.status.state] || "监控中"}`, enabled: false },
      {
        label: `最近重置：${formatTime(this.status.latestResetAt, "尚未发现重置记录")}`,
        enabled: false
      },
      { label: `上次成功：${formatTime(this.status.lastSuccessfulCheckAt)}`, enabled: false },
      { type: "separator" },
      { label: "立即检查", enabled: this.status.state !== "checking", click: () => this.onCheck() },
      ...(process.platform === 'darwin' ? [{ label: '系统通知设置…', click: () => void this.shell.openExternal('x-apple.systempreferences:com.apple.Notifications-Settings.extension') }] : []),
      {
        label: "开机启动",
        type: "checkbox",
        checked: this.startupEnabled,
        enabled: this.startupAvailable,
        click: item => this.onToggleStartup(item.checked)
      },
      { type: "separator" },
      { label: "打开 divin.cc", click: () => void this.shell.openExternal(this.homeUrl) },
      { label: "退出", click: () => this.app.quit() }
    ]);
    this.tray.setContextMenu(menu);
  }
  destroy() {
    if (!this.tray.isDestroyed()) this.tray.destroy();
  }
}
module.exports = { TrayController, formatTime };

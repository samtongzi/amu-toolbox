class TrayController {
  constructor({ Tray, Menu, icon, app, windowController, onScan, onToggleStartup }) {
    this.Menu = Menu;
    this.app = app;
    this.windowController = windowController;
    this.onScan = onScan;
    this.onToggleStartup = onToggleStartup;
    this.state = null;
    this.tray = new Tray(icon);
    this.tray.setToolTip("App 更新监测器");
    this.tray.on("double-click", () => this.windowController.show());
    this.rebuild();
  }

  setState(state) {
    this.state = state;
    const count = state?.snapshot?.packages?.length || 0;
    const scanning = state?.runtime?.scanStatus === "scanning";
    this.tray.setToolTip(`App 更新监测器 - ${scanning ? "正在扫描" : `${count} 个可用更新`}`);
    this.rebuild();
  }

  rebuild() {
    const count = this.state?.snapshot?.packages?.length || 0;
    const scanning = this.state?.runtime?.scanStatus === "scanning";
    const openAtLogin = this.state?.persisted?.settings?.openAtLogin === true;
    this.tray.setContextMenu(this.Menu.buildFromTemplate([
      { label: "显示主界面", click: () => this.windowController.show() },
      { type: "separator" },
      { label: `可用更新：${count}`, enabled: false },
      { label: scanning ? "正在扫描…" : "立即扫描", enabled: !scanning, click: () => void this.onScan() },
      { type: "separator" },
      { label: "开机启动", type: "checkbox", checked: openAtLogin, click: item => void this.onToggleStartup(item.checked) },
      { type: "separator" },
      { label: "退出", accelerator: "CommandOrControl+Q", click: () => this.app.quit() }
    ]));
  }

  destroy() {
    if (!this.tray.isDestroyed()) this.tray.destroy();
  }
}

module.exports = { TrayController };

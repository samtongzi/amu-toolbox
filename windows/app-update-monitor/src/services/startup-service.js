class StartupService {
  constructor({ app, executablePath = process.env.PORTABLE_EXECUTABLE_FILE || process.execPath, platform = process.platform }) {
    this.app = app;
    this.platform = platform;
    this.executablePath = executablePath;
    this.name = "AppUpdateMonitor";
  }

  isAvailable() {
    return ["win32", "darwin"].includes(this.platform) && this.app.isPackaged;
  }

  setEnabled(enabled) {
    if (!this.isAvailable()) return false;
    if (this.platform === "darwin") { this.app.setLoginItemSettings({ openAtLogin: enabled }); return true; }
    this.app.setLoginItemSettings({
      openAtLogin: enabled,
      name: this.name,
      path: this.executablePath,
      args: ["--background"]
    });
    return true;
  }

  getEnabled() {
    if (!this.isAvailable()) return false;
    if (this.platform === "darwin") return this.app.getLoginItemSettings().openAtLogin;
    const settings = this.app.getLoginItemSettings({ name: this.name, path: this.executablePath, args: ["--background"] });
    return settings.executableWillLaunchAtLogin ?? settings.openAtLogin;
  }
}

module.exports = { StartupService };

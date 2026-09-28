const path = require("path");
const {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  Menu,
  nativeImage,
  Notification,
  powerMonitor,
  Tray
} = require("electron");
const { APP_ID, APP_NAME, DEFAULT_SCAN_INTERVAL_MINUTES } = require("./src/config");
const { IpcController } = require("./src/controllers/ipc-controller");
const { TrayController } = require("./src/controllers/tray-controller");
const { WindowController } = require("./src/controllers/window-controller");
const { LogService } = require("./src/log-service");
const { AppController } = require("./src/services/app-controller");
const { Monitor } = require("./src/services/monitor");
const { NotificationService } = require("./src/services/notification-service");
const { ScanService } = require("./src/services/scan-service");
const { StartupService } = require("./src/services/startup-service");
const { UpdateService } = require("./src/services/update-service");
const { StateStore } = require("./src/state-store");
const { ProcessRunner } = require("./src/winget/process-runner");
const { WingetClient } = require("./src/winget/client");

app.setName(APP_NAME);
if (process.platform === "win32") app.setAppUserModelId(APP_ID);
const cleanupStartup = process.platform === "darwin" && app.isPackaged && process.argv.includes("--amu-disable-startup");
const hasSingleInstanceLock = !cleanupStartup && app.requestSingleInstanceLock();
if (cleanupStartup) app.whenReady().then(() => { app.setLoginItemSettings({ openAtLogin: false }); app.quit(); }).catch(() => app.exit(1));
else if (!hasSingleInstanceLock) app.quit();

let appController;
let ipcController;
let monitor;
let trayController;
let updateService;
let windowController;
let quitting = false;

function logTo(service) {
  return (level, scope, code, message, packageKey) => service.add(level, scope, code, message, packageKey);
}

async function initialize() {
  const isMac = process.platform === "darwin";
  const iconPath = path.join(__dirname, "assets", isMac ? "icon.png" : "icon.ico");
  const icon = nativeImage.createFromPath(path.join(__dirname, "assets", isMac ? "trayTemplate.png" : "tray.png"));
  if (isMac) icon.setTemplateImage(true);
  const logService = new LogService();
  const onLog = logTo(logService);
  const stateStore = new StateStore(path.join(app.getPath("userData"), "state.json"));
  const startupService = new StartupService({ app });
  const isMock = !app.isPackaged && process.argv.includes("--mock-winget");
  const wingetState = { available: false, version: null, backend: isMac ? "homebrew" : "winget" };
  const client = isMock
    ? new (require("./src/winget/fake-client").FakeWingetClient)()
    : isMac ? new (require("./src/homebrew/client").HomebrewClient)({ runner: new ProcessRunner(), onAvailability: state => { wingetState.available = state.available; wingetState.version = state.version; } })
    : new WingetClient({ runner: new ProcessRunner() });

  windowController = new WindowController({ BrowserWindow, app, iconPath });
  windowController.create();

  const scanService = new ScanService({ client, onLog });
  const notificationService = new NotificationService({ Notification, onClick: () => windowController.show() });
  monitor = new Monitor({
    scanService,
    stateStore,
    notifier: notificationService,
    intervalMs: DEFAULT_SCAN_INTERVAL_MINUTES * 60_000,
    onState: patch => appController?.setRuntime(patch),
    onLog
  });
  updateService = new UpdateService({
    client,
    scanService,
    onLog,
    getConcurrency: () => isMac ? 1 : monitor.getState()?.settings?.maxConcurrentUpdates,
    isIgnoredPackage: pkg => monitor.isPackageIgnored(pkg)
  });
  appController = new AppController({ scanService, updateService, monitor, logService, winget: wingetState });

  ipcController = new IpcController({
    ipcMain,
    windowController,
    appController,
    monitor,
    updateService,
    logService,
    startupService,
    Menu,
    scanService
  });
  ipcController.register();

  trayController = new TrayController({
    Tray,
    Menu,
    icon,
    app,
    windowController,
    onScan: () => monitor.check("manual"),
    onToggleStartup: async enabled => {
      try {
        if (!startupService.setEnabled(enabled) && enabled) throw new Error("开机启动仅在打包版本中可用");
        await monitor.updateSettings({ openAtLogin: enabled });
        appController.broadcast();
      } catch (error) {
        onLog("error", "settings", "startup-failed", error.message);
      }
    }
  });

  appController.on("state", state => {
    windowController.send("app:state-changed", state);
    trayController.setState(state);
  });
  appController.on("log", entry => windowController.send("app:log-entry", entry));
  updateService.on("changed", state => monitor.setPaused(["queued", "running", "cancelling", "verifying"].includes(state.status)));

  if (isMac && !process.argv.includes("--background") && !app.getLoginItemSettings().wasOpenedAtLogin) windowController.show();
  const probe = await client.probe();
  wingetState.available = probe.available;
  wingetState.version = probe.version;
  if (isMac) onLog(probe.available ? "info" : "error", "homebrew", probe.available ? "brew-ready" : "brew-unavailable", probe.available ? probe.version : "未找到原生 Homebrew，请安装到 /opt/homebrew 后刷新");
  else onLog(probe.available ? "info" : "error", "winget", probe.available ? "winget-ready" : "winget-unavailable", probe.available ? `winget ${probe.version || "可用"}` : "未找到可用的 winget");

  await monitor.start();
  monitor.setIntervalMinutes(monitor.getState()?.settings?.scanIntervalMinutes || DEFAULT_SCAN_INTERVAL_MINUTES);
  appController.broadcast();

  if (!process.argv.includes("--background") && !(isMac && app.getLoginItemSettings().wasOpenedAtLogin)) windowController.show();
}

if (hasSingleInstanceLock) {
  app.whenReady().then(initialize).catch(error => {
    dialog.showErrorBox(`${APP_NAME} 启动失败`, error?.message || String(error));
    app.quit();
  });

  app.on("second-instance", () => windowController?.show());
  app.on("activate", () => windowController?.show());
  app.on("window-all-closed", () => {});

  app.on("before-quit", event => {
    if (quitting) return;
    const update = updateService?.getState();
    const active = update && ["queued", "running", "cancelling", "verifying"].includes(update.status);
    if (active) {
      const choice = dialog.showMessageBoxSync(windowController?.window || undefined, {
        type: "warning",
        buttons: ["继续运行", "退出程序"],
        defaultId: 0,
        cancelId: 0,
        title: "更新仍在进行",
        message: "退出会停止剩余更新任务",
        detail: "已经启动的安装器可能仍会继续收尾。"
      });
      if (choice === 0) {
        event.preventDefault();
        return;
      }
      updateService.cancel(update.runId);
    }
    quitting = true;
    windowController?.setQuitting();
    monitor?.stop();
    ipcController?.dispose();
    trayController?.destroy();
  });

  app.whenReady().then(() => {
    powerMonitor.on("resume", () => monitor?.scheduleAfterResume());
    powerMonitor.on("unlock-screen", () => monitor?.scheduleAfterResume());
  });
}

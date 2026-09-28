const path = require("path");
const { app, BrowserWindow, ipcMain, Menu, net, nativeImage, Notification, powerMonitor, screen, shell, Tray } = require("electron");
const { ApiClient } = require("./src/api-client");
const {
  API_URL,
  HOME_URL,
  MAX_RESPONSE_BYTES,
  POLL_INTERVAL_MS,
  REQUEST_TIMEOUT_MS
} = require("./src/config");
const { Monitor } = require("./src/monitor");
const { NotificationService } = require("./src/notification-service");
const { StateStore } = require("./src/state-store");
const { StartupService } = require("./src/startup-service");
const { TrayController } = require("./src/tray-controller");
const { ToastService } = require("./src/toast-service");

const APP_ID = "com.local.codex-reset-notifier";
let monitor;
let trayController;
let notificationService;
let resumeTimer;
let toastService;

if (process.platform === "win32") app.setAppUserModelId(APP_ID);
const cleanupStartup = process.platform === "darwin" && app.isPackaged && process.argv.includes("--amu-disable-startup");
const hasSingleInstanceLock = !cleanupStartup && app.requestSingleInstanceLock();
if (cleanupStartup) app.whenReady().then(() => { app.setLoginItemSettings({ openAtLogin: false }); app.quit(); }).catch(() => app.exit(1));
else if (!hasSingleInstanceLock) app.quit();

async function initialize() {
  const isMac = process.platform === "darwin";
  if (isMac) app.dock.hide();
  const iconPath = path.join(__dirname, "assets", "icon.png");
  const icon = nativeImage.createFromPath(iconPath);
  const trayIcon = nativeImage.createFromPath(path.join(__dirname, "assets", isMac ? "trayTemplate.png" : "tray.png"));
  if (isMac) trayIcon.setTemplateImage(true);
  const stateStore = new StateStore(path.join(app.getPath("userData"), "state.json"));
  const initialState = await stateStore.load();
  const startupService = new StartupService({ app });

  trayController = new TrayController({
    Tray,
    Menu,
    icon: trayIcon,
    shell,
    homeUrl: HOME_URL,
    app,
    onCheck: () => void monitor?.check(),
    onToggleStartup: async enabled => {
      try {
        if (!startupService.setEnabled(enabled)) return;
        await monitor.setOpenAtLogin(enabled);
        trayController.setStartup(enabled, true);
      } catch (error) {
        startupService.setEnabled(!enabled);
        console.error("Failed to update startup setting:", error);
        trayController.setStartup(!enabled, true);
      }
    }
  });

  if (!isMac) toastService = new ToastService({ BrowserWindow, ipcMain, screen, shell });
  notificationService = new NotificationService({
    Notification,
    shell,
    icon,
    getTray: () => trayController.tray,
    toast: toastService
  });

  monitor = new Monitor({
    apiClient: new ApiClient({
      fetcher: net.fetch,
      url: API_URL,
      timeoutMs: REQUEST_TIMEOUT_MS,
      maxResponseBytes: MAX_RESPONSE_BYTES
    }),
    stateStore,
    notifier: notificationService,
    intervalMs: POLL_INTERVAL_MS,
    onStatus: status => trayController.setStatus(status)
  });

  await monitor.start();
  if (startupService.isAvailable()) {
    if (!initialState.settings.startupConfigured) {
      startupService.setEnabled(!isMac);
      await monitor.setOpenAtLogin(!isMac);
    }
    trayController.setStartup(startupService.getEnabled(), true);
  } else {
    trayController.setStartup(initialState.settings.openAtLogin, false);
  }
}

if (hasSingleInstanceLock) {
  app.whenReady().then(initialize).catch(error => {
    console.error("Failed to initialize application:", error);
    app.quit();
  });

  app.on("second-instance", () => {
    void monitor?.check();
    trayController?.tray.popUpContextMenu();
  });

  app.on("before-quit", () => {
    monitor?.stop();
    toastService?.destroy();
    if (resumeTimer) clearTimeout(resumeTimer);
    trayController?.destroy();
  });

  // Closing the last notification must leave the tray monitor running.
  app.on("window-all-closed", () => {});

  app.whenReady().then(() => {
    const checkAfterResume = () => {
      if (resumeTimer) clearTimeout(resumeTimer);
      resumeTimer = setTimeout(() => void monitor?.check(), 3000);
    };
    powerMonitor.on("resume", checkAfterResume);
    powerMonitor.on("unlock-screen", checkAfterResume);
  });
}
